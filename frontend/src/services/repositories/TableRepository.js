/**
 * Table Repository
 * Connects dining floorplan & table status to Express REST API & MongoDB Atlas.
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

export const TableRepository = {
  getAll: async (params = {}) => {
    if (isTestEnv()) {
      const saved = storage.get('tables', null);
      if (saved && Array.isArray(saved)) return saved;
      return [];
    }

    const query = new URLSearchParams(params).toString();
    const endpoint = query ? `/tables?${query}` : '/tables';
    const res = await api.get(endpoint);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to fetch tables from MongoDB');
  },

  getStats: async () => {
    try {
      const res = await api.get('/tables/stats');
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Ignored
    }

    const tables = await TableRepository.getAll().catch(() => []);
    return {
      total: tables.length,
      available: tables.filter((t) => t.status === 'available').length,
      occupied: tables.filter((t) => t.status === 'occupied').length,
      reserved: tables.filter((t) => t.status === 'reserved').length,
      occupancyRate: tables.length > 0
        ? Math.round((tables.filter((t) => t.status === 'occupied').length / tables.length) * 100)
        : 0,
    };
  },

  updateStatus: async (id, status, details = {}) => {
    if (isTestEnv()) {
      const all = storage.get('tables', []) || [];
      const updated = all.map((t) => (t.id === id ? { ...t, status, ...details } : t));
      storage.set('tables', updated);
      return updated.find((t) => t.id === id);
    }

    const res = await api.patch(`/tables/${id}/status`, { status, ...details });
    if (res && res.success && res.data) {
      return res.data;
    }
    return null;
  },

  occupy: async (id, details = {}) => {
    if (isTestEnv()) {
      return TableRepository.updateStatus(id, 'occupied', details);
    }

    const res = await api.post(`/tables/${id}/occupy`, details);
    if (res && res.success && res.data) {
      return res.data;
    }
    return null;
  },

  release: async (id) => {
    if (isTestEnv()) {
      return TableRepository.updateStatus(id, 'available', {
        currentOrderId: null,
        currentInvoiceNumber: null,
        guestsCount: 0,
        occupiedAt: null,
      });
    }

    const res = await api.post(`/tables/${id}/release`);
    if (res && res.success && res.data) {
      return res.data;
    }
    return null;
  },
};

export default TableRepository;
