import 'dotenv/config';
import dns from 'node:dns';

// Ensure DNS SRV records resolve cleanly on Windows & diverse ISP networks
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Silently ignore if not supported in environment
}

import { app } from './app.js';
import { connectDB } from './config/db.js';
import { bootstrapDatabase } from './config/bootstrap.js';
import { ensureDefaultUsers } from './controllers/authController.js';
import { repairDuplicateInvoiceNumbers } from './controllers/orderController.js';

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    try {
      await connectDB();
      await bootstrapDatabase().catch(() => {});
      await ensureDefaultUsers().catch(() => {});
      await repairDuplicateInvoiceNumbers().catch(() => {});
    } catch (err) {
      console.warn('⚠️ MongoDB connection deferred (running in resilient offline mode):', err.message);
    }

    const server = app.listen(PORT, () => {
      console.log(`🚀 RMS Backend Server running on http://localhost:${PORT}`);
      console.log(`📡 Health check available at http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Fatal server startup error:', error);
    process.exit(1);
  }
}

startServer();
