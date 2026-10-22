/**
 * Category Repository
 * Decouples category persistence from React UI components.
 * Connects to Express REST API & MongoDB Atlas with local fallback.
 */
import { api } from '../adapters/apiClient';
import { storage } from '../persistence/storage';

const STORAGE_KEY = 'categories';

export const CategoryRepository = {
  getAll: async () => {
    try {
      const res = await api.get('/categories');
      if (res && res.success && Array.isArray(res.data)) {
        const local = storage.get(STORAGE_KEY, []) || [];
        const backendIds = new Set(res.data.map((c) => c.id));
        const unsynced = local.filter((loc) => loc?.id && !backendIds.has(loc.id));
        if (unsynced.length > 0) {
          for (const unsyncedCat of unsynced) {
            api.post('/categories', unsyncedCat).catch(() => {});
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
    const foundLocal = Array.isArray(local) ? local.find((c) => c.id === id) : null;
    if (foundLocal) return foundLocal;

    try {
      const res = await api.get(`/categories/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Fallback
    }
    return null;
  },

  create: async (category) => {
    try {
      const res = await api.post('/categories', category);
      if (res && res.success && res.data) {
        const all = storage.get(STORAGE_KEY, []) || [];
        const filtered = all.filter((c) => c.id !== res.data.id && c.id !== category.id);
        const updated = [res.data, ...filtered];
        storage.set(STORAGE_KEY, updated);
        return res.data;
      }
    } catch (err) {
      console.warn('[CategoryRepository] API create failed, using local storage:', err.message);
    }

    const all = storage.get(STORAGE_KEY, []) || [];
    const newRecord = {
      ...category,
      id: category.id || `cat-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      createdAt: category.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [newRecord, ...all.filter((c) => c.id !== newRecord.id)];
    storage.set(STORAGE_KEY, updated);
    return newRecord;
  },

  update: async (id, data) => {
    try {
      const res = await api.put(`/categories/${id}`, data);
      if (res && res.success && res.data) {
        const all = storage.get(STORAGE_KEY, []) || [];
        const updated = all.map((c) => (c.id === id || c.id === res.data.id ? res.data : c));
        storage.set(STORAGE_KEY, updated);
        return res.data;
      }
    } catch (err) {
      console.warn('[CategoryRepository] API update failed, using local storage:', err.message);
    }

    const all = storage.get(STORAGE_KEY, []) || [];
    const updated = all.map((c) =>
      c.id === id ? { ...c, ...data, updatedAt: new Date().toISOString() } : c
    );
    storage.set(STORAGE_KEY, updated);
    return updated.find((c) => c.id === id) || null;
  },

  delete: async (id) => {
    try {
      await api.delete(`/categories/${id}`);
    } catch (err) {
      console.warn('[CategoryRepository] API delete failed, using local storage:', err.message);
    }

    const all = storage.get(STORAGE_KEY, []) || [];
    const filtered = all.filter((c) => c.id !== id);
    storage.set(STORAGE_KEY, filtered);
    return true;
  },
};

export default CategoryRepository;
