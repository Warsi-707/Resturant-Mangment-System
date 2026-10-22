/**
 * Add-on Repository
 * Decouples add-on persistence from React UI components.
 * Connects to Express REST API & MongoDB Atlas with local fallback.
 */
import { api } from '../adapters/apiClient';
import { storage } from '../persistence/storage';

const STORAGE_KEY = 'addons';

export const AddonRepository = {
  getAll: async () => {
    try {
      const res = await api.get('/addons');
      if (res && res.success && Array.isArray(res.data)) {
        const sanitized = res.data.map((a) => ({
          ...a,
          categoryIds: Array.isArray(a.categoryIds)
            ? a.categoryIds.filter((cid) => cid !== 'cat-biryani' && !String(cid).toLowerCase().includes('rice'))
            : [],
        }));
        const local = storage.get(STORAGE_KEY, []) || [];
        const backendIds = new Set(sanitized.map((a) => a.id));
        const unsynced = local.filter((loc) => loc?.id && !backendIds.has(loc.id));
        if (unsynced.length > 0) {
          for (const unsyncedAddon of unsynced) {
            api.post('/addons', unsyncedAddon).catch(() => {});
          }
        }
        const merged = [...sanitized, ...unsynced];
        storage.set(STORAGE_KEY, merged);
        return merged;
      }
    } catch {
      // Backend offline fallback
    }

    const saved = storage.get(STORAGE_KEY, null);
    if (saved && Array.isArray(saved)) {
      const sanitized = saved.map((a) => ({
        ...a,
        categoryIds: Array.isArray(a.categoryIds)
          ? a.categoryIds.filter((cid) => cid !== 'cat-biryani' && !String(cid).toLowerCase().includes('rice'))
          : [],
      }));
      storage.set(STORAGE_KEY, sanitized);
      return sanitized;
    }
    return [];
  },

  getById: async (id) => {
    const local = storage.get(STORAGE_KEY, []) || [];
    const foundLocal = Array.isArray(local) ? local.find((addon) => addon.id === id) : null;
    if (foundLocal) return foundLocal;

    try {
      const res = await api.get(`/addons/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Fallback
    }
    return null;
  },

  create: async (addon) => {
    try {
      const res = await api.post('/addons', addon);
      if (res && res.success && res.data) {
        const all = storage.get(STORAGE_KEY, []) || [];
        const filtered = all.filter((a) => a.id !== res.data.id && a.id !== addon.id);
        const updated = [res.data, ...filtered];
        storage.set(STORAGE_KEY, updated);
        return res.data;
      }
    } catch (err) {
      console.warn('[AddonRepository] API create failed, using local storage:', err.message);
    }

    const all = storage.get(STORAGE_KEY, []) || [];
    const newRecord = {
      ...addon,
      id: addon.id || `addon-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      createdAt: addon.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [newRecord, ...all.filter((a) => a.id !== newRecord.id)];
    storage.set(STORAGE_KEY, updated);
    return newRecord;
  },

  update: async (id, data) => {
    try {
      const res = await api.put(`/addons/${id}`, data);
      if (res && res.success && res.data) {
        const all = storage.get(STORAGE_KEY, []) || [];
        const updated = all.map((addon) => (addon.id === id || addon.id === res.data.id ? res.data : addon));
        storage.set(STORAGE_KEY, updated);
        return res.data;
      }
    } catch (err) {
      console.warn('[AddonRepository] API update failed, using local storage:', err.message);
    }

    const all = storage.get(STORAGE_KEY, []) || [];
    const updated = all.map((addon) =>
      addon.id === id ? { ...addon, ...data, updatedAt: new Date().toISOString() } : addon
    );
    storage.set(STORAGE_KEY, updated);
    return updated.find((addon) => addon.id === id) || null;
  },

  delete: async (id) => {
    try {
      await api.delete(`/addons/${id}`);
    } catch (err) {
      console.warn('[AddonRepository] API delete failed, using local storage:', err.message);
    }

    const all = storage.get(STORAGE_KEY, []) || [];
    const filtered = all.filter((addon) => addon.id !== id);
    storage.set(STORAGE_KEY, filtered);
    return true;
  },
};

export default AddonRepository;
