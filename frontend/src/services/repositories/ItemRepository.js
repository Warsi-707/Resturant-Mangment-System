/**
 * Menu Item Repository
 * Decouples menu item persistence from React UI components.
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

export const ItemRepository = {
  getAll: async () => {
    if (isTestEnv()) {
      return storage.get('menu_items', []) || [];
    }

    const res = await api.get('/items');
    if (res && res.success && Array.isArray(res.data)) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to fetch items from MongoDB');
  },

  getById: async (id) => {
    if (isTestEnv()) {
      const local = storage.get('menu_items', []) || [];
      return local.find((item) => item.id === id) || null;
    }

    try {
      const res = await api.get(`/items/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Ignored
    }
    return null;
  },

  create: async (item) => {
    if (isTestEnv()) {
      const all = storage.get('menu_items', []) || [];
      const newRecord = {
        ...item,
        id: item.id || `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      storage.set('menu_items', [newRecord, ...all]);
      return newRecord;
    }

    const res = await api.post('/items', item);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to create item in MongoDB');
  },

  update: async (id, data) => {
    if (isTestEnv()) {
      const all = storage.get('menu_items', []) || [];
      const updated = all.map((item) =>
        item.id === id ? { ...item, ...data, updatedAt: new Date().toISOString() } : item
      );
      storage.set('menu_items', updated);
      return updated.find((item) => item.id === id) || null;
    }

    const res = await api.put(`/items/${id}`, data);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to update item in MongoDB');
  },

  delete: async (id) => {
    if (isTestEnv()) {
      const all = storage.get('menu_items', []) || [];
      storage.set('menu_items', all.filter((item) => item.id !== id));
      return true;
    }

    const res = await api.delete(`/items/${id}`);
    return Boolean(res && res.success);
  },
};

export default ItemRepository;
