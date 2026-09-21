import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// Routes
import authRoutes from './routes/authRoutes';
import documentRoutes from './routes/documentRoutes';
import approvalRoutes from './routes/approvalRoutes';
import userRoutes from './routes/userRoutes';
import notificationRoutes from './routes/notificationRoutes';
import adminRoutes from './routes/adminRoutes';
import kpiRoutes from './routes/kpiRoutes';

const app = express();

// ── Security Middleware ──────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(
  cors({
    origin: config.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Rate Limiting ────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 daqiqa
  max: process.env.NODE_ENV === 'development' ? 5000 : 500,
  message: { success: false, message: 'Juda ko\'p so\'rov. Keyinroq urinib ko\'ring.' },
  skip: () => process.env.NODE_ENV === 'development',
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 1000 : 10,
  message: { success: false, message: 'Juda ko\'p kirish urinishi.' },
  skip: () => process.env.NODE_ENV === 'development',
});

app.use(limiter);

// ── Parsing Middleware ───────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Logging ──────────────────────────────────────
if (config.nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

// ── Static Files (Uploads) ───────────────────────
app.use('/uploads', express.static(path.join(process.cwd(), config.uploadDir)));

// ── Health Check ─────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    success: true,
    message: 'BPM Backend API ishlayapti ✅',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ───────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/kpi', kpiRoutes);

// ── Error Handlers ───────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
