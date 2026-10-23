/**
 * Audit Log Repository
 * Connects deletion audit history to Express REST API & MongoDB Atlas.
 * Canonical persistence is MongoDB Atlas.
 */
import { api } from '../adapters/apiClient';
import { storage } from '../persistence/storage';

function isTestEnv() {
  return (
    (typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || Boolean(process.env?.VITEST))) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test')
  );
}

export const AuditLogRepository = {
  getAll: async () => {
    if (isTestEnv()) {
      const saved = storage.get('deletion_history', []);
      return Array.isArray(saved) ? saved : [];
    }

    try {
      const res = await api.get('/audit-logs');
      if (res && res.success && Array.isArray(res.data)) {
        return res.data;
      }
    } catch {
      // Ignored
    }
    return [];
  },

  create: async (auditEntry) => {
    if (isTestEnv()) {
      const all = storage.get('deletion_history', []) || [];
      const updated = [auditEntry, ...all];
      storage.set('deletion_history', updated);
      return auditEntry;
    }

    try {
      const res = await api.post('/audit-logs', auditEntry);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch (err) {
      console.warn('[AuditLogRepository] Failed to save audit log in MongoDB:', err.message);
    }
    return auditEntry;
  },

  clear: async () => {
    if (isTestEnv()) {
      storage.set('deletion_history', []);
      return true;
    }

    try {
      const res = await api.delete('/audit-logs');
      return Boolean(res && res.success);
    } catch (err) {
      console.warn('[AuditLogRepository] Failed to clear audit logs in MongoDB:', err.message);
      return false;
    }
  },
};

export default AuditLogRepository;
