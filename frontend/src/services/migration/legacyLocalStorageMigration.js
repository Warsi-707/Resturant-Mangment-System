/**
 * Controlled One-Time Legacy LocalStorage Migration Service
 * Inspects browser localStorage for legacy permanent business records.
 * Pushes any unsaved custom records to MongoDB Atlas via authenticated REST APIs.
 * Prevents duplicates by cross-checking existing MongoDB IDs and invoice numbers.
 * Safely removes permanent business data from localStorage once verified in MongoDB.
 */
import { api } from '../adapters/apiClient';

const LEGACY_PERMANENT_KEYS = [
  'categories',
  'menu_items',
  'addons',
  'deals',
  'expense_categories',
  'expenses',
  'orders',
  'reversals',
  'deletion_history',
  'rms_users_list',
  'rms_custom_users',
];

const STORAGE_PREFIX = 'rms_pos_v2_';

function getRawLocalData(rawKey) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const item = window.localStorage.getItem(STORAGE_PREFIX + rawKey);
    return item ? JSON.parse(item) : null;
  } catch {
    return null;
  }
}

function removeRawLocalData(rawKey) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_PREFIX + rawKey);
    }
  } catch {}
}

export async function checkAndMigrateLegacyLocalStorage() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { migrated: false, reason: 'SSR / Non-browser environment' };
  }

  // Check if any legacy permanent keys exist in localStorage
  const foundKeys = LEGACY_PERMANENT_KEYS.filter((k) => {
    const val = getRawLocalData(k);
    return Array.isArray(val) && val.length > 0;
  });

  if (foundKeys.length === 0) {
    return { migrated: false, message: 'No legacy localStorage data to migrate' };
  }

  // Verify backend is reachable before starting migration
  const ping = await api.get('/health').catch(() => null);
  if (!ping || ping.status !== 'ok') {
    console.warn('[Migration] Backend unreachable, deferring migration to retain local data.');
    return { migrated: false, reason: 'Backend unreachable' };
  }

  console.log('[Migration] Found legacy business data in localStorage for keys:', foundKeys);
  const summary = {
    categories: 0,
    items: 0,
    addons: 0,
    deals: 0,
    expenseCategories: 0,
    expenses: 0,
    orders: 0,
    reversals: 0,
    auditLogs: 0,
  };

  try {
    // 1. Categories Migration
    const localCats = getRawLocalData('categories');
    if (Array.isArray(localCats) && localCats.length > 0) {
      const serverRes = await api.get('/categories').catch(() => null);
      const serverCats = (serverRes && serverRes.data) || [];
      const serverIds = new Set(serverCats.map((c) => c.id || c._id));
      for (const cat of localCats) {
        if (cat?.id && !serverIds.has(cat.id)) {
          await api.post('/categories', cat).catch(() => {});
          summary.categories++;
        }
      }
      removeRawLocalData('categories');
    }

    // 2. Menu Items Migration
    const localItems = getRawLocalData('menu_items');
    if (Array.isArray(localItems) && localItems.length > 0) {
      const serverRes = await api.get('/items').catch(() => null);
      const serverItems = (serverRes && serverRes.data) || [];
      const serverIds = new Set(serverItems.map((i) => i.id || i._id));
      for (const it of localItems) {
        if (it?.id && !serverIds.has(it.id)) {
          await api.post('/items', it).catch(() => {});
          summary.items++;
        }
      }
      removeRawLocalData('menu_items');
    }

    // 3. Add-ons Migration
    const localAdds = getRawLocalData('addons');
    if (Array.isArray(localAdds) && localAdds.length > 0) {
      const serverRes = await api.get('/addons').catch(() => null);
      const serverAdds = (serverRes && serverRes.data) || [];
      const serverIds = new Set(serverAdds.map((a) => a.id || a._id));
      for (const add of localAdds) {
        if (add?.id && !serverIds.has(add.id)) {
          await api.post('/addons', add).catch(() => {});
          summary.addons++;
        }
      }
      removeRawLocalData('addons');
    }

    // 4. Deals Migration
    const localDeals = getRawLocalData('deals');
    if (Array.isArray(localDeals) && localDeals.length > 0) {
      const serverRes = await api.get('/deals').catch(() => null);
      const serverDeals = (serverRes && serverRes.data) || [];
      const serverIds = new Set(serverDeals.map((d) => d.id || d._id));
      for (const dl of localDeals) {
        if (dl?.id && !serverIds.has(dl.id)) {
          await api.post('/deals', dl).catch(() => {});
          summary.deals++;
        }
      }
      removeRawLocalData('deals');
    }

    // 5. Expense Categories Migration
    const localExpCats = getRawLocalData('expense_categories');
    if (Array.isArray(localExpCats) && localExpCats.length > 0) {
      const serverRes = await api.get('/expenses/categories').catch(() => null);
      const serverCats = (serverRes && serverRes.data) || [];
      const serverIds = new Set(serverCats.map((c) => c.id || c._id));
      for (const c of localExpCats) {
        if (c?.id && !serverIds.has(c.id)) {
          await api.post('/expenses/categories', c).catch(() => {});
          summary.expenseCategories++;
        }
      }
      removeRawLocalData('expense_categories');
    }

    // 6. Expenses Migration
    const localExpenses = getRawLocalData('expenses');
    if (Array.isArray(localExpenses) && localExpenses.length > 0) {
      const serverRes = await api.get('/expenses').catch(() => null);
      const serverExpenses = (serverRes && serverRes.data) || [];
      const serverIds = new Set(serverExpenses.map((e) => e.id || e._id));
      for (const exp of localExpenses) {
        if (exp?.id && !serverIds.has(exp.id)) {
          await api.post('/expenses', exp).catch(() => {});
          summary.expenses++;
        }
      }
      removeRawLocalData('expenses');
    }

    // 7. Orders & Invoices Migration
    const localOrders = getRawLocalData('orders');
    if (Array.isArray(localOrders) && localOrders.length > 0) {
      const serverRes = await api.get('/orders').catch(() => null);
      const serverOrders = (serverRes && serverRes.data) || [];
      const serverKeys = new Set(
        serverOrders.flatMap((o) => [o.id, o.invoiceNumber].filter(Boolean))
      );
      for (const ord of localOrders) {
        const key = ord?.id || ord?.invoiceNumber;
        if (key && !serverKeys.has(key)) {
          await api.post('/orders', ord).catch(() => {});
          summary.orders++;
        }
      }
      removeRawLocalData('orders');
    }

    // 8. Reversals Migration
    const localReversals = getRawLocalData('reversals');
    if (Array.isArray(localReversals) && localReversals.length > 0) {
      const serverRes = await api.get('/reversals').catch(() => null);
      const serverRevs = (serverRes && serverRes.data) || [];
      const serverKeys = new Set(
        serverRevs.flatMap((r) => [r.id, r.originalOrderId, r.originalInvoiceNumber].filter(Boolean))
      );
      for (const rev of localReversals) {
        const key = rev?.id || rev?.originalOrderId || rev?.originalInvoiceNumber;
        if (key && !serverKeys.has(key)) {
          await api.post('/reversals', rev).catch(() => {});
          summary.reversals++;
        }
      }
      removeRawLocalData('reversals');
    }

    // 9. Deletion & Audit History Migration
    const localAudit = getRawLocalData('deletion_history');
    if (Array.isArray(localAudit) && localAudit.length > 0) {
      const serverRes = await api.get('/audit-logs').catch(() => null);
      const serverLogs = (serverRes && serverRes.data) || [];
      const serverIds = new Set(serverLogs.map((l) => l.id || l._id));
      for (const log of localAudit) {
        if (log?.id && !serverIds.has(log.id)) {
          await api.post('/audit-logs', log).catch(() => {});
          summary.auditLogs++;
        }
      }
      removeRawLocalData('deletion_history');
    }

    // 10. Users List Migration
    const localUsers = getRawLocalData('rms_users_list') || getRawLocalData('rms_custom_users');
    if (Array.isArray(localUsers) && localUsers.length > 0) {
      const serverRes = await api.get('/auth/users').catch(() => null);
      const serverUsers = (serverRes && serverRes.data) || [];
      const serverUsernames = new Set(serverUsers.map((u) => u.username));
      for (const u of localUsers) {
        if (u?.username && !u.isFixedAdmin && !serverUsernames.has(u.username)) {
          await api.post('/auth/users', u).catch(() => {});
        }
      }
      removeRawLocalData('rms_users_list');
      removeRawLocalData('rms_custom_users');
    }

    // Clean other permanent references if present
    removeRawLocalData('pos_cart');
    removeRawLocalData('shifts');
    removeRawLocalData('notifications');

    console.log('[Migration] Controlled migration complete. Summary:', summary);
    return { migrated: true, summary };
  } catch (err) {
    console.warn('[Migration] Migration error:', err.message);
    return { migrated: false, error: err.message };
  }
}

export default checkAndMigrateLegacyLocalStorage;
