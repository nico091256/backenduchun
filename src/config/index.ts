import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5050', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // CORS
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'fallback_jwt_secret_change_in_production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret_change_in_production',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  // File Upload
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB

  // Frontend
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',


  // Email Notification & IMAP Settings (Microsoft Office 365 / Outlook for Discover Invest)
  email: {
    smtpHost: process.env.SMTP_HOST || 'smtp.office365.com',
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER || process.env.GMAIL_USER || process.env.OFFICIAL_EMAIL_USER || 'info@di.uz',
    smtpPass: process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.OFFICIAL_EMAIL_PASS || 'Akfa12062021',

    gmail: {
      user: process.env.GMAIL_USER || '',
      pass: process.env.GMAIL_APP_PASSWORD || '',
      host: process.env.GMAIL_IMAP_HOST || 'imap.gmail.com',
      port: parseInt(process.env.GMAIL_IMAP_PORT || '993', 10),
    },
    yandex: {
      user: process.env.YANDEX_USER || '',
      pass: process.env.YANDEX_APP_PASSWORD || '',
      host: process.env.YANDEX_IMAP_HOST || 'imap.yandex.ru',
      port: parseInt(process.env.YANDEX_IMAP_PORT || '993', 10),
    },
    official: {
      user: process.env.OFFICIAL_EMAIL_USER || 'info@di.uz',
      pass: process.env.OFFICIAL_EMAIL_PASS || 'Akfa12062021',
      host: process.env.OFFICIAL_EMAIL_HOST || 'outlook.office365.com',
      port: parseInt(process.env.OFFICIAL_EMAIL_PORT || '993', 10),
    },
    checkCron: process.env.EMAIL_CHECK_CRON || '*/2 * * * *',
  }
};



