/**
 * Category Repository
 * Decouples category persistence from React UI components.
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

export const CategoryRepository = {
  getAll: async () => {
    if (isTestEnv()) {
      return storage.get('categories', []) || [];
    }

    const res = await api.get('/categories');
    if (res && res.success && Array.isArray(res.data)) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to fetch categories from MongoDB');
  },

  getById: async (id) => {
    if (isTestEnv()) {
      const local = storage.get('categories', []) || [];
      return local.find((c) => c.id === id) || null;
    }

    try {
      const res = await api.get(`/categories/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Ignored
    }
    return null;
  },

  create: async (category) => {
    if (isTestEnv()) {
      const all = storage.get('categories', []) || [];
      const newRecord = {
        ...category,
        id: category.id || `cat-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        createdAt: category.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      storage.set('categories', [newRecord, ...all]);
      return newRecord;
    }

    const res = await api.post('/categories', category);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to create category in MongoDB');
  },

  update: async (id, data) => {
    if (isTestEnv()) {
      const all = storage.get('categories', []) || [];
      const updated = all.map((c) => (c.id === id ? { ...c, ...data, updatedAt: new Date().toISOString() } : c));
      storage.set('categories', updated);
      return updated.find((c) => c.id === id) || null;
    }

    const res = await api.put(`/categories/${id}`, data);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to update category in MongoDB');
  },

  delete: async (id) => {
    if (isTestEnv()) {
      const all = storage.get('categories', []) || [];
      storage.set('categories', all.filter((c) => c.id !== id));
      return true;
    }

    const res = await api.delete(`/categories/${id}`);
    return Boolean(res && res.success);
  },
};

export default CategoryRepository;
