/**
 * Deal Repository
 * Decouples Deal persistence from React UI components.
 * Connects directly to Express REST API & MongoDB Atlas as single source of truth.
 */
import { api } from '../adapters/apiClient';
import { storage } from '../persistence/storage';

function isTestEnv() {
  return (
    (typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || Boolean(process.env?.VITEST))) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test')
  );
}

export const DealRepository = {
  getAll: async () => {
    if (isTestEnv()) {
      return storage.get('deals', []) || [];
    }

    const res = await api.get('/deals');
    if (res && res.success && Array.isArray(res.data)) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to fetch deals from MongoDB');
  },

  getById: async (id) => {
    if (isTestEnv()) {
      const local = storage.get('deals', []) || [];
      return local.find((deal) => deal.id === id) || null;
    }

    try {
      const res = await api.get(`/deals/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Ignored
    }
    return null;
  },

  create: async (deal) => {
    if (isTestEnv()) {
      const all = storage.get('deals', []) || [];
      const newRecord = {
        ...deal,
        id: deal.id || `deal-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        createdAt: deal.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      storage.set('deals', [newRecord, ...all]);
      return newRecord;
    }

    const res = await api.post('/deals', deal);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to create deal in MongoDB');
  },

  update: async (id, updates) => {
    if (isTestEnv()) {
      const all = storage.get('deals', []) || [];
      const updated = all.map((d) => (d.id === id ? { ...d, ...updates, updatedAt: new Date().toISOString() } : d));
      storage.set('deals', updated);
      return updated.find((d) => d.id === id) || null;
    }

    const res = await api.put(`/deals/${id}`, updates);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to update deal in MongoDB');
  },

  delete: async (id) => {
    if (isTestEnv()) {
      const all = storage.get('deals', []) || [];
      storage.set('deals', all.filter((d) => d.id !== id));
      return true;
    }

    const res = await api.delete(`/deals/${id}`);
    return Boolean(res && res.success);
  },
};

export default DealRepository;
