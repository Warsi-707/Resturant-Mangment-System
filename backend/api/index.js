import 'dotenv/config';
import dns from 'node:dns';

// Ensure DNS SRV records resolve cleanly on cloud/serverless environments
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignored
}

import { app } from '../src/app.js';
import { connectDB, isDbConnected } from '../src/config/db.js';
import { bootstrapDatabase } from '../src/config/bootstrap.js';
import { ensureDefaultUsers } from '../src/controllers/authController.js';

let isBootstrapped = false;

// Export default serverless handler for Vercel
export default async function handler(req, res) {
  if (!isDbConnected()) {
    try {
      await connectDB();
      if (!isBootstrapped) {
        await bootstrapDatabase().catch(() => {});
        await ensureDefaultUsers().catch(() => {});
        isBootstrapped = true;
      }
    } catch (err) {
      console.error('Serverless DB connection error:', err.message);
    }
  }
  return app(req, res);
}

