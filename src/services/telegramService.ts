import { prisma } from '../utils/prisma';
import { config } from '../config';

class TelegramService {
  private botToken: string;
  private baseUrl: string;
  private frontendUrl: string;

  constructor() {
    this.botToken = config.telegramBotToken;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
    this.frontendUrl = config.frontendUrl || 'http://localhost:3000';
  }

  /**
   * Telegram Bot Token sozlanganligini tekshirish
   */
  public isConfigured(): boolean {
    return Boolean(this.botToken && this.botToken.length > 15);
  }

  /**
   * Bitta Chat ID ga xabar yuborish
   */
  public async sendToChatId(
    chatId: string,
    text: string,
    keyboard?: Array<Array<{ text: string; url: string }>>
  ): Promise<boolean> {
    if (!this.isConfigured() || !chatId) {
      return false;
    }

    try {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };

      // Telegram faqat haqiqiy https:// URLlarni qabul qiladi (localhost qabul qilinmaydi)
      const isRealUrl = this.frontendUrl.startsWith('https://');
      if (keyboard && keyboard.length > 0 && isRealUrl) {
        payload.reply_markup = {
          inline_keyboard: keyboard,
        };
      }

      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as { ok: boolean; description?: string };
      if (!data.ok) {
        console.warn(`[TelegramService] Yuborishda xatolik (Chat ID: ${chatId}):`, data.description);
        return false;
      }

      return true;
    } catch (err) {
      console.warn(`[TelegramService] Tarmoq xatoligi (Chat ID: ${chatId}):`, err);
      return false;
    }
  }

  /**
   * User ID bo'yicha Telegram Chat ID sini topib xabar yuborish
   */
  public async sendToUser(
    userId: number,
    text: string,
    documentId?: number
  ): Promise<boolean> {
    if (!this.isConfigured()) return false;

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { telegramChatId: true, fullName: true, isActive: true },
      });

      if (!user || !user.isActive || !user.telegramChatId) {
        return false;
      }

      // Hujjat linkini xabar oxiriga qo'shamiz (har qanday URL uchun ishlaydi)
      let finalText = text;
      if (documentId) {
        const docUrl = `${this.frontendUrl}/dashboard/documents/${documentId}`;
        finalText += `\n\n🔗 ${docUrl}`;
      }

      // Inline keyboard faqat haqiqiy https:// URL uchun (Telegram talabi)
      const isRealUrl = this.frontendUrl.startsWith('https://');
      const keyboard =
        documentId && isRealUrl
          ? [[{ text: '📄 Hujjatni ochish', url: `${this.frontendUrl}/dashboard/documents/${documentId}` }]]
          : undefined;

      return await this.sendToChatId(user.telegramChatId, finalText, keyboard);
    } catch (err) {
      console.warn(`[TelegramService] User ${userId} ga xabar yuborishda xatolik:`, err);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // SHABLONLAR (PRE-BUILT TEMPLATES)
  // ─────────────────────────────────────────────

  /**
   * 1. Yangi tasdiqlash so'rovi (Approver uchun)
   */
  public async sendApprovalRequest(
    approverId: number,
    doc: {
      id: number;
      title: string;
      docNumber: string;
      creatorName?: string;
      creatorDepartment?: string | null;
      deadline?: Date | null;
      stepOrder?: number;
      totalSteps?: number;
    }
  ) {
    const stepText = doc.stepOrder && doc.totalSteps
      ? `\n🔢 <b>Bosqich:</b> ${doc.stepOrder} / ${doc.totalSteps}`
      : '';
    const deptText = doc.creatorDepartment ? ` · ${doc.creatorDepartment}` : '';
    const deadlineText = doc.deadline
      ? `\n⏱ <b>Tasdiqlash muddati:</b> ${new Date(doc.deadline).toLocaleDateString('uz-UZ')}`
      : '';

    const text =
      `⚡️ <b>Yangi tasdiqlash so'rovi keldi!</b>\n\n` +
      `📋 <b>Hujjat:</b> ${doc.title}\n` +
      `🔖 <b>Raqami:</b> #${doc.docNumber}\n` +
      `👤 <b>Yuboruvchi:</b> ${doc.creatorName || 'Boshqaruv'}${deptText}` +
      `${stepText}${deadlineText}\n\n` +
      `<i>Iltimos, hujjatni ko'rib chiqib, <b>TASDIQLANG</b> yoki <b>RAD ETING</b>.</i>`;

    await this.sendToUser(approverId, text, doc.id);
  }

  /**
   * 2. Yangi ijro topshirig'i (Executor uchun)
   */
  public async sendExecutionAssigned(
    executorId: number,
    doc: {
      id: number;
      title: string;
      docNumber: string;
      creatorName?: string;
      creatorDepartment?: string | null;
      deadline?: Date | null;
    }
  ) {
    const deptText = doc.creatorDepartment ? ` · ${doc.creatorDepartment}` : '';
    const deadlineText = doc.deadline
      ? `\n⏱ <b>Ijro muddati:</b> ${new Date(doc.deadline).toLocaleDateString('uz-UZ')}`
      : '';

    const text =
      `📥 <b>Sizga yangi hujjat ijroga berildi!</b>\n\n` +
      `📋 <b>Hujjat:</b> ${doc.title}\n` +
      `🔖 <b>Raqami:</b> #${doc.docNumber}\n` +
      `👤 <b>Biriktiruvchi:</b> ${doc.creatorName || 'Rahbariyat'}${deptText}` +
      `${deadlineText}\n\n` +
      `<i>⚠️ Belgilangan muddat ichida bajarib, <b>javob hisobotini yuklang</b>.</i>`;

    await this.sendToUser(executorId, text, doc.id);
  }

  /**
   * 3. Barcha bosqichlar tasdiqlandi (Creator uchun)
   */
  public async sendDocumentApproved(
    creatorId: number,
    doc: { id: number; title: string; docNumber: string; approvedBy?: string }
  ) {
    const approverText = doc.approvedBy ? `\n✅ <b>So'nggi tasdiqlovchi:</b> ${doc.approvedBy}` : '';

    const text =
      `✅ <b>Hujjatingiz to'liq tasdiqlandi!</b>\n\n` +
      `📋 <b>Hujjat:</b> ${doc.title}\n` +
      `🔖 <b>Raqami:</b> #${doc.docNumber}` +
      `${approverText}\n` +
      `📅 <b>Tasdiqlangan:</b> ${new Date().toLocaleDateString('uz-UZ')}\n\n` +
      `<i>Hujjat endi ijro bosqichida. Mas'ul ijrochi xabardor qilindi.</i>`;

    await this.sendToUser(creatorId, text, doc.id);
  }

  /**
   * 4. Hujjat rad etildi (Creator uchun)
   */
  public async sendDocumentRejected(
    creatorId: number,
    doc: {
      id: number;
      title: string;
      docNumber: string;
      rejectorName?: string;
      rejectorDepartment?: string | null;
      stepOrder?: number;
      reason?: string;
    }
  ) {
    const deptText = doc.rejectorDepartment ? ` · ${doc.rejectorDepartment}` : '';
    const stepText = doc.stepOrder ? `\n🔢 <b>Rad etilgan bosqich:</b> ${doc.stepOrder}-bosqich` : '';
    const reasonText = doc.reason
      ? `\n❌ <b>Rad etish sababi:</b>\n<i>${doc.reason}</i>`
      : '';

    const text =
      `🚫 <b>Hujjatingiz rad etildi!</b>\n\n` +
      `📋 <b>Hujjat:</b> ${doc.title}\n` +
      `🔖 <b>Raqami:</b> #${doc.docNumber}\n` +
      `👤 <b>Rad etuvchi:</b> ${doc.rejectorName || 'Tasdiqlovchi'}${deptText}` +
      `${stepText}${reasonText}\n\n` +
      `<i>Kamchiliklarni to'g'rilab, qayta yuborishingiz mumkin.</i>`;

    await this.sendToUser(creatorId, text, doc.id);
  }

  /**
   * 5. Ijro yakunlandi va javob xati keldi (Creator uchun)
   */
  public async sendExecutionCompleted(
    creatorId: number,
    doc: {
      id: number;
      title: string;
      docNumber: string;
      executorName?: string;
      executorDepartment?: string | null;
      note?: string;
      hasFile?: boolean;
    }
  ) {
    const deptText = doc.executorDepartment ? ` · ${doc.executorDepartment}` : '';
    const noteText = doc.note
      ? `\n📝 <b>Ijro izohi:</b>\n<i>${doc.note}</i>`
      : '';
    const fileText = doc.hasFile ? `\n📎 <b>Javob fayl(lar)i</b> biriktirildi` : '';

    const text =
      `📨 <b>Hujjat ijrosi yakunlandi!</b>\n\n` +
      `📋 <b>Hujjat:</b> ${doc.title}\n` +
      `🔖 <b>Raqami:</b> #${doc.docNumber}\n` +
      `👤 <b>Ijrochi:</b> ${doc.executorName || 'Xodim'}${deptText}\n` +
      `📅 <b>Yakunlangan:</b> ${new Date().toLocaleDateString('uz-UZ')}` +
      `${noteText}${fileText}\n\n` +
      `<i>Ijro hisoboti tizimga saqlandi. Natijani ko'rib chiqing.</i>`;

    await this.sendToUser(creatorId, text, doc.id);
  }

  /**
   * 6. Fayl ko'rildi (Creator uchun)
   */
  public async sendFileViewed(
    creatorId: number,
    doc: {
      id: number;
      title: string;
      docNumber: string;
      viewerName: string;
      viewerDepartment?: string | null;
      fileName: string;
    }
  ) {
    const deptText = doc.viewerDepartment ? ` · ${doc.viewerDepartment}` : '';
    const text =
      `👁 <b>Biriktirilgan fayl ko'rildi!</b>\n\n` +
      `👤 <b>Kim ko'rdi:</b> ${doc.viewerName}${deptText}\n` +
      `📋 <b>Hujjat:</b> ${doc.title} (#${doc.docNumber})\n` +
      `📎 <b>Fayl:</b> <i>${doc.fileName}</i>\n` +
      `🕐 <b>Vaqti:</b> ${new Date().toLocaleString('uz-UZ')}`;

    await this.sendToUser(creatorId, text, doc.id);
  }

  /**
   * 7. Muddat yaqinlashmoqda (24 soat qolganda)
   */
  public async sendDeadlineWarning(
    userId: number,
    doc: {
      id: number;
      title: string;
      docNumber: string;
      deadline: Date;
      role?: 'approver' | 'executor';
    }
  ) {
    const actionText =
      doc.role === 'executor'
        ? "Ijroni o'z vaqtida yakunlang"
        : "Hujjatni ko'rib chiqib, tasdiqlang yoki rad eting";

    const text =
      `⚠️ <b>DIQQAT: Muddat tugashiga 24 soatdan kam vaqt qoldi!</b>\n\n` +
      `📋 <b>Hujjat:</b> ${doc.title}\n` +
      `🔖 <b>Raqami:</b> #${doc.docNumber}\n` +
      `⏱ <b>Yakuniy muddat:</b> ${new Date(doc.deadline).toLocaleDateString('uz-UZ')}\n\n` +
      `<i>👉 ${actionText}.</i>`;

    await this.sendToUser(userId, text, doc.id);
  }

  /**
   * 8. Muddat o'tdi (Expired) — hujjat yoki bosqich
   */
  public async sendDeadlineExpired(
    userId: number,
    doc: {
      id: number;
      title: string;
      docNumber: string;
      role?: 'approver' | 'executor' | 'creator';
      stepOrder?: number;
    }
  ) {
    let roleText = '';
    if (doc.role === 'approver' && doc.stepOrder) {
      roleText = `\n⚠️ Siz ${doc.stepOrder}-bosqich tasdiqlovchisi sifatida tasdiqlashni amalga oshirmadingiz.`;
    } else if (doc.role === 'executor') {
      roleText = `\n⚠️ Ijro muddati o'tdi — tizim tomonidan hujjat muddati o'tgan holatiga o'tkazildi.`;
    } else {
      roleText = `\n⚠️ Belgilangan muddat ichida kerakli amal bajarilmadi.`;
    }

    const text =
      `❌ <b>Hujjat muddati o'tdi!</b>\n\n` +
      `📋 <b>Hujjat:</b> ${doc.title}\n` +
      `🔖 <b>Raqami:</b> #${doc.docNumber}` +
      `${roleText}\n\n` +
      `<i>Belgilangan muddat ichida kerakli amal bajarilmadi.</i>`;

    await this.sendToUser(userId, text, doc.id);
  }
}

export const telegramService = new TelegramService();
