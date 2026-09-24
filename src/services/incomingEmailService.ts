import fs from 'fs';
import path from 'path';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma';
import { config } from '../config';

interface EmailAccountConfig {
  name: string;
  host: string;
  port: number;
  user: string;
  pass: string;
}

class IncomingEmailService {
  private isProcessing = false;
  private cronJob: cron.ScheduledTask | null = null;

  /**
   * Start cron job for monitoring Gmail & Yandex
   */
  public startCronJob() {
    const cronSchedule = config.email.checkCron || '*/2 * * * *';
    console.log(`🚀 [IncomingEmailService] Email cron monitoring scheduled (${cronSchedule})`);

    this.cronJob = cron.schedule(cronSchedule, async () => {
      await this.checkAllAccounts();
    });

    // Run first check after 10 seconds of startup
    setTimeout(() => {
      this.checkAllAccounts().catch(err => console.error('[IncomingEmailService] Initial check error:', err));
    }, 10000);
  }

  /**
   * Stop cron job
   */
  public stopCronJob() {
    if (this.cronJob) {
      this.cronJob.stop();
      console.log('🛑 [IncomingEmailService] Cron job stopped.');
    }
  }

  /**
   * Main method to check Gmail and Yandex
   */
  public async checkAllAccounts() {
    if (this.isProcessing) {
      console.log('⏳ [IncomingEmailService] Previous email check is still running, skipping...');
      return;
    }

    this.isProcessing = true;

    const accounts: EmailAccountConfig[] = [];

    if (config.email.official.user && config.email.official.pass) {
      accounts.push({
        name: 'Discover Invest (info@di.uz)',
        host: config.email.official.host,
        port: config.email.official.port,
        user: config.email.official.user,
        pass: config.email.official.pass,
      });
    }

    if (config.email.gmail.user && config.email.gmail.pass && config.email.gmail.user !== config.email.official.user) {
      accounts.push({
        name: 'Gmail',
        host: config.email.gmail.host,
        port: config.email.gmail.port,
        user: config.email.gmail.user,
        pass: config.email.gmail.pass,
      });
    }

    if (config.email.yandex.user && config.email.yandex.pass && config.email.yandex.user !== config.email.official.user) {
      accounts.push({
        name: 'Yandex',
        host: config.email.yandex.host,
        port: config.email.yandex.port,
        user: config.email.yandex.user,
        pass: config.email.yandex.pass,
      });
    }

    if (accounts.length === 0) {
      this.isProcessing = false;
      return;
    }


    for (const acc of accounts) {
      try {
        await this.fetchUnreadEmails(acc);
      } catch (err) {
        console.error(`❌ [IncomingEmailService] Error checking ${acc.name} (${acc.user}):`, err);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Fetch unread emails via IMAP Flow
   */
  private async fetchUnreadEmails(acc: EmailAccountConfig) {
    const candidateHosts = [acc.host];
    if (acc.user.includes('di.uz') || acc.user.includes('@')) {
      ['outlook.office365.com', 'imap-mail.outlook.com', 'imap.yandex.ru', 'mail.di.uz', 'imap.di.uz', 'imap.mail.ru', 'imap.gmail.com'].forEach(h => {
        if (!candidateHosts.includes(h)) candidateHosts.push(h);
      });
    }


    let client: ImapFlow | null = null;
    let connectedHost = '';

    for (const host of candidateHosts) {
      let testClient: ImapFlow | null = null;
      try {
        testClient = new ImapFlow({
          host,
          port: acc.port,
          secure: true,
          auth: {
            user: acc.user,
            pass: acc.pass,
          },
          logger: false,
        });

        // Register error handler to catch connection / socket errors (ECONNRESET, TLS errors)
        // and prevent Node.js from throwing unhandled 'error' event and crashing the process.
        testClient.on('error', (err) => {
          console.warn(`⚠️ [IncomingEmailService] ImapFlow error for ${acc.user} (${host}):`, err?.message || err);
        });

        await testClient.connect();
        client = testClient;
        connectedHost = host;
        break;
      } catch {
        if (testClient) {
          try {
            await testClient.logout();
          } catch {
            // Ignore failure on cleanup of failed attempt
          }
        }
      }
    }

    if (!client) {
      console.warn(`⚠️ [IncomingEmailService] Could not connect to IMAP server for ${acc.user} (tried ${candidateHosts.join(', ')})`);
      return;
    }

    try {
      let lock;
      try {
        lock = await client.getMailboxLock('INBOX');
      } catch (lockErr) {
        console.warn(`⚠️ [IncomingEmailService] Could not acquire mailbox lock for ${acc.user}:`, lockErr);
        return;
      }

      try {
        // Find unseen message UIDs
        const unseenUids = await client.search({ seen: false });
        if (!unseenUids || unseenUids.length === 0) {
          return;
        }

        console.log(`📬 [IncomingEmailService] Connected via ${connectedHost}. Found ${unseenUids.length} unread email(s) in ${acc.name} (${acc.user})`);

        // Get or determine system admin user to attach as creator
        const adminUser = await this.getSystemAdminUser();
        if (!adminUser) {
          console.error('❌ [IncomingEmailService] No active admin user found in database to assign as creator.');
          return;
        }

        for (const uid of unseenUids) {
          try {
            const message = await client.fetchOne(uid, { source: true }, { uid: true });
            if (!message || !message.source) continue;

            const parsed: ParsedMail = await simpleParser(message.source);
            await this.processSingleEmail(parsed, adminUser.id, acc.name);

            // Mark message as SEEN
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          } catch (msgError) {
            console.error(`❌ [IncomingEmailService] Failed to process message UID ${uid}:`, msgError);
          }
        }
      } finally {
        if (lock) {
          try {
            lock.release();
          } catch {
            // Ignore lock release error if socket closed
          }
        }
      }
    } catch (error) {
      console.error(`❌ [IncomingEmailService] IMAP connection/operation error for ${acc.name}:`, error);
    } finally {
      if (client) {
        try {
          await client.logout();
        } catch {
          // Ignore logout error on closed connection
        }
      }
    }
  }

  /**
   * Save email & attachments to Database
   */
  private async processSingleEmail(parsed: ParsedMail, creatorId: number, accountProvider: string) {
    const subject = parsed.subject || 'Sarlavhasiz Xat';
    const sender = parsed.from?.text || parsed.from?.value?.[0]?.address || 'Noma\'lum Jo\'natuvchi';
    const bodyText = parsed.text || (parsed.html ? parsed.html.replace(/<[^>]+>/g, ' ') : 'Matnsiz xat');
    const senderDate = parsed.date || new Date();
    const senderDocNum = parsed.messageId ? parsed.messageId.substring(0, 50) : null;

    // Generate unique docNumber
    const year = new Date().getFullYear();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const docNumber = `IN-EMAIL-${year}-${randomSuffix}`;

    // Handle Upload Directory
    const uploadDir = path.join(process.cwd(), config.uploadDir || 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const savedAttachments: { fileUrl: string; fileName: string; fileSize: number }[] = [];

    if (parsed.attachments && parsed.attachments.length > 0) {
      for (const att of parsed.attachments as Attachment[]) {
        const originalName = att.filename || `attachment_${Date.now()}`;
        const ext = path.extname(originalName);
        const uniqueFileName = `${Date.now()}_${uuidv4().substring(0, 8)}${ext}`;
        const fullPath = path.join(uploadDir, uniqueFileName);

        fs.writeFileSync(fullPath, att.content);

        savedAttachments.push({
          fileUrl: `/uploads/${uniqueFileName}`,
          fileName: originalName,
          fileSize: att.size || att.content.length,
        });
      }
    }

    const mainAttachment = savedAttachments[0];

    // Create Document in Database
    const newDoc = await prisma.document.create({
      data: {
        docNumber,
        title: subject,
        description: bodyText.length > 2000 ? bodyText.substring(0, 2000) + '...' : bodyText,
        category: `Kiruvchi Email (${accountProvider})`,
        docType: 'INCOMING',
        status: 'INCOMING_PENDING', // Pending assignment by admin/secretary
        senderOrg: sender,
        senderDocNumber: senderDocNum,
        senderDate,
        creatorId,
        fileUrl: mainAttachment ? mainAttachment.fileUrl : null,
        fileName: mainAttachment ? mainAttachment.fileName : null,
        fileSize: mainAttachment ? mainAttachment.fileSize : null,
        attachments: {
          create: savedAttachments.map(att => ({
            fileUrl: att.fileUrl,
            fileName: att.fileName,
            fileSize: att.fileSize,
            fileType: 'ATTACHMENT',
            uploadedById: creatorId,
          })),
        },
        history: {
          create: {
            actionName: 'EMAIL_RECEIVED',
            description: `Kiruvchi xat ${accountProvider} pochtasidan avtomatik qabul qilindi. Jo'natuvchi: ${sender}`,
            performedById: creatorId,
          },
        },
      },
    });

    console.log(`✅ [IncomingEmailService] New document created from email: #${newDoc.docNumber} (${newDoc.title})`);

    // Send Notification to Admins and Secretaries
    await this.notifyAdminsAndSecretaries(newDoc.id, newDoc.docNumber, subject, sender);
  }

  /**
   * Helper to get system admin or secretary user ID
   */
  private async getSystemAdminUser() {
    return prisma.user.findFirst({
      where: { role: 'ADMIN', isActive: true },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Send notification to Admins / Kanselyariya xodimlari
   */
  private async notifyAdminsAndSecretaries(docId: number, docNumber: string, title: string, sender: string) {
    try {
      const admins = await prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { role: 'ADMIN' },
            { permissions: { contains: 'INCOMING_MANAGE' } },
            { department: { contains: 'Kanselyariya' } },
          ],
        },
      });

      for (const admin of admins) {
        // Create In-App Notification
        await prisma.notification.create({
          data: {
            userId: admin.id,
            type: 'INCOMING_EMAIL',
            title: '📩 Yangi Kiruvchi Email Xat',
            message: `Jo'natuvchi: ${sender} | Mavzu: ${title}`,
            link: `/dashboard/incoming-emails`,
            documentId: docId,
          },
        });


      }
    } catch (err) {
      console.error('❌ [IncomingEmailService] Error sending notifications to admins:', err);
    }
  }
}

export const incomingEmailService = new IncomingEmailService();
