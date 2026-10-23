import 'dotenv/config';
import dns from 'node:dns';

// Ensure DNS SRV records resolve cleanly on cloud/serverless environments
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignored
}

import { app } from './src/app.js';
import { connectDB } from './src/config/db.js';
import { bootstrapDatabase } from './src/config/bootstrap.js';
import { ensureDefaultUsers } from './src/controllers/authController.js';

let isConnected = false;

// Auto-connect MongoDB on cloud/serverless requests
app.use(async (req, res, next) => {
  if (!isConnected) {
    try {
      await connectDB();
      await bootstrapDatabase().catch(() => {});
      await ensureDefaultUsers().catch(() => {});
      isConnected = true;
    } catch (err) {
      console.warn('[Vercel Serverless] MongoDB connection deferred:', err.message);
    }
  }
  next();
});

export default app;
