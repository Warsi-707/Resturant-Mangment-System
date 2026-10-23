import mongoose from 'mongoose';
import dns from 'node:dns';

// Ensure DNS SRV records resolve cleanly across all ISP / Windows environments
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Silently ignore if not supported in environment
}

/**
 * Global MongoDB connection cache (essential for serverless/Vercel and local dev)
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://khuzaimaali_db_user:G9HhmuSnOAqR7xH8@rms0.kywbdnz.mongodb.net/restaurant_pos?retryWrites=true&w=majority';

  if (!uri) {
    console.warn('⚠️ MONGODB_URI is not defined in environment variables. Running in disconnected mode.');
    return null;
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    };

    cached.promise = mongoose.connect(uri, opts).then((mongooseInstance) => {
      console.log(`✅ Connected to MongoDB Atlas successfully! Database: ${mongooseInstance.connection.name}`);
      return mongooseInstance;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    console.error('❌ MongoDB Connection Error:', e.message);
    throw e;
  }

  return cached.conn;
}

export function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

