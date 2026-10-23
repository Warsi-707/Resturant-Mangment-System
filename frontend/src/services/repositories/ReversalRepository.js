/**
 * Reversal Repository
 * Connects invoice reversals to the Express REST API & MongoDB Atlas.
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

export const ReversalRepository = {
  getAll: async (params = {}) => {
    if (isTestEnv()) {
      const saved = storage.get('reversals', null);
      if (saved && Array.isArray(saved)) return saved;
      return [];
    }

    const query = new URLSearchParams(params).toString();
    const endpoint = query ? `/reversals?${query}` : '/reversals';
    const res = await api.get(endpoint);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to fetch reversals from MongoDB');
  },

  getById: async (id) => {
    if (isTestEnv()) {
      const local = storage.get('reversals', []) || [];
      return local.find((r) => r.id === id) || null;
    }

    try {
      const res = await api.get(`/reversals/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Ignored
    }
    return null;
  },

  create: async (reversalPayload) => {
    const orderKey = reversalPayload.originalOrderId || reversalPayload.orderId;
    const invKey = reversalPayload.originalInvoiceNumber || reversalPayload.invoiceNumber;

    if (isTestEnv()) {
      const all = storage.get('reversals', []) || [];
      const fallbackReversal = {
        ...reversalPayload,
        id: reversalPayload.id || `rev-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        reversedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      storage.set('reversals', [fallbackReversal, ...all]);

      const allOrders = storage.get('orders', []) || [];
      const updatedOrders = allOrders.map((o) =>
        (orderKey && (o.id === orderKey || o.invoiceNumber === invKey)) ||
        (invKey && o.invoiceNumber === invKey)
          ? { ...o, status: 'reversed', reversalId: fallbackReversal.id }
          : o
      );
      storage.set('orders', updatedOrders);

      return fallbackReversal;
    }

    const res = await api.post('/reversals', reversalPayload);
    if (res && res.success && res.data) {
      return res.data.reversal || res.data;
    }
    throw new Error(res?.error?.message || 'Failed to create reversal in MongoDB');
  },
};

export default ReversalRepository;
