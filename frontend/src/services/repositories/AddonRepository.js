/**
 * Add-on Repository
 * Decouples add-on persistence from React UI components.
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

export const AddonRepository = {
  getAll: async () => {
    if (isTestEnv()) {
      const saved = storage.get('addons', []) || [];
      return saved.map((a) => ({
        ...a,
        categoryIds: Array.isArray(a.categoryIds)
          ? a.categoryIds.filter((cid) => cid !== 'cat-biryani' && !String(cid).toLowerCase().includes('rice'))
          : [],
      }));
    }

    const res = await api.get('/addons');
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((a) => ({
        ...a,
        categoryIds: Array.isArray(a.categoryIds)
          ? a.categoryIds.filter((cid) => cid !== 'cat-biryani' && !String(cid).toLowerCase().includes('rice'))
          : [],
      }));
    }
    throw new Error(res?.error?.message || 'Failed to fetch addons from MongoDB');
  },

  getById: async (id) => {
    if (isTestEnv()) {
      const local = storage.get('addons', []) || [];
      return local.find((addon) => addon.id === id) || null;
    }

    try {
      const res = await api.get(`/addons/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Ignored
    }
    return null;
  },

  create: async (addon) => {
    if (isTestEnv()) {
      const all = storage.get('addons', []) || [];
      const newRecord = {
        ...addon,
        id: addon.id || `addon-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        createdAt: addon.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      storage.set('addons', [newRecord, ...all]);
      return newRecord;
    }

    const res = await api.post('/addons', addon);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to create addon in MongoDB');
  },

  update: async (id, data) => {
    if (isTestEnv()) {
      const all = storage.get('addons', []) || [];
      const updated = all.map((addon) =>
        addon.id === id ? { ...addon, ...data, updatedAt: new Date().toISOString() } : addon
      );
      storage.set('addons', updated);
      return updated.find((addon) => addon.id === id) || null;
    }

    const res = await api.put(`/addons/${id}`, data);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to update addon in MongoDB');
  },

  delete: async (id) => {
    if (isTestEnv()) {
      const all = storage.get('addons', []) || [];
      storage.set('addons', all.filter((addon) => addon.id !== id));
      return true;
    }

    const res = await api.delete(`/addons/${id}`);
    return Boolean(res && res.success);
  },
};

export default AddonRepository;
