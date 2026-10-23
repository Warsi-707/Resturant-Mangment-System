/**
 * User Repository
 * Connects system users and cashiers to Express REST API & MongoDB Atlas.
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

export const UserRepository = {
  getAll: async () => {
    if (isTestEnv()) {
      const saved = storage.get('rms_users_list', []);
      return Array.isArray(saved) ? saved : [];
    }

    try {
      const res = await api.get('/auth/users');
      if (res && res.success && Array.isArray(res.data)) {
        return res.data;
      }
    } catch (err) {
      console.warn('[UserRepository] Failed to fetch users from MongoDB:', err.message);
    }
    return [];
  },

  create: async (user) => {
    if (isTestEnv()) {
      const all = storage.get('rms_users_list', []) || [];
      const updated = [user, ...all];
      storage.set('rms_users_list', updated);
      return user;
    }

    const res = await api.post('/auth/users', user);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to create user in MongoDB');
  },

  update: async (id, updates) => {
    if (isTestEnv()) {
      const all = storage.get('rms_users_list', []) || [];
      const updated = all.map((u) => (u.id === id || u.username === id ? { ...u, ...updates } : u));
      storage.set('rms_users_list', updated);
      return updated.find((u) => u.id === id || u.username === id) || null;
    }

    const res = await api.put(`/auth/users/${id}`, updates);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to update user in MongoDB');
  },

  delete: async (id) => {
    if (isTestEnv()) {
      const all = storage.get('rms_users_list', []) || [];
      storage.set('rms_users_list', all.filter((u) => u.id !== id && u.username !== id));
      return true;
    }

    const res = await api.delete(`/auth/users/${id}`);
    return Boolean(res && res.success);
  },
};

export default UserRepository;
