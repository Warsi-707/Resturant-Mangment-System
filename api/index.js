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
import { bootstrapDatabase } from '../backend/src/config/bootstrap.js';
import { ensureDefaultUsers } from '../backend/src/controllers/authController.js';

let isConnected = false;

// Export default serverless handler for Vercel
export default async function handler(req, res) {
  if (!isConnected) {
    try {
      await connectDB();
      await bootstrapDatabase().catch((err) => console.warn('[Serverless] bootstrap note:', err.message));
      await ensureDefaultUsers().catch((err) => console.warn('[Serverless] users note:', err.message));
      isConnected = true;
    } catch (err) {
      console.error('[Serverless DB] Connection error:', err.message);
    }
  }
  return app(req, res);
}
