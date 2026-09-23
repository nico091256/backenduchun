import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';
import app from './app';
import { config } from './config';
import { prisma } from './utils/prisma';
import { execSync } from 'child_process';
import { deadlineService } from './services/deadlineService';
import { incomingEmailService } from './services/incomingEmailService';

const httpServer = createServer(app);



// ── Socket.io Setup ──────────────────────────────
export const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Socket.io foydalanuvchi xonalari
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Foydalanuvchi o'z xonasiga kiradi
  socket.on('join', (userId: number) => {
    socket.join(`user:${userId}`);
    console.log(`👤 User ${userId} joined room`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// Notification yuborish funksiyasi
export const sendSocketNotification = (userId: number, notification: object) => {
  io.to(`user:${userId}`).emit('notification', notification);
};

// ── Server Start ─────────────────────────────────
const startServer = async () => {
  try {
    // Railway / Production PostgreSQL ma'lumotlar bazasi ustunlarini avtomatik sinxronlash
    try {
      console.log('🔄 DB sxemasini avtomatik sinxronlash (prisma db push)...');
      execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
      console.log('✅ DB sxemasi muvaffaqiyatli sinxronlandi');
    } catch (dbSyncErr) {
      console.warn('⚠️ DB sxemasini sinxronlashda ogohlantirish:', dbSyncErr);
    }

    // DB ulanishini tekshirish
    await prisma.$connect();

    console.log('✅ PostgreSQL ulandi');

    // Deadline monitoring boshlash
    deadlineService.start();

    // Kiruvchi email xatlarini kuzatish (IMAP Cron)
    incomingEmailService.startCronJob();


    httpServer.listen(config.port, () => {
      console.log(`\n🚀 BPM Backend Server ishlamoqda:`);
      console.log(`   📡 http://localhost:${config.port}`);
      console.log(`   🔍 Health: http://localhost:${config.port}/health`);
      console.log(`   📁 Env: ${config.nodeEnv}\n`);
    });
  } catch (err) {
    console.error('❌ Server ishga tushirishda xatolik:', err);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('⏹️ Server to\'xtatilmoqda...');
  await prisma.$disconnect();
  process.exit(0);
});

startServer();
