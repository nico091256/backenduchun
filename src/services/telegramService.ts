// Telegram bot integratsiyasi bekor qilingan (boshliq ko'rsatmasiga binoan)
export const telegramService = {
  isConfigured: () => false,
  sendToChatId: async () => false,
  sendToUser: async () => false,
  sendApprovalRequest: async () => false,
  sendDocumentApproved: async () => false,
  sendDocumentRejected: async () => false,
  sendExecutionAssigned: async () => false,
  sendExecutionCompleted: async () => false,
  sendDeadlineWarning: async () => false,
  sendDeadlineExpired: async () => false,
  sendFileViewed: async () => false,
};
