/**
 * Order Repository
 * Connects POS checkout and billing to the Express REST API & MongoDB Atlas.
 * Provides resilient offline fallback to local storage.
 */
import { api } from '../adapters/apiClient';
import { storage } from '../persistence/storage';
import {
  generateNextSequentialInvoiceNumber,
  repairDuplicateInvoiceNumbersLocally,
} from '../../domain/selectors/invoiceSelectors';

const STORAGE_KEY = 'orders';

export const OrderRepository = {
  getNextInvoiceNumber: async (prefix = 'INV-') => {
    try {
      const res = await api.get(`/orders/next-invoice-number?prefix=${encodeURIComponent(prefix)}`);
      if (res && res.success && res.invoiceNumber) {
        return res;
      }
    } catch {
      // Server offline / disconnected fallback
    }
    const all = storage.get(STORAGE_KEY, []) || [];
    return generateNextSequentialInvoiceNumber(all, prefix);
  },
  getAll: async (params = {}) => {
    try {
      const query = new URLSearchParams(params).toString();
      const endpoint = query ? `/orders?${query}` : '/orders';
      const res = await api.get(endpoint);
      if (res && res.success && Array.isArray(res.data)) {
        const local = storage.get(STORAGE_KEY, []) || [];
        const backendKeys = new Set(res.data.map((o) => o.id || o.invoiceNumber));
        const unsynced = local.filter((o) => {
          const k = o.id || o.invoiceNumber;
          return k && !backendKeys.has(k);
        });

        // Automatically upload local orders that haven't reached the cloud backend yet
        if (unsynced.length > 0) {
          for (const unsyncedOrder of unsynced) {
            api.post('/orders', unsyncedOrder).catch(() => {});
          }
        }

        const merged = [...res.data, ...unsynced];
        const healed = repairDuplicateInvoiceNumbersLocally(merged);
        storage.set(STORAGE_KEY, healed);
        return healed;
      }
    } catch {
      // Backend offline fallback
    }

    const saved = storage.get(STORAGE_KEY, null);
    if (saved && Array.isArray(saved)) return saved;
    return [];
  },

  getById: async (id) => {
    const local = storage.get(STORAGE_KEY, []) || [];
    const foundLocal = Array.isArray(local)
      ? local.find((o) => o.id === id || o.invoiceNumber === id)
      : null;
    if (foundLocal) return foundLocal;

    try {
      const res = await api.get(`/orders/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Fallback
    }

    const all = await OrderRepository.getAll();
    return all.find((o) => o.id === id || o.invoiceNumber === id) || null;
  },

  create: async (orderPayload) => {
    try {
      const res = await api.post('/orders', orderPayload);
      if (res && res.success && res.data) {
        const all = storage.get(STORAGE_KEY, []) || [];
        let finalOrder = res.data;
        const otherOrders = all.filter((o) => o.id !== res.data.id && o.id !== orderPayload.id);
        const hasCollision = otherOrders.some((o) => o.invoiceNumber === res.data.invoiceNumber);
        if (hasCollision && orderPayload.invoiceNumber && !otherOrders.some((o) => o.invoiceNumber === orderPayload.invoiceNumber)) {
          finalOrder = { ...res.data, invoiceNumber: orderPayload.invoiceNumber, sequenceNumber: orderPayload.sequenceNumber };
        }
        const deduped = [finalOrder, ...otherOrders];
        const healed = repairDuplicateInvoiceNumbersLocally(deduped);
        storage.set(STORAGE_KEY, healed);
        return finalOrder;
      }
    } catch (err) {
      console.warn('[OrderRepository] Live API sync deferred, order safely stored locally:', err.message);
    }

    // Offline client fallback: Ensure order is in storage without duplicating
    const all = storage.get(STORAGE_KEY, []) || [];
    const exists = all.some(
      (o) =>
        (orderPayload.id && o.id === orderPayload.id) ||
        (orderPayload.invoiceNumber && o.invoiceNumber === orderPayload.invoiceNumber)
    );
    if (!exists) {
      storage.set(STORAGE_KEY, [orderPayload, ...all]);
    }
    return orderPayload;
  },

  updateKitchenStatus: async (id, kitchenStatus) => {
    try {
      const res = await api.patch(`/orders/${id}/kitchen-status`, { kitchenStatus });
      if (res && res.success && res.data) {
        const all = storage.get(STORAGE_KEY, []) || [];
        storage.set(STORAGE_KEY, all.map((o) => (o.id === id ? res.data : o)));
        return res.data;
      }
    } catch {
      // Fallback
    }

    const all = storage.get(STORAGE_KEY, []) || [];
    const updated = all.map((o) => (o.id === id ? { ...o, kitchenStatus } : o));
    storage.set(STORAGE_KEY, updated);
    return updated.find((o) => o.id === id);
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
    try {
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
        const all = storage.get(STORAGE_KEY, []) || [];
        storage.set(STORAGE_KEY, all.map((o) => (o.id === id || o.invoiceNumber === id ? res.data : o)));
        return res.data;
      }
    } catch (err) {
      console.warn('[OrderRepository] settleBalance live sync warning:', err.message);
    }
    return null;
  },
};

export default OrderRepository;
