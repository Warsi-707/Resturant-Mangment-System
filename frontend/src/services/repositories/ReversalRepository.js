/**
 * Reversal Repository
 * Connects invoice reversals to the Express REST API & MongoDB Atlas.
 * Provides resilient offline fallback to local storage.
 */
import { api } from '../adapters/apiClient';
import { storage } from '../persistence/storage';

const STORAGE_KEY = 'reversals';

export const ReversalRepository = {
  getAll: async (params = {}) => {
    try {
      const query = new URLSearchParams(params).toString();
      const endpoint = query ? `/reversals?${query}` : '/reversals';
      const res = await api.get(endpoint);
      if (res && res.success && Array.isArray(res.data)) {
        const local = storage.get(STORAGE_KEY, []) || [];
        const backendKeys = new Set(res.data.map((r) => r.originalOrderId || r.originalInvoiceNumber || r.id));
        const unsynced = local.filter((r) => {
          const k = r.originalOrderId || r.originalInvoiceNumber || r.id;
          return k && !backendKeys.has(k);
        });
        if (unsynced.length > 0) {
          for (const unsyncedRev of unsynced) {
            api.post('/reversals', unsyncedRev).catch(() => {});
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
    if (saved && Array.isArray(saved)) return saved;
    return [];
  },

  getById: async (id) => {
    try {
      const res = await api.get(`/reversals/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Fallback
    }

    const all = await ReversalRepository.getAll();
    return all.find((r) => r.id === id) || null;
  },

  create: async (reversalPayload) => {
    const orderKey = reversalPayload.originalOrderId || reversalPayload.orderId;
    const invKey = reversalPayload.originalInvoiceNumber || reversalPayload.invoiceNumber;

    try {
      const res = await api.post('/reversals', reversalPayload);
      if (res && res.success && res.data) {
        const { reversal, order } = res.data;
        const allReversals = storage.get(STORAGE_KEY, []) || [];
        const filtered = allReversals.filter((r) => {
          if (r.id === reversal.id || r.id === reversalPayload.id) return false;
          if (orderKey && (r.originalOrderId === orderKey || r.orderId === orderKey)) return false;
          if (invKey && (r.originalInvoiceNumber === invKey || r.invoiceNumber === invKey)) return false;
          return true;
        });
        storage.set(STORAGE_KEY, [reversal, ...filtered]);

        // Update local orders cache status to 'reversed'
        const allOrders = storage.get('orders', []) || [];
        const updatedOrders = allOrders.map((o) =>
          o.id === order.id ? { ...o, status: 'reversed', reversalId: reversal.id } : o
        );
        storage.set('orders', updatedOrders);

        return reversal;
      }
    } catch (err) {
      console.warn('[ReversalRepository] Live API reversal failed, falling back to local storage:', err.message);
    }

    // Offline fallback
    const all = storage.get(STORAGE_KEY, []) || [];
    // If a reversal for this order is already in storage, do NOT add another duplicate
    const existing = all.find((r) => {
      if (r.id === reversalPayload.id) return true;
      if (orderKey && (r.originalOrderId === orderKey || r.orderId === orderKey)) return true;
      if (invKey && (r.originalInvoiceNumber === invKey || r.invoiceNumber === invKey)) return true;
      return false;
    });

    if (existing) {
      return existing;
    }

    const fallbackReversal = {
      ...reversalPayload,
      id: reversalPayload.id || `rev-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      reversedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    storage.set(STORAGE_KEY, [fallbackReversal, ...all]);

    const allOrders = storage.get('orders', []) || [];
    const updatedOrders = allOrders.map((o) =>
      (orderKey && (o.id === orderKey || o.invoiceNumber === invKey)) ||
      (invKey && o.invoiceNumber === invKey)
        ? { ...o, status: 'reversed', reversalId: fallbackReversal.id }
        : o
    );
    storage.set('orders', updatedOrders);

    return fallbackReversal;
  },
};

export default ReversalRepository;
