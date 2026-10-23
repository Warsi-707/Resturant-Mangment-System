import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { connectDB, isDbConnected } from './config/db.js';
import { bootstrapDatabase } from './config/bootstrap.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import categoryRoutes from './routes/categoryRoutes.js';
import itemRoutes from './routes/itemRoutes.js';
import addonRoutes from './routes/addonRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import reversalRoutes from './routes/reversalRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import expenseRoutes from './routes/expenseRoutes.js';
import tableRoutes from './routes/tableRoutes.js';
import shiftRoutes from './routes/shiftRoutes.js';
import authRoutes from './routes/authRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import dealRoutes from './routes/dealRoutes.js';
import auditLogRoutes from './routes/auditLogRoutes.js';

export const app = express();

// Security and compression middleware
app.use(helmet());
app.use(compression());

// Logger
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// CORS setup
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, serverless)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive in dev
    },
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Normalize path for Vercel Services rewrites (handles when /api is stripped by cloud router)
app.use((req, res, next) => {
  if (req.url && !req.url.startsWith('/api') && req.url !== '/' && req.url !== '') {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  next();
});

// Auto-connect MongoDB & bootstrap baseline data if disconnected
app.use(async (req, res, next) => {
  if (!isDbConnected()) {
    try {
      await connectDB();
      await bootstrapDatabase().catch(() => {});
    } catch (err) {
      console.warn('[MongoDB Middleware] Connection deferred:', err.message);
    }
  }
  next();
});

// Health Check Endpoint with Database Diagnostics
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'RMS Backend API',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: {
      connected: isDbConnected(),
      readyState: mongoose.connection.readyState,
    },
  });
});

// Root welcome endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Restaurant Management System API is running.',
    health: '/api/health',
  });
});

// Module API Routes
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/addons', addonRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reversals', reversalRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/audit-logs', auditLogRoutes);

// 404 & Global Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
