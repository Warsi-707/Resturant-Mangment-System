import 'dotenv/config';
import dns from 'node:dns';

// Ensure DNS SRV records resolve cleanly on cloud/serverless environments
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignored
}

import { app } from '../backend/src/app.js';
import { connectDB } from '../backend/src/config/db.js';
import { ensureDefaultUsers } from '../backend/src/controllers/authController.js';

let isConnected = false;

// Export default serverless handler for Vercel
export default async function handler(req, res) {
  if (!isConnected && process.env.MONGODB_URI) {
    try {
      await connectDB();
      await ensureDefaultUsers().catch(() => {});
      isConnected = true;
    } catch (err) {
      console.error('[Vercel Serverless] DB connection error:', err.message);
    }
  }
  return app(req, res);
}
