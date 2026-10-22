/**
 * Menu Item Repository
 * Decouples menu item persistence from React UI components.
 * Connects to Express REST API & MongoDB Atlas with local fallback.
 */
import { api } from '../adapters/apiClient';
import { storage } from '../persistence/storage';

const STORAGE_KEY = 'menu_items';

export const ItemRepository = {
  getAll: async () => {
    try {
      const res = await api.get('/items');
      if (res && res.success && Array.isArray(res.data)) {
        const local = storage.get(STORAGE_KEY, []) || [];
        const backendIds = new Set(res.data.map((i) => i.id));
        const unsynced = local.filter((loc) => loc?.id && !backendIds.has(loc.id));
        if (unsynced.length > 0) {
          for (const unsyncedItem of unsynced) {
            api.post('/items', unsyncedItem).catch(() => {});
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
    const foundLocal = Array.isArray(local) ? local.find((item) => item.id === id) : null;
    if (foundLocal) return foundLocal;

    try {
      const res = await api.get(`/items/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Fallback
    }
    return null;
  },

  create: async (item) => {
    try {
      const res = await api.post('/items', item);
      if (res && res.success && res.data) {
        const all = storage.get(STORAGE_KEY, []) || [];
        const filtered = all.filter((i) => i.id !== res.data.id && i.id !== item.id);
        const updated = [res.data, ...filtered];
        storage.set(STORAGE_KEY, updated);
        return res.data;
      }
    } catch (err) {
      console.warn('[ItemRepository] API create failed, using local storage:', err.message);
    }

    const all = storage.get(STORAGE_KEY, []) || [];
    const newRecord = {
      ...item,
      id: item.id || `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [newRecord, ...all.filter((i) => i.id !== newRecord.id)];
    storage.set(STORAGE_KEY, updated);
    return newRecord;
  },

  update: async (id, data) => {
    try {
      const res = await api.put(`/items/${id}`, data);
      if (res && res.success && res.data) {
        const all = storage.get(STORAGE_KEY, []) || [];
        const updated = all.map((item) => (item.id === id || item.id === res.data.id ? res.data : item));
        storage.set(STORAGE_KEY, updated);
        return res.data;
      }
    } catch (err) {
      console.warn('[ItemRepository] API update failed, using local storage:', err.message);
    }

    const all = storage.get(STORAGE_KEY, []) || [];
    const updated = all.map((item) =>
      item.id === id ? { ...item, ...data, updatedAt: new Date().toISOString() } : item
    );
    storage.set(STORAGE_KEY, updated);
    return updated.find((item) => item.id === id) || null;
  },

  delete: async (id) => {
    try {
      await api.delete(`/items/${id}`);
    } catch (err) {
      console.warn('[ItemRepository] API delete failed, using local storage:', err.message);
    }

    const all = storage.get(STORAGE_KEY, []) || [];
    const filtered = all.filter((item) => item.id !== id);
    storage.set(STORAGE_KEY, filtered);
    return true;
  },
};

export default ItemRepository;
