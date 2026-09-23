import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';

class EmailService {
  private transporter: Transporter | null = null;


  constructor() {
    this.initTransporter();
  }

  private initTransporter() {
    const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass } = config.email;
    if (smtpUser && smtpPass) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    } else {
      console.log('⚠️ [EmailService] SMTP login credentials not configured in environment variables.');
    }
  }

  /**
   * General email sending function
   */
  async sendEmail(options: { to: string; subject: string; html: string; text?: string }) {
    const { smtpUser, smtpPass } = config.email;

    if (!smtpUser || !smtpPass) {
      console.warn(`⚠️ [EmailService] Skipping email to ${options.to}. SMTP credentials not configured.`);
      return false;
    }

    const configsToTry = [
      { host: 'smtp.office365.com', port: 587, secure: false },
      { host: 'smtp.office365.com', port: 465, secure: true },
      { host: config.email.smtpHost || 'smtp.office365.com', port: config.email.smtpPort || 587, secure: false },
      { host: 'smtp.yandex.ru', port: 465, secure: true },
      { host: 'smtp.gmail.com', port: 465, secure: true },
      { host: 'smtp.mail.ru', port: 465, secure: true },
    ];


    for (const cfg of configsToTry) {
      try {
        const transporter = nodemailer.createTransport({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
          tls: {
            rejectUnauthorized: false,
          },
        });

        const info = await transporter.sendMail({
          from: `"BPM Tizimi" <${smtpUser}>`,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text || options.subject,
        });

        console.log(`✉️ [EmailService] Email sent successfully via ${cfg.host}:${cfg.port} to ${options.to}: ${info.messageId}`);
        return true;
      } catch (err: any) {
        console.warn(`⚠️ [EmailService] Failed attempt via ${cfg.host}:${cfg.port}:`, err?.message || err);
      }
    }

    console.error(`❌ [EmailService] All SMTP fallback attempts failed for ${options.to}. Check App Password / SMTP settings.`);
    return false;
  }


  /**
   * Notification email sent to an assigned executor for incoming email document
   */
  async sendTaskAssignedEmail(options: {
    toEmail: string;
    executorName: string;
    docNumber: string;
    docTitle: string;
    deadline?: string;
    resolution?: string;
    docId: number;
  }) {
    const docUrl = `${config.frontendUrl}/dashboard/documents/${options.docId}`;
    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; padding: 30px; color: #1e293b;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
          <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 24px; text-align: center; color: white;">
            <h2 style="margin: 0; font-size: 22px; font-weight: 700;">📩 Yangi Hujjat Ijroga Biriktirildi</h2>
            <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">BPM Tizimi Bilantirishnomasi</p>
          </div>
          
          <div style="padding: 24px; line-height: 1.6;">
            <p style="font-size: 16px; margin-top: 0;">Hurmatli <strong>${options.executorName}</strong>,</p>
            <p style="font-size: 14px; color: #475569;">
              Sizga yangi kiruvchi email xat bo'yicha ijro topshirig'i biriktirildi. Qoldirilgan tafsilotlar quyidagicha:
            </p>
            
            <div style="background: #f8fafc; border-left: 4px solid #2563eb; border-radius: 6px; padding: 16px; margin: 20px 0;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b; width: 140px;">Hujjat Raqami:</td>
                  <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${options.docNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Xat Mavzusi:</td>
                  <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${options.docTitle}</td>
                </tr>
                ${options.deadline ? `
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Ijro Muddate (Deadline):</td>
                  <td style="padding: 6px 0; font-weight: 600; color: #dc2626;">${options.deadline}</td>
                </tr>` : ''}
                ${options.resolution ? `
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Rahbar Rezolyutsiyasi:</td>
                  <td style="padding: 6px 0; font-style: italic; color: #334155;">"${options.resolution}"</td>
                </tr>` : ''}
              </table>
            </div>

            <div style="text-align: center; margin-top: 30px;">
              <a href="${docUrl}" style="background-color: #2563eb; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 2px 6px rgba(37,99,235,0.3);">
                Hujjatni Tizimda Ko'rish
              </a>
            </div>
          </div>
          
          <div style="background: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
            Bu avtomatik yuborilgan bildirishnoma. Iltimos, ushbu xatga javob bermang.
          </div>
        </div>
      </div>
    `;

    return this.sendEmail({
      to: options.toEmail,
      subject: `[BPM] Topshiriq biriktirildi: ${options.docTitle} (${options.docNumber})`,
      html,
    });
  }
}

export const emailService = new EmailService();
