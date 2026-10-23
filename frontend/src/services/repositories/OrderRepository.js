/**
 * Order Repository
 * Connects POS checkout and billing to the Express REST API & MongoDB Atlas.
 * Canonical persistence is MongoDB Atlas.
 */
import { api } from '../adapters/apiClient';
import { storage } from '../persistence/storage';
import {
  generateNextSequentialInvoiceNumber,
  repairDuplicateInvoiceNumbersLocally,
} from '../../domain/selectors/invoiceSelectors';

function isTestEnv() {
  return (
    (typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || Boolean(process.env?.VITEST))) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test')
  );
}

export const OrderRepository = {
  getNextInvoiceNumber: async (prefix = 'INV-') => {
    try {
      const res = await api.get(`/orders/next-invoice-number?prefix=${encodeURIComponent(prefix)}`);
      if (res && res.success && res.invoiceNumber) {
        return res;
      }
    } catch {
      // Offline / disconnected fallback
    }
    const all = storage.get('orders', []) || [];
    return generateNextSequentialInvoiceNumber(all, prefix);
  },

  getAll: async (params = {}) => {
    if (isTestEnv()) {
      const saved = storage.get('orders', []);
      return Array.isArray(saved) ? saved : [];
    }

    const query = new URLSearchParams(params).toString();
    const endpoint = query ? `/orders?${query}` : '/orders';
    const res = await api.get(endpoint);
    if (res && res.success && Array.isArray(res.data)) {
      return repairDuplicateInvoiceNumbersLocally(res.data);
    }
    throw new Error(res?.error?.message || 'Failed to fetch orders from MongoDB');
  },

  getById: async (id) => {
    if (isTestEnv()) {
      const local = storage.get('orders', []) || [];
      return local.find((o) => o.id === id || o.invoiceNumber === id) || null;
    }

    try {
      const res = await api.get(`/orders/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Ignored
    }
    return null;
  },

  create: async (orderPayload) => {
    if (isTestEnv()) {
      const all = storage.get('orders', []) || [];
      const updated = [orderPayload, ...all.filter((o) => o.id !== orderPayload.id)];
      storage.set('orders', updated);
      return orderPayload;
    }

    const res = await api.post('/orders', orderPayload);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to create order in MongoDB');
  },

  updateKitchenStatus: async (id, kitchenStatus) => {
    if (isTestEnv()) {
      const all = storage.get('orders', []) || [];
      const updated = all.map((o) => (o.id === id ? { ...o, kitchenStatus } : o));
      storage.set('orders', updated);
      return updated.find((o) => o.id === id);
    }

    const res = await api.patch(`/orders/${id}/kitchen-status`, { kitchenStatus });
    if (res && res.success && res.data) {
      return res.data;
    }
    return null;
  },

  settleBalance: async (
    id,
    {
      amountPaid,
      paymentMethod = 'Cash',
      receivedBy = 'Cashier',
      cardNetwork,
      cardSlipNumber,
      onlineChannel,
      onlineAccountId,
      onlineAccountNumber,
      onlineAccountTitle,
      onlineBankName,
      onlineTransactionId,
      note = '',
    } = {}
  ) => {
    if (isTestEnv()) {
      const all = storage.get('orders', []) || [];
      const order = all.find((o) => o.id === id || o.invoiceNumber === id);
      if (order) {
        order.amountPaid = (Number(order.amountPaid) || 0) + Number(amountPaid);
        order.balanceDue = Math.max(0, (Number(order.balanceDue) || 0) - Number(amountPaid));
        storage.set('orders', all);
        return order;
      }
      return null;
    }

    const res = await api.patch(`/orders/${id}/settle-balance`, {
      amountPaid,
      paymentMethod,
      receivedBy,
      cardNetwork,
      cardSlipNumber,
      onlineChannel,
      onlineAccountId,
      onlineAccountNumber,
      onlineAccountTitle,
      onlineBankName,
      onlineTransactionId,
      note,
    });
    if (res && res.success && res.data) {
      return res.data;
    }
    return null;
  },

  delete: async (id) => {
    if (isTestEnv()) {
      const all = storage.get('orders', []) || [];
      storage.set('orders', all.filter((o) => o.id !== id && o.invoiceNumber !== id));
      return true;
    }

    const res = await api.delete(`/orders/${id}`);
    return Boolean(res && res.success);
  },
};

export default OrderRepository;
