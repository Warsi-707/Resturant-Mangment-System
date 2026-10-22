/**
 * Deal Repository
 * Decouples Deal persistence from React UI components.
 * Connects to Express REST API & MongoDB Atlas with local fallback.
 */
import { api } from '../adapters/apiClient';
import { storage } from '../persistence/storage';

const STORAGE_KEY = 'deals';

export const DealRepository = {
  getAll: async () => {
    try {
      const res = await api.get('/deals');
      if (res && res.success && Array.isArray(res.data)) {
        const local = storage.get(STORAGE_KEY, []) || [];
        const backendIds = new Set(res.data.map((d) => d.id));
        const unsynced = local.filter((loc) => loc?.id && !backendIds.has(loc.id));
        if (unsynced.length > 0) {
          for (const unsyncedDeal of unsynced) {
            api.post('/deals', unsyncedDeal).catch(() => {});
          }
        }
        const merged = [...res.data, ...unsynced];
        storage.set(STORAGE_KEY, merged);
        return merged;
      }
    } catch {
      // Backend offline fallback
    }

    const saved = storage.get(STORAGE_KEY, null);
    if (saved && Array.isArray(saved)) {
      return saved;
    }
    return [];
  },

  getById: async (id) => {
    const local = storage.get(STORAGE_KEY, []) || [];
    const foundLocal = Array.isArray(local) ? local.find((deal) => deal.id === id) : null;
    if (foundLocal) return foundLocal;

    try {
      const res = await api.get(`/deals/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Fallback
    }
    return null;
  },

  create: async (deal) => {
    try {
      const res = await api.post('/deals', deal);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch (err) {
      console.warn('[DealRepository] API create failed, using local storage:', err.message);
    }
    return deal;
  },

  update: async (id, updates) => {
    try {
      const res = await api.put(`/deals/${id}`, updates);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch (err) {
      console.warn('[DealRepository] API update failed, using local storage:', err.message);
    }
    return null;
  },

  delete: async (id) => {
    try {
      const res = await api.delete(`/deals/${id}`);
      return res && res.success;
    } catch (err) {
      console.warn('[DealRepository] API delete failed, using local storage:', err.message);
      return false;
    }
  },
};

export default DealRepository;
