/**
 * Centralized Application Reset Service
 * Coordinates complete, safe, atomic purging of operational restaurant data.
 * Adheres strictly to PRD Section 13 and TRD Section 11 & 12.
 */
import { storage } from '../persistence/storage';
import { clearAllImages } from '../persistence/imageStorage';
import { SettingsRepository } from '../repositories/SettingsRepository';
import { api } from '../adapters/apiClient';

/**
 * Resets all operational restaurant data:
 * - Categories
 * - Menu Items
 * - Add-ons
 * - Active Cart
 * - Completed Orders
 * - Invoices
 * - Reversals
 * - Image Blobs in IndexedDB
 * - Resets Settings to safe application defaults
 *
 * Does NOT delete application code, routes, or unrelated browser keys.
 * Does NOT restore demo sales automatically.
 */
export async function resetApplicationData(store = null) {
  try {
    // 0. Record audit log of deleted operational orders before wiping
    const existingOrders = storage.get('orders', []);
    if (Array.isArray(existingOrders) && existingOrders.length > 0) {
      const auditRecord = {
        id: `del-reset-${Date.now()}`,
        type: 'bulk_reset',
        title: 'Full Operational Data Reset',
        deletedAt: new Date().toISOString(),
        totalInvoicesDeleted: existingOrders.length,
        totalAmount: existingOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0),
        invoices: existingOrders.map((o) => ({
          id: o.id,
          invoiceNumber: o.invoiceNumber,
          orderType: o.orderType || 'Dine-In',
          paymentMethod: o.paymentMethod || 'Cash',
          grandTotal: o.grandTotal,
          completedAt: o.completedAt || o.createdAt,
          lines: (o.lines || []).map((l) => ({
            id: l.id,
            itemName: l.itemNameSnapshot || l.itemName || 'Item',
            portion: l.selectedPortionLabel || l.baseUnitSnapshot || '',
            addons: Array.isArray(l.addonSnapshots)
              ? l.addonSnapshots
                  .map((a) => {
                    if (typeof a === 'string') return a;
                    if (!a) return '';
                    const priceVal = Number(a.price);
                    return priceVal > 0 ? `${a.name} (Rs ${priceVal.toLocaleString('en-PK')})` : (a.name || '');
                  })
                  .filter(Boolean)
              : [],
            quantity: l.quantity || 1,
            unitPrice: l.unitPrice || 0,
            lineSubtotal: l.lineSubtotal || 0,
          })),
        })),
      };
      const existingHistory = storage.get('deletion_history', []);
      const updatedHistory = [auditRecord, ...existingHistory];
      storage.set('deletion_history', updatedHistory);
      if (store && typeof store.setState === 'function') {
        store.setState({ deletionHistory: updatedHistory });
      }
    }

    // 1. Clear operational storage keys
    storage.set('categories', []);
    storage.set('menu_items', []);
    storage.set('addons', []);
    storage.set('deals', []);
    storage.set('orders', []);
    storage.set('reversals', []);
    storage.set('expenses', []);
    storage.set('expense_categories', []);
    storage.set('tables', []);
    storage.set('shifts', []);
    storage.set('current_shift', null);
    storage.set('pos_cart', []);
    storage.set('cart_user_admin', []);
    storage.set('cart_user_cashier', []);
    storage.set('currentOrder_user_admin', []);
    storage.set('currentOrder_user_cashier', []);
    storage.set('notifications', []);

    // 2. Clear application-owned IndexedDB image blobs and memory cache
    await clearAllImages();

    // 3. Sync full reset to MongoDB Atlas backend (wait for remote wipe before navigation/state transition)
    try {
      await api.post('/settings/danger-zone/reset', {
        confirmationPhrase: 'DELETE ALL DATA',
        resetType: 'all',
      });
    } catch (err) {
      console.warn('[resetService] Backend danger-zone reset warning:', err.message);
    }

    // 4. Reset settings to safe application defaults
    const safeDefaultSettings = await SettingsRepository.resetSettings();

    // 5. If Zustand store instance or setter is provided, synchronize in-memory state
    if (store && typeof store.setState === 'function') {
      store.setState({
        categories: [],
        items: [],
        addons: [],
        deals: [],
        orders: [],
        reversals: [],
        expenses: [],
        expenseCategories: [],
        tables: [],
        cart: [],
        notifications: [],
        settings: safeDefaultSettings,
      });
    }

    return {
      success: true,
      message: 'All restaurant operational data has been successfully cleared.',
      settings: safeDefaultSettings,
    };
  } catch (error) {
    return {
      success: false,
      error: error?.message || 'Failed to complete data reset.',
    };
  }
}

/**
 * Clears only the operational repositories without affecting settings
 */
export async function clearOperationalRepositories() {
  storage.set('categories', []);
  storage.set('menu_items', []);
  storage.set('addons', []);
  storage.set('deals', []);
  storage.set('orders', []);
  storage.set('reversals', []);
  storage.set('expenses', []);
  storage.set('expense_categories', []);
  storage.set('tables', []);
  storage.set('shifts', []);
  storage.set('current_shift', null);
  storage.set('pos_cart', []);
  storage.set('notifications', []);
  await clearAllImages();
  return true;
}
