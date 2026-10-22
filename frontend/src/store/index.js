import { create } from 'zustand';
import { storage } from '../services/persistence/storage';
import { clearAllImages } from '../services/persistence/imageStorage';
import {
  defaultSeedData,
  seedCategories,
  seedMenuItems,
  seedAddons,
} from '../services/mock/demoData';
import {
  getDefaultSettings,
  normalizeSettings,
  mergeSettings,
} from '../domain/rules/settingsRules';
import { healMiscategorizedItems } from '../domain/rules';
import {
  CategoryRepository,
  ItemRepository,
  AddonRepository,
  OrderRepository,
  ReversalRepository,
  ExpenseRepository,
  TableRepository,
  ShiftRepository,
  SettingsRepository,
  DealRepository,
} from '../services/repositories';
import {
  repairDuplicateInvoiceNumbersLocally,
  getUserCartStorageKey,
  isNotificationVisibleToUser,
  isCashierUser,
} from '../domain/selectors/invoiceSelectors';
import { getApiBaseUrl } from '../services/adapters/apiClient';

/**
 * Global RMS Store
 * Manages orders, reversals, date filters, and UI preferences.
 * Persists data to localStorage with fallback to default demo transactions.
 */
export const useAppStore = create((set, get) => ({
  // Active store profile
  currentStore: 'Chengxi Store',
  setCurrentStore: (store) => set({ currentStore: store }),

  // Settings
  settings: (() => {
    const saved = storage.get('settings', null);
    if (saved) return normalizeSettings(saved);
    const defaultSettings = getDefaultSettings();
    storage.set('settings', defaultSettings);
    return defaultSettings;
  })(),
  updateSettings: (updates) => {
    const current = get().settings;
    const merged = mergeSettings(current, updates);
    storage.set('settings', merged);
    set({
      settings: merged,
      orderType: merged?.pos?.defaultOrderType || merged?.defaultOrderType || get().orderType,
    });
    try {
      SettingsRepository.updateSettings(updates);
    } catch {
      // Fallback silently if offline or test environment
    }
    return merged;
  },

  // POS State
  orderType: (() => {
    const saved = storage.get('settings', null);
    return saved?.pos?.defaultOrderType || saved?.defaultOrderType || 'Dine-In';
  })(),
  setOrderType: (orderType) => set({ orderType }),
  isCartDrawerOpen: false,
  setCartDrawerOpen: (isOpen) => set({ isCartDrawerOpen: isOpen }),

  // POS Cart State - Scoped by logged-in user ID
  cart: (() => {
    const activeUser = storage.get('active_user', null);
    const token = storage.get('auth_token', null);
    const resolvedUser = activeUser || (token?.includes('cashier') ? { id: 'user_cashier' } : (token?.includes('admin') ? { id: 'user_admin' } : null));
    if (!resolvedUser) return [];
    const cartKey = getUserCartStorageKey(resolvedUser);
    const saved = storage.get(cartKey, null);
    if (Array.isArray(saved)) return saved;
    return [];
  })(),

  addToCart: (line) => {
    const existingIndex = get().cart.findIndex((c) => {
      if (line.isDeal) {
        return c.isDeal && (c.dealId === line.dealId || c.itemId === line.itemId);
      }
      if (c.isDeal) return false;
      if (c.itemId !== line.itemId) return false;
      if (c.pricingMode !== line.pricingMode) return false;
      if (c.selectedPortionLabel !== line.selectedPortionLabel) return false;
      if (c.selectedWeightGrams !== line.selectedWeightGrams) return false;
      if ((c.note || '') !== (line.note || '')) return false;

      const cAddonIds = (c.addonSnapshots || []).map((a) => `${a.id}:${a.quantity || 1}`).sort().join(',');
      const lineAddonIds = (line.addonSnapshots || []).map((a) => `${a.id}:${a.quantity || 1}`).sort().join(',');
      return cAddonIds === lineAddonIds;
    });

    let updated;
    if (existingIndex >= 0) {
      updated = get().cart.map((item, idx) => {
        if (idx === existingIndex) {
          const newQty = item.quantity + line.quantity;
          const newSubtotal = (Number(item.lineSubtotal) || 0) + (Number(line.lineSubtotal) || ((Number(item.unitPrice) || 0) * line.quantity));
          return {
            ...item,
            quantity: newQty,
            lineSubtotal: newSubtotal,
          };
        }
        return item;
      });
    } else {
      updated = [...get().cart, line];
    }

    const currentUser = get().user || storage.get('active_user', null);
    const cartKey = getUserCartStorageKey(currentUser);
    const uid = currentUser?.id || (currentUser?.username ? `user_${currentUser.username}` : 'guest');
    storage.set(cartKey, updated);
    storage.set(`currentOrder_${uid}`, updated);
    set({ cart: updated });
  },

  updateCartLineAddons: (lineId, addonSnapshots) => {
    const updated = get().cart.map((item) => {
      if (item.id === lineId) {
        const itemAddonTotal = Array.isArray(addonSnapshots)
          ? addonSnapshots.reduce(
              (sum, a) => sum + (Number(a.price) || 0) * (Number(a.quantity) || 1),
              0
            )
          : 0;
        const baseRate = Number(item.portionPrice ?? item.basePriceSnapshot ?? item.unitPrice ?? 0);
        const isFlat = item.addonsAreFlat !== false;
        const lineSubtotal = isFlat
          ? (baseRate * item.quantity) + itemAddonTotal
          : (baseRate + itemAddonTotal) * item.quantity;

        return {
          ...item,
          addonSnapshots,
          addonsTotal: itemAddonTotal,
          lineSubtotal,
        };
      }
      return item;
    });
    const currentUser = get().user || storage.get('active_user', null);
    const cartKey = getUserCartStorageKey(currentUser);
    const uid = currentUser?.id || (currentUser?.username ? `user_${currentUser.username}` : 'guest');
    storage.set(cartKey, updated);
    storage.set(`currentOrder_${uid}`, updated);
    set({ cart: updated });
  },

  updateCartLinePortion: (lineId, portion) => {
    const updated = get().cart.map((item) => {
      if (item.id === lineId) {
        let newPortionPrice = 0;
        if (portion.price !== undefined && portion.price !== null) {
          newPortionPrice = Number(portion.price) || 0;
        } else if (portion.grams && item.basePriceSnapshot) {
          newPortionPrice = Math.round((Number(item.basePriceSnapshot) * Number(portion.grams)) / 1000);
        } else {
          newPortionPrice = Number(item.basePriceSnapshot) || 0;
        }

        const itemAddonTotal = Array.isArray(item.addonSnapshots)
          ? item.addonSnapshots.reduce(
              (sum, a) => sum + (Number(a.price) || 0) * (Number(a.quantity) || 1),
              0
            )
          : Number(item.addonsTotal) || 0;
        const isFlat = item.addonsAreFlat !== false;
        const lineSubtotal = isFlat
          ? (newPortionPrice * item.quantity) + itemAddonTotal
          : (newPortionPrice + itemAddonTotal) * item.quantity;

        return {
          ...item,
          pricingMode: portion.pricingMode || (portion.grams ? 'weight' : item.pricingMode || 'portion'),
          selectedPortionLabel: portion.label,
          selectedWeightGrams: portion.grams || null,
          requiresPortionSelection: false,
          portionPrice: newPortionPrice,
          unitPrice: newPortionPrice,
          lineSubtotal,
        };
      }
      return item;
    });
    const currentUser = get().user || storage.get('active_user', null);
    const cartKey = getUserCartStorageKey(currentUser);
    const uid = currentUser?.id || (currentUser?.username ? `user_${currentUser.username}` : 'guest');
    storage.set(cartKey, updated);
    storage.set(`currentOrder_${uid}`, updated);
    set({ cart: updated });
  },

  updateCartLineCustomAmount: (lineId, enteredAmount) => {
    const updated = get().cart.map((item) => {
      if (item.id === lineId) {
        const amount = Math.max(0, Math.round(Number(enteredAmount) || 0));
        const basePrice = Number(item.basePriceSnapshot) || 0;
        const grams = basePrice > 0 ? Math.round((amount / basePrice) * 1000) : 0;

        const itemAddonTotal = Array.isArray(item.addonSnapshots)
          ? item.addonSnapshots.reduce(
              (sum, a) => sum + (Number(a.price) || 0) * (Number(a.quantity) || 1),
              0
            )
          : Number(item.addonsTotal) || 0;
        const isFlat = item.addonsAreFlat !== false;
        const lineSubtotal = isFlat
          ? (amount * item.quantity) + itemAddonTotal
          : (amount + itemAddonTotal) * item.quantity;

        return {
          ...item,
          pricingMode: 'amount',
          selectedPortionLabel: `Custom Rs ${amount} (${grams}g)`,
          selectedWeightGrams: grams,
          requiresPortionSelection: false,
          portionPrice: amount,
          unitPrice: amount,
          lineSubtotal,
        };
      }
      return item;
    });
    const currentUser = get().user || storage.get('active_user', null);
    const cartKey = getUserCartStorageKey(currentUser);
    const uid = currentUser?.id || (currentUser?.username ? `user_${currentUser.username}` : 'guest');
    storage.set(cartKey, updated);
    storage.set(`currentOrder_${uid}`, updated);
    set({ cart: updated });
  },

  updateCartQuantity: (lineId, delta) => {
    const updated = get().cart.map((item) => {
      if (item.id === lineId) {
        const nextQty = Math.max(1, item.quantity + delta);
        const itemAddonTotal = Array.isArray(item.addonSnapshots)
          ? item.addonSnapshots.reduce(
              (sum, a) => sum + (Number(a.price) || 0) * (Number(a.quantity) || 1),
              0
            )
          : Number(item.addonsTotal) || 0;
        const baseRate = Number(item.portionPrice ?? item.basePriceSnapshot ?? item.unitPrice ?? 0);
        const isFlat = item.addonsAreFlat !== false;
        const lineSubtotal = isFlat
          ? (baseRate * nextQty) + itemAddonTotal
          : (baseRate + itemAddonTotal) * nextQty;

        return {
          ...item,
          quantity: nextQty,
          lineSubtotal,
        };
      }
      return item;
    });
    const currentUser = get().user || storage.get('active_user', null);
    const cartKey = getUserCartStorageKey(currentUser);
    const uid = currentUser?.id || (currentUser?.username ? `user_${currentUser.username}` : 'guest');
    storage.set(cartKey, updated);
    storage.set(`currentOrder_${uid}`, updated);
    set({ cart: updated });
  },

  removeCartLine: (lineId) => {
    const updated = get().cart.filter((item) => item.id !== lineId);
    const currentUser = get().user || storage.get('active_user', null);
    const cartKey = getUserCartStorageKey(currentUser);
    const uid = currentUser?.id || (currentUser?.username ? `user_${currentUser.username}` : 'guest');
    storage.set(cartKey, updated);
    storage.set(`currentOrder_${uid}`, updated);
    set({ cart: updated });
  },

  clearCart: () => {
    const currentUser = get().user || storage.get('active_user', null);
    const cartKey = getUserCartStorageKey(currentUser);
    const uid = currentUser?.id || (currentUser?.username ? `user_${currentUser.username}` : 'guest');
    storage.set(cartKey, []);
    storage.set(`currentOrder_${uid}`, []);
    storage.set('pos_cart', []);
    const defType = get().settings?.pos?.defaultOrderType || get().settings?.defaultOrderType || 'Dine-In';
    set({ cart: [], orderType: defType });
  },

  // Active User Profile
  user: (() => {
    const defaultUserProfiles = {
      admin: {
        id: 'user_admin',
        name: 'John Holland',
        username: 'admin',
        email: 'admin@spicehub.pk',
        role: 'Admin Cashier',
        initials: 'JH',
        avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80',
      },
      cashier: {
        id: 'user_cashier',
        name: 'Cashier 1',
        username: 'cashier',
        email: 'cashier@spicehub.pk',
        role: 'Cashier',
        initials: 'C1',
        avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80',
      },
    };

    const saved = storage.get('active_user', null);
    if (saved && typeof saved === 'object') {
      if (!saved.initials && saved.name) {
        saved.initials =
          saved.name
            .split(' ')
            .filter(Boolean)
            .map((n) => n[0].toUpperCase())
            .slice(0, 2)
            .join('') || 'U';
      }
      return saved;
    }
    const token = storage.get('auth_token', null);
    if (token) {
      const profiles = storage.get('user_profiles', {});
      if (token.includes('cashier') && !token.includes('admin')) {
        return profiles.cashier || defaultUserProfiles.cashier;
      }
      return profiles.admin || defaultUserProfiles.admin;
    }
    return null;
  })(),

  // Authentication State
  token: storage.get('auth_token', null),
  isAuthenticated: Boolean(storage.get('auth_token', null)),

  login: async ({ usernameOrEmail, password }) => {
    const defaultUserProfiles = {
      admin: {
        id: 'user_admin',
        name: 'John Holland',
        username: 'admin',
        email: 'admin@spicehub.pk',
        role: 'Admin Cashier',
        initials: 'JH',
        avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80',
      },
      cashier: {
        id: 'user_cashier',
        name: 'Cashier 1',
        username: 'cashier',
        email: 'cashier@spicehub.pk',
        role: 'Cashier',
        initials: 'C1',
        avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80',
      },
    };

    const norm = (usernameOrEmail || '').trim().toLowerCase();
    const creds = storage.get('auth_credentials', {
      admin: '12345',
      cashier: '1234',
    });

    const isLocalAdminMatch =
      (norm === 'admin' || norm === 'admin@spicehub.pk') &&
      (password === creds.admin || password === 'admin123' || password === '12345');

    const isLocalCashierMatch =
      (norm === 'cashier' || norm === 'cashier@spicehub.pk') &&
      (password === creds.cashier || password === 'cashier123' || password === '1234');

    // Check provisioned custom users from User & Access Control
    const customUsers = storage.get('rms_custom_users', []);
    const customUser = customUsers.find(
      (u) =>
        (u.email?.toLowerCase().trim() === norm ||
          u.username?.toLowerCase().trim() === norm ||
          u.loginIdentifier?.toLowerCase().trim() === norm ||
          (u.phone && u.phone.trim() === norm) ||
          (u.fullName && u.fullName.toLowerCase().trim() === norm)) &&
        u.password === password
    );

    if (customUser) {
      if (customUser.status === 'deactivated' || customUser.isActive === false) {
        throw new Error('This cashier account is currently deactivated by the administrator.');
      }
      const isRoleAdmin =
        customUser.portalRole?.toLowerCase().includes('admin') ||
        customUser.role?.toLowerCase().includes('admin');
      const role = isRoleAdmin ? 'admin' : 'cashier';
      const roleTitle = customUser.officialTitle || customUser.portalRole || (isRoleAdmin ? 'Branch Administrator' : 'Cashier');
      const dummyToken = `jwt_${role}_custom_${Date.now()}`;

      const userObj = {
        id: customUser.id,
        username: customUser.username || customUser.email || customUser.loginIdentifier,
        email: customUser.email || customUser.loginIdentifier,
        role: roleTitle,
        name: customUser.fullName || customUser.name,
        branch: customUser.branchScope || 'Main Branch',
        phone: customUser.phone || '',
        avatarUrl: customUser.avatarUrl || '',
      };
      if (!userObj.initials && userObj.name) {
        userObj.initials =
          userObj.name
            .split(' ')
            .filter(Boolean)
            .map((n) => n[0].toUpperCase())
            .slice(0, 2)
            .join('') || 'U';
      }

      storage.set('auth_token', dummyToken);
      storage.set('active_user', userObj);

      const userCartKey = getUserCartStorageKey(userObj);
      const userCart = storage.get(userCartKey, []);

      set({
        token: dummyToken,
        user: userObj,
        isAuthenticated: true,
        cart: Array.isArray(userCart) ? userCart : [],
      });

      return { success: true };
    }

    // INSTANT LOCAL AUTHENTICATION (0ms latency, instant dashboard entrance)
    if (isLocalAdminMatch || isLocalCashierMatch) {
      const role = isLocalAdminMatch ? 'admin' : 'cashier';
      const roleTitle = isLocalAdminMatch ? 'Admin Cashier' : 'Cashier';
      const dummyToken = `jwt_${role}_${Date.now()}`;

      const profiles = storage.get('user_profiles', {});
      const existingProfile = profiles[role] || defaultUserProfiles[role];

      const userObj = {
        ...defaultUserProfiles[role],
        ...existingProfile,
        id: existingProfile.id || defaultUserProfiles[role].id,
        username: existingProfile.username || defaultUserProfiles[role].username,
        role: existingProfile.role || roleTitle,
        name: existingProfile.name || defaultUserProfiles[role].name,
      };
      if (!userObj.initials && userObj.name) {
        userObj.initials =
          userObj.name
            .split(' ')
            .filter(Boolean)
            .map((n) => n[0].toUpperCase())
            .slice(0, 2)
            .join('') || 'U';
      }

      storage.set('auth_token', dummyToken);
      storage.set('active_user', userObj);
      profiles[role] = userObj;
      storage.set('user_profiles', profiles);

      // Load user-scoped cart
      const userCartKey = getUserCartStorageKey(userObj);
      const userCart = storage.get(userCartKey, []);

      set({
        token: dummyToken,
        user: userObj,
        isAuthenticated: true,
        cart: Array.isArray(userCart) ? userCart : [],
      });

      // Background asynchronous token upgrade with backend (non-blocking)
      const baseUrl = getApiBaseUrl();
      fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail, password }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.success && data?.token) {
            storage.set('auth_token', data.token);
            if (data.user) {
              const currentProfiles = storage.get('user_profiles', {});
              const customProfile = currentProfiles[role] || {};
              const resolvedName =
                customProfile.name &&
                customProfile.name !== 'John Holland' &&
                customProfile.name !== 'Cashier 1'
                  ? customProfile.name
                  : (data.user.name || customProfile.name || userObj.name);

              const mergedUser = {
                ...userObj,
                ...data.user,
                name: resolvedName,
                role: customProfile.role || data.user.role || userObj.role,
                avatarUrl:
                  customProfile.avatarUrl !== undefined
                    ? customProfile.avatarUrl
                    : (data.user.avatarUrl || userObj.avatarUrl),
              };
              if (!mergedUser.initials && mergedUser.name) {
                mergedUser.initials =
                  mergedUser.name
                    .split(' ')
                    .filter(Boolean)
                    .map((n) => n[0].toUpperCase())
                    .slice(0, 2)
                    .join('') || 'U';
              }
              storage.set('active_user', mergedUser);
              currentProfiles[role] = mergedUser;
              storage.set('user_profiles', currentProfiles);
              set({
                token: data.token,
                user: mergedUser,
              });
            } else {
              set({ token: data.token });
            }
          }
        })
        .catch(() => {});

      return { success: true };
    }

    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail, password }),
      });
      const data = await response.json();
      if (data.success && data.token) {
        storage.set('auth_token', data.token);
        const role = isCashierUser(data.user) ? 'cashier' : 'admin';
        const userProfiles = storage.get('user_profiles', {});
        const customProfile = userProfiles[role] || {};
        const resolvedName =
          customProfile.name &&
          customProfile.name !== 'John Holland' &&
          customProfile.name !== 'Cashier 1'
            ? customProfile.name
            : (data.user?.name || customProfile.name || 'User');

        const finalUser = {
          ...customProfile,
          ...(data.user || {}),
          name: resolvedName,
        };
        if (!finalUser.initials && finalUser.name) {
          finalUser.initials =
            finalUser.name
              .split(' ')
              .filter(Boolean)
              .map((n) => n[0].toUpperCase())
              .slice(0, 2)
              .join('') || 'U';
        }
        storage.set('active_user', finalUser);
        userProfiles[role] = finalUser;
        storage.set('user_profiles', userProfiles);

        const userCartKey = getUserCartStorageKey(finalUser);
        const userCart = storage.get(userCartKey, []);

        set({
          token: data.token,
          user: finalUser,
          isAuthenticated: true,
          cart: Array.isArray(userCart) ? userCart : [],
        });
        return { success: true };
      }
      return { success: false, error: data.message || 'Invalid credentials' };
    } catch {
      return { success: false, error: 'Invalid username/email or password' };
    }
  },

  logout: async () => {
    try {
      const baseUrl = getApiBaseUrl();
      await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });
    } catch {
      // ignore
    }
    storage.remove('auth_token');
    storage.remove('active_user');
    storage.remove('pos_cart');
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      cart: [], // In-memory cart cleared immediately
    });
  },

  changePassword: async ({ targetRole, newPassword }) => {
    const role = (targetRole || 'admin').toLowerCase().trim();
    const creds = storage.get('auth_credentials', {
      admin: 'admin123',
      cashier: 'cashier123',
    });
    creds[role] = newPassword;
    storage.set('auth_credentials', creds);

    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/auth/change-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetRole: role, newPassword }),
      });
      const data = await response.json();
      return {
        success: data.success ?? true,
        message: data.message || `${role === 'admin' ? 'Admin' : 'Cashier'} password updated successfully.`,
      };
    } catch {
      return {
        success: true,
        message: `${role === 'admin' ? 'Admin' : 'Cashier'} password updated successfully.`,
      };
    }
  },

  updateUser: (updates) => {
    set((state) => {
      const updatedUser = { ...state.user, ...updates };
      if (!updatedUser.initials && updatedUser.name) {
        updatedUser.initials =
          updatedUser.name
            .split(' ')
            .filter(Boolean)
            .map((n) => n[0].toUpperCase())
            .slice(0, 2)
            .join('') || 'U';
      }

      // 1. Update active user session
      storage.set('active_user', updatedUser);

      // 2. Persist in user_profiles by role key so it never resets across logout/login
      const userKey = isCashierUser(updatedUser) ? 'cashier' : 'admin';
      const userProfiles = storage.get('user_profiles', {});
      userProfiles[userKey] = updatedUser;
      storage.set('user_profiles', userProfiles);

      // 3. Asynchronously sync to backend profile endpoint
      const baseUrl = getApiBaseUrl();
      fetch(`${baseUrl}/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        },
        body: JSON.stringify({
          id: updatedUser.id,
          username: updatedUser.username || userKey,
          name: updatedUser.name,
          role: updatedUser.role,
          avatarUrl: updatedUser.avatarUrl,
        }),
      }).catch(() => {});

      return { user: updatedUser };
    });
  },

  // Date Filter State for Dashboard & Reports
  datePreset: 'All Dates', // 'All Dates' | 'Today' | 'This Week' | 'This Month' | 'Custom'
  setDatePreset: (datePreset) => set({ datePreset }),

  customDateRange: {
    startDate: '',
    endDate: '',
  },
  setCustomDateRange: (customDateRange) => set({ customDateRange }),

  // Transaction Ledger (Canonical Orders & Reversals)
  orders: (() => {
    const saved = storage.get('orders', null);
    const catalogItems = storage.get('menu_items', seedMenuItems);
    const catalogAddons = storage.get('addons', seedAddons);
    const catalogDeals = storage.get('deals', []);

    const enrichOrderLines = (orderList) => {
      return (orderList || []).map((o) => {
        if (!Array.isArray(o.lines) || o.lines.length === 0) return o;
        let orderHasChange = false;
        const enrichedLines = o.lines.map((l) => {
          const qty = Math.max(1, Number(l.quantity || 1));
          const lineGross = Number(l.grossLineSale ?? l.lineSubtotal ?? (Number(l.unitPrice || 0) * qty));
          const allocatedDiscount = Number(l.allocatedDiscount || 0);
          const netRev = Number(l.netRevenue ?? Math.max(0, lineGross - allocatedDiscount));

          // 1. Precise Deal Line COGS & Profit Attribution
          const lineName = String(l.itemNameSnapshot || l.name || '').trim();
          const foundDeal = (catalogDeals || []).find(
            (d) =>
              d.id === l.dealId ||
              d.id === l.itemId ||
              (d.name && lineName && d.name.trim().toLowerCase() === lineName.toLowerCase()) ||
              (lineName.toLowerCase().includes('combo') && d.name && d.name.toLowerCase().includes('combo')) ||
              (lineName.toLowerCase().includes('deal') && d.name && d.name.toLowerCase().includes('deal'))
          );

          const isDeal = Boolean(
            l.isDeal ||
            l.pricingMode === 'deal' ||
            l.dealId ||
            (Array.isArray(l.includedItems) && l.includedItems.length > 0) ||
            foundDeal !== undefined ||
            lineName.toLowerCase().includes('deal') ||
            lineName.toLowerCase().includes('combo') ||
            l.categoryIdSnapshot === 'cat-deals' ||
            l.categoryNameSnapshot === 'Deals' ||
            l.categoryName === 'Deals'
          );

          if (isDeal) {
            const incItems = (Array.isArray(l.includedItems) && l.includedItems.length > 0)
              ? l.includedItems
              : (foundDeal?.includedItems || []);

            let dealUnitCost = 0;
            let hasDealCost = incItems.length > 0;
            incItems.forEach((inc) => {
              if (inc.costPrice !== undefined && inc.costPrice !== null && !isNaN(Number(inc.costPrice)) && Number(inc.costPrice) >= 0) {
                dealUnitCost += Number(inc.costPrice) * (Number(inc.quantity) || 1);
              } else {
                const catItem = (catalogItems || []).find(
                  (ci) => ci.id === inc.itemId || (ci.name && inc.name && ci.name.trim().toLowerCase() === inc.name.trim().toLowerCase())
                );
                if (catItem?.costPrice !== undefined && catItem?.costPrice !== null) {
                  dealUnitCost += Number(catItem.costPrice) * (Number(inc.quantity) || 1);
                } else {
                  hasDealCost = false;
                }
              }
            });

            const resolvedCost = hasDealCost && dealUnitCost > 0
              ? dealUnitCost
              : (l.costPriceSnapshot && Number(l.costPriceSnapshot) > 0 ? Number(l.costPriceSnapshot) : null);

            if (resolvedCost !== null) {
              const totalCOGS = resolvedCost * qty;
              const grossProfit = Math.round(netRev - totalCOGS);
              const margin = netRev > 0 ? Number(((grossProfit / netRev) * 100).toFixed(2)) : 0;
              orderHasChange = true;
              return {
                ...l,
                isDeal: true,
                dealId: l.dealId || foundDeal?.id || l.itemId,
                pricingMode: 'deal',
                categoryIdSnapshot: 'cat-deals',
                categoryNameSnapshot: 'Deals',
                includedItems: incItems,
                costPriceSnapshot: resolvedCost,
                itemCOGS: totalCOGS,
                addonCOGS: 0,
                totalCOGS,
                grossProfit,
                grossProfitMargin: margin,
                hasCost: true,
                hasCostPrice: true,
              };
            }
          }

          const activeCatalogItems = storage.get('menu_items', []) || [];
          const activeCatalogAddons = storage.get('addons', []) || [];
          const lookupItems = (Array.isArray(activeCatalogItems) && activeCatalogItems.length > 0)
            ? activeCatalogItems
            : (Array.isArray(catalogItems) ? catalogItems : []);
          const lookupAddons = (Array.isArray(activeCatalogAddons) && activeCatalogAddons.length > 0)
            ? activeCatalogAddons
            : (Array.isArray(catalogAddons) ? catalogAddons : []);

          const foundItem = lookupItems.find(
            (ci) =>
              ci &&
              (ci.id === l.itemId ||
                (ci.name && l.itemNameSnapshot && ci.name.trim().toLowerCase() === l.itemNameSnapshot.trim().toLowerCase()))
          );
          const hasCatalogCost =
            foundItem?.costPrice !== undefined &&
            foundItem?.costPrice !== null &&
            !isNaN(Number(foundItem.costPrice)) &&
            Number(foundItem.costPrice) >= 0;
          const isHeuristicFallback =
            Number(l.costPriceSnapshot) === Math.round(Number(l.unitPrice || 0) * 0.55);

          if (
            l.costPriceSnapshot !== undefined &&
            l.costPriceSnapshot !== null &&
            Number(l.costPriceSnapshot) > 0 &&
            l.itemCOGS !== undefined &&
            !isHeuristicFallback
          ) {
            return l;
          }
          orderHasChange = true;

          let itemCost = null;
          if (hasCatalogCost) {
            itemCost = Number(foundItem.costPrice);
          } else if (l.costPriceSnapshot && Number(l.costPriceSnapshot) > 0 && !isHeuristicFallback) {
            itemCost = Number(l.costPriceSnapshot);
          }

          const hasCost = itemCost !== null && !isNaN(itemCost) && itemCost >= 0;
          const isWeight = Boolean(
            l.pricingMode === 'portion' ||
            l.pricingMode === 'custom_weight' ||
            l.pricingMode === 'weight' ||
            l.selectedWeightGrams
          );
          let derivedGrams = Number(l.selectedWeightGrams) || 0;
          if (isWeight && derivedGrams <= 0) {
            const label = String(l.selectedPortionLabel || l.portion || l.baseUnitSnapshot || '').toLowerCase();
            if (label.includes('1kg') || label === '1 kg') derivedGrams = 1000;
            else if (label.match(/(\d+)\s*g/)) derivedGrams = Number(label.match(/(\d+)\s*g/)[1]);
            else if (label.includes('half')) derivedGrams = 500;
            else if (label.includes('quarter')) derivedGrams = 250;
            else derivedGrams = 1000;
          }
          let lineItemCOGS = hasCost ? itemCost * qty : null;
          if (hasCost && isWeight) {
            if (derivedGrams > 0) {
              lineItemCOGS = Math.round((derivedGrams / 1000) * itemCost * qty);
            } else if (l.unitPrice && foundItem?.basePrice) {
              const ratio = Math.min(1, Math.max(0.1, Number(l.unitPrice) / Number(foundItem.basePrice)));
              lineItemCOGS = Math.round(itemCost * ratio * qty);
            }
          }
          const rawAddons = l.addonSnapshots || l.addons || [];
          let lineAddonCOGS = 0;
          const enrichedAddons = rawAddons.map((a) => {
            if (a.costPrice !== undefined && a.costPrice !== null && Number(a.costPrice) > 0) {
              lineAddonCOGS += Number(a.costPrice) * (Number(a.quantity) || 1) * qty;
              return a;
            }
            const foundAddon = lookupAddons.find(
              (ca) =>
                ca.id === a.id ||
                (ca.name && a.name && ca.name.trim().toLowerCase() === a.name.trim().toLowerCase())
            );
            const aCost =
              foundAddon?.costPrice !== undefined && foundAddon?.costPrice !== null
                ? Number(foundAddon.costPrice)
                : 0;
            lineAddonCOGS += aCost * (Number(a.quantity) || 1) * qty;
            return { ...a, costPrice: aCost };
          });
          const totalCOGS = hasCost
            ? (lineItemCOGS + lineAddonCOGS)
            : (lineAddonCOGS > 0 ? lineAddonCOGS : null);
          const grossProfit = totalCOGS !== null ? Math.round(netRev - totalCOGS) : null;
          const margin = totalCOGS !== null && netRev > 0 ? Number(((grossProfit / netRev) * 100).toFixed(2)) : null;

          return {
            ...l,
            costPriceSnapshot: hasCost ? itemCost : null,
            itemCOGS: lineItemCOGS,
            addonCOGS: lineAddonCOGS,
            totalCOGS,
            addonSnapshots: enrichedAddons,
            grossProfit,
            grossProfitMargin: margin,
            hasCost,
            hasCostPrice: hasCost,
          };
        });
        return orderHasChange ? { ...o, lines: enrichedLines } : o;
      });
    };

    if (saved && Array.isArray(saved)) {
      // 1. Repair any duplicate invoice numbers in existing data without deleting any order
      const repaired = repairDuplicateInvoiceNumbersLocally(saved);

      // 2. Deduplicate strictly identical records by ID
      const seen = new Set();
      const deduped = [];
      for (const o of repaired) {
        if (o.id && !seen.has(o.id)) {
          seen.add(o.id);
          deduped.push(o);
        } else if (!o.id) {
          deduped.push(o);
        }
      }
      const enriched = enrichOrderLines(deduped);
      const sorted = [...enriched].sort((a, b) => {
        const getSeq = (o) => {
          if (o.sequenceNumber != null && !isNaN(Number(o.sequenceNumber)) && Number(o.sequenceNumber) > 0) return Number(o.sequenceNumber);
          const m = String(o.invoiceNumber || o.id || '').match(/(\d+)/g);
          return m && m.length > 0 ? parseInt(m[m.length - 1], 10) || 0 : 0;
        };
        const sA = getSeq(a);
        const sB = getSeq(b);
        if (sA !== 0 && sB !== 0 && sB !== sA) return sB - sA;
        const tA = new Date(a.completedAt || a.createdAt || 0).getTime();
        const tB = new Date(b.completedAt || b.createdAt || 0).getTime();
        if (tB !== tA) return tB - tA;
        return String(b.invoiceNumber || b.id || '').localeCompare(String(a.invoiceNumber || a.id || ''), undefined, { numeric: true });
      });
      storage.set('orders', sorted);
      return sorted;
    }
    return [];
  })(),

  reversals: (() => {
    const saved = storage.get('reversals', null);
    if (saved && Array.isArray(saved)) {
      // Deduplicate by originalOrderId, originalInvoiceNumber, or id
      const seen = new Set();
      const deduped = [];
      for (const r of saved) {
        const key = r.originalOrderId || r.originalInvoiceNumber || r.id;
        if (key && !seen.has(key)) {
          seen.add(key);
          deduped.push(r);
        } else if (!key) {
          deduped.push(r);
        }
      }
      storage.set('reversals', deduped);
      return deduped;
    }
    return [];
  })(),

  // Menu State: Categories, Menu Items & Add-ons
  categories: (() => {
    const saved = storage.get('categories', null);
    if (saved && Array.isArray(saved)) return saved;
    return [];
  })(),

  items: (() => {
    const saved = storage.get('menu_items', null);
    const cats = storage.get('categories', null);
    if (saved && Array.isArray(saved)) {
      if (Array.isArray(cats) && cats.length > 0) {
        return healMiscategorizedItems(saved, cats);
      }
      return saved;
    }
    return [];
  })(),

  addons: (() => {
    const saved = storage.get('addons', null);
    if (saved && Array.isArray(saved)) {
      return saved;
    }
    return [];
  })(),

  deals: (() => {
    const saved = storage.get('deals', null);
    if (saved && Array.isArray(saved)) {
      return saved;
    }
    return [];
  })(),

  // Expenses & Accounting Ledger
  expenses: (() => {
    const saved = storage.get('expenses', null);
    if (saved && Array.isArray(saved)) return saved;
    return [];
  })(),

  expenseCategories: (() => {
    const saved = storage.get('expense_categories', null);
    if (saved && Array.isArray(saved)) return saved;
    return [];
  })(),

  fetchExpenses: async () => {
    try {
      const data = await ExpenseRepository.getAll();
      if (Array.isArray(data)) {
        storage.set('expenses', data);
        set({ expenses: data });
        return data;
      }
    } catch (err) {
      console.warn('[Store] fetchExpenses warning:', err.message);
    }
    return get().expenses;
  },

  addExpense: (expense) => {
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const tempId = expense.id || `exp-${Date.now()}-${randomSuffix}`;
    const optimisticRecord = {
      ...expense,
      id: tempId,
      status: expense.status || 'ACTIVE',
      expenseDate: expense.expenseDate || new Date().toISOString(),
      createdAt: expense.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 1. Instant optimistic state update (0ms delay)
    const current = get().expenses || [];
    const updated = [optimisticRecord, ...current.filter((e) => e.id !== tempId)];
    storage.set('expenses', updated);
    set({ expenses: updated });

    // 2. Fire background sync to backend & MongoDB Atlas without blocking UI
    ExpenseRepository.create(optimisticRecord)
      .then((saved) => {
        if (saved && (saved.id || saved._id)) {
          const latest = get().expenses || [];
          const replaced = latest.map((e) =>
            e.id === tempId || e.id === saved.id || (saved._id && e._id === saved._id)
              ? { ...optimisticRecord, ...saved }
              : e
          );
          storage.set('expenses', replaced);
          set({ expenses: replaced });
        }
      })
      .catch((err) => {
        console.warn('[Store] Expense background sync warning:', err.message);
      });

    return optimisticRecord;
  },

  updateExpense: (id, updates) => {
    const current = get().expenses || [];
    let updatedItem = null;
    const updated = current.map((e) => {
      if (e.id === id || e._id === id) {
        updatedItem = { ...e, ...updates, updatedAt: new Date().toISOString() };
        return updatedItem;
      }
      return e;
    });
    storage.set('expenses', updated);
    set({ expenses: updated });

    ExpenseRepository.update(id, updates)
      .then((saved) => {
        if (saved && (saved.id || saved._id)) {
          const latest = get().expenses || [];
          const synced = latest.map((e) =>
            e.id === id || e.id === saved.id || (saved._id && e._id === saved._id)
              ? { ...e, ...saved }
              : e
          );
          storage.set('expenses', synced);
          set({ expenses: synced });
        }
      })
      .catch((err) => {
        console.warn('[Store] Expense update background sync warning:', err.message);
      });

    return updatedItem;
  },

  voidExpense: (id, voidPayload) => {
    const current = get().expenses || [];
    let voidedItem = null;
    const updated = current.map((e) => {
      if (e.id === id || e._id === id) {
        voidedItem = {
          ...e,
          status: 'VOIDED',
          voidReason: voidPayload?.voidReason || 'No reason provided',
          voidedAt: new Date().toISOString(),
          voidedByName: voidPayload?.voidedByName || 'Admin',
          voidedByUserId: voidPayload?.voidedByUserId || '',
          updatedAt: new Date().toISOString(),
        };
        return voidedItem;
      }
      return e;
    });
    storage.set('expenses', updated);
    set({ expenses: updated });

    ExpenseRepository.void(id, voidPayload?.voidReason, {
      id: voidPayload?.voidedByUserId || '',
      name: voidPayload?.voidedByName || 'Admin',
    }).catch((err) => {
      console.warn('[Store] Expense void background sync warning:', err.message);
    });

    return voidedItem;
  },

  deleteExpense: (id) => {
    const updated = get().expenses.filter((e) => e.id !== id);
    storage.set('expenses', updated);
    set({ expenses: updated });
    ExpenseRepository.delete(id).catch((err) => {
      console.warn('[Store] Expense delete sync warning:', err.message);
    });
  },

  fetchExpenseCategories: async () => {
    try {
      const data = await ExpenseRepository.getCategories();
      if (Array.isArray(data)) {
        const current = get().expenseCategories || [];
        if (data.length > 0 || current.length === 0) {
          storage.set('expense_categories', data);
          set({ expenseCategories: data });
          return data;
        }
        return current;
      }
    } catch (err) {
      console.warn('[Store] fetchExpenseCategories warning:', err.message);
    }
    return get().expenseCategories;
  },

  addExpenseCategory: async (category) => {
    let result = category;
    try {
      result = await ExpenseRepository.createCategory(category);
    } catch (err) {
      console.warn('[Store] ExpenseCategory create warning:', err.message);
    }
    const current = get().expenseCategories || [];
    const exists = current.some((c) => c.id === result.id || c.name === result.name);
    const updated = exists
      ? current.map((c) => (c.id === result.id ? result : c))
      : [...current, result];
    storage.set('expense_categories', updated);
    set({ expenseCategories: updated });
    return result;
  },

  updateExpenseCategory: async (id, updates) => {
    let result = null;
    try {
      result = await ExpenseRepository.updateCategory(id, updates);
    } catch (err) {
      console.warn('[Store] ExpenseCategory update warning:', err.message);
    }
    const updated = (get().expenseCategories || []).map((c) => {
      if (c.id === id) {
        return result || { ...c, ...updates };
      }
      return c;
    });
    storage.set('expense_categories', updated);
    set({ expenseCategories: updated });
    return result;
  },

  deleteExpenseCategory: async (id) => {
    try {
      await ExpenseRepository.deleteCategory(id);
    } catch (err) {
      console.warn('[Store] ExpenseCategory delete warning:', err.message);
      throw err;
    }
    const updated = (get().expenseCategories || []).filter((c) => c.id !== id);
    storage.set('expense_categories', updated);
    set({ expenseCategories: updated });
  },

  // Dining Floorplan Tables
  tables: (() => {
    const saved = storage.get('tables', null);
    if (saved && Array.isArray(saved)) return saved;
    return [];
  })(),

  updateTableStatus: (tableId, status, details = {}) => {
    const updated = get().tables.map((t) => (t.id === tableId ? { ...t, status, ...details } : t));
    storage.set('tables', updated);
    set({ tables: updated });
    TableRepository.updateStatus(tableId, status, details).catch((err) => {
      console.warn('[Store] Table update status sync warning:', err.message);
    });
  },

  occupyTable: (tableId, details = {}) => {
    const updated = get().tables.map((t) =>
      t.id === tableId
        ? {
            ...t,
            status: 'occupied',
            currentOrderId: details.orderId || null,
            currentInvoiceNumber: details.invoiceNumber || null,
            guestsCount: details.guestsCount || t.capacity,
            occupiedAt: new Date().toISOString(),
          }
        : t
    );
    storage.set('tables', updated);
    set({ tables: updated });
    TableRepository.occupy(tableId, details).catch((err) => {
      console.warn('[Store] Table occupy sync warning:', err.message);
    });
  },

  releaseTable: (tableId) => {
    const updated = get().tables.map((t) =>
      t.id === tableId
        ? {
            ...t,
            status: 'available',
            currentOrderId: null,
            currentInvoiceNumber: null,
            guestsCount: 0,
            occupiedAt: null,
          }
        : t
    );
    storage.set('tables', updated);
    set({ tables: updated });
    TableRepository.release(tableId).catch((err) => {
      console.warn('[Store] Table release sync warning:', err.message);
    });
  },

  // Cash Register Shift Management
  currentShift: (() => {
    return storage.get('current_shift', null);
  })(),

  openShift: async (shiftData) => {
    try {
      const shift = await ShiftRepository.open(shiftData);
      storage.set('current_shift', shift);
      set({ currentShift: shift });
      return shift;
    } catch (err) {
      console.error('[Store] openShift failed:', err);
      throw err;
    }
  },

  closeShift: async (closeData) => {
    try {
      const closed = await ShiftRepository.close(closeData);
      storage.set('current_shift', null);
      set({ currentShift: null });
      return closed;
    } catch (err) {
      console.error('[Store] closeShift failed:', err);
      throw err;
    }
  },

  // Kitchen Order Status
  updateOrderKitchenStatus: (orderId, kitchenStatus) => {
    const updated = get().orders.map((o) =>
      o.id === orderId || o.invoiceNumber === orderId ? { ...o, kitchenStatus } : o
    );
    storage.set('orders', updated);
    set({ orders: updated });
    OrderRepository.updateKitchenStatus(orderId, kitchenStatus).catch((err) => {
      console.warn('[Store] Kitchen status sync warning:', err.message);
    });
  },

  // Notifications State
  notifications: (() => {
    const saved = storage.get('notifications', null);
    if (saved && Array.isArray(saved)) return saved;
    return [];
  })(),

  markNotificationAsRead: (id) => {
    const updated = (get().notifications || []).map((n) =>
      n.id === id ? { ...n, read: true } : n
    );
    storage.set('notifications', updated);
    set({ notifications: updated });
  },

  markAllNotificationsAsRead: () => {
    const updated = (get().notifications || []).map((n) => ({ ...n, read: true }));
    storage.set('notifications', updated);
    set({ notifications: updated });
  },

  clearNotifications: () => {
    storage.set('notifications', []);
    set({ notifications: [] });
  },

  // Append new completed order (used by POS checkout)
  addOrder: async (order) => {
    const currentOrders = get().orders || [];
    const alreadyExists = currentOrders.some(
      (o) =>
        (order.id && o.id === order.id) ||
        (order.invoiceNumber && o.invoiceNumber === order.invoiceNumber)
    );
    if (alreadyExists) {
      console.warn('[Store] Duplicate order rejected by addOrder:', order.id, order.invoiceNumber);
      return order;
    }

    const getSeq = (o) => {
      if (o.sequenceNumber != null && !isNaN(Number(o.sequenceNumber)) && Number(o.sequenceNumber) > 0) return Number(o.sequenceNumber);
      const m = String(o.invoiceNumber || o.id || '').match(/(\d+)/g);
      return m && m.length > 0 ? parseInt(m[m.length - 1], 10) || 0 : 0;
    };
    const updated = [order, ...currentOrders].sort((a, b) => {
      const sA = getSeq(a);
      const sB = getSeq(b);
      if (sA !== 0 && sB !== 0 && sB !== sA) return sB - sA;
      const tA = new Date(a.completedAt || a.createdAt || 0).getTime();
      const tB = new Date(b.completedAt || b.createdAt || 0).getTime();
      if (tB !== tA) return tB - tA;
      return String(b.invoiceNumber || b.id || '').localeCompare(String(a.invoiceNumber || a.id || ''), undefined, { numeric: true });
    });
    storage.set('orders', updated);

    // Create real notification for each new order with user targeting
    const isOrderAdmin = String(order.createdByRole || '').toLowerCase() === 'admin';
    const newNotif = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type: 'order',
      title: `New Order #${order.invoiceNumber}`,
      description: `${order.orderType || 'Dine-In'} • Rs ${order.grandTotal || 0} • ${order.paymentMethod || 'Cash'}`,
      orderId: order.id,
      invoiceNumber: order.invoiceNumber,
      amount: order.grandTotal,
      orderType: order.orderType,
      read: false,
      timestamp: new Date().toISOString(),
      createdByUserId: order.createdByUserId || null,
      createdByRole: order.createdByRole || (isOrderAdmin ? 'admin' : 'cashier'),
      targetUserId: order.createdByUserId || null,
      targetRoles: isOrderAdmin ? ['admin'] : ['admin', 'cashier'],
    };
    const updatedNotifs = [newNotif, ...(get().notifications || [])];
    storage.set('notifications', updatedNotifs);

    set({ orders: updated, notifications: updatedNotifs });

    // Live sync to MongoDB Atlas via OrderRepository (non-blocking for instant POS checkout)
    OrderRepository.create(order)
      .then((synced) => {
        if (synced && synced.id) {
          const liveOrders = get().orders || [];
          let safeSynced = synced;
          // Protect against backend downgrading sequence or returning duplicate invoice number
          const otherOrders = liveOrders.filter((o) => o.id !== order.id && o.id !== synced.id);
          const hasCollision = otherOrders.some((o) => o.invoiceNumber === synced.invoiceNumber);
          if (hasCollision && order.invoiceNumber && !otherOrders.some((o) => o.invoiceNumber === order.invoiceNumber)) {
            safeSynced = { ...synced, invoiceNumber: order.invoiceNumber, sequenceNumber: order.sequenceNumber };
          }
          const replaced = liveOrders.map((o) =>
            o.id === order.id || o.id === synced.id ? { ...o, ...safeSynced } : o
          );
          const healed = repairDuplicateInvoiceNumbersLocally(replaced);
          const sorted = [...healed].sort((a, b) => {
            const sA = getSeq(a);
            const sB = getSeq(b);
            if (sA !== 0 && sB !== 0 && sB !== sA) return sB - sA;
            const tA = new Date(a.completedAt || a.createdAt || 0).getTime();
            const tB = new Date(b.completedAt || b.createdAt || 0).getTime();
            if (tB !== tA) return tB - tA;
            return String(b.invoiceNumber || b.id || '').localeCompare(String(a.invoiceNumber || a.id || ''), undefined, { numeric: true });
          });
          storage.set('orders', sorted);
          set({ orders: sorted });
        }
      })
      .catch((err) => {
        console.warn('[Store] Order Atlas sync warning:', err.message);
      });

    return order;
  },

  // Settle remaining balance for a partially paid order
  settleOrderBalance: (
    orderId,
    {
      amountPaid,
      paymentMethod = 'Cash',
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
    const orders = get().orders || [];
    const target = orders.find((o) => o.id === orderId || o.invoiceNumber === orderId);
    if (!target) return null;

    const grandTotal = Number(target.grandTotal) || 0;
    const prevReceived = Number(target.amountReceived) || 0;
    const prevDue = Number(target.balanceDue != null ? target.balanceDue : Math.max(0, grandTotal - prevReceived));
    const pay = Math.max(0, Math.min(prevDue, Number(amountPaid) || 0));
    const newDue = Math.max(0, prevDue - pay);
    const newReceived = prevReceived + pay;
    const isNowFullyPaid = newDue === 0;

    const loggedInUser = get().user || {};
    const settleRecord = {
      id: `stl-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      amountPaid: pay,
      previousBalance: prevDue,
      remainingBalance: newDue,
      paymentMethod,
      cardNetwork: paymentMethod === 'Card' ? cardNetwork : undefined,
      cardSlipNumber: paymentMethod === 'Card' ? cardSlipNumber : undefined,
      onlineChannel: paymentMethod === 'Online' ? onlineChannel : undefined,
      onlineAccountId: paymentMethod === 'Online' ? onlineAccountId : undefined,
      onlineAccountNumber: paymentMethod === 'Online' ? onlineAccountNumber : undefined,
      onlineAccountTitle: paymentMethod === 'Online' ? onlineAccountTitle : undefined,
      onlineBankName: paymentMethod === 'Online' ? onlineBankName : undefined,
      onlineTransactionId: paymentMethod === 'Online' ? onlineTransactionId : undefined,
      settledAt: new Date().toISOString(),
      settledBy: loggedInUser.name || loggedInUser.username || 'Cashier',
      note: note || '',
    };

    const updatedOrder = {
      ...target,
      amountReceived: newReceived,
      balanceDue: newDue,
      paymentStatus: isNowFullyPaid ? 'paid' : 'partial',
      status: isNowFullyPaid ? 'completed' : target.status,
      // If settlement used Card or Online, attach payment channel details for invoice visibility
      ...(paymentMethod === 'Card' ? { cardNetwork, posSlipNumber: cardSlipNumber } : {}),
      ...(paymentMethod === 'Online'
        ? {
            onlineChannel,
            onlineAccountId,
            onlineAccountNumber,
            onlineAccountTitle,
            onlineBankName,
            transactionId: onlineTransactionId,
          }
        : {}),
      settlementHistory: [...(target.settlementHistory || []), settleRecord],
    };

    const updatedOrders = orders.map((o) =>
      o.id === target.id || o.invoiceNumber === target.invoiceNumber ? updatedOrder : o
    );

    storage.set('orders', updatedOrders);

    // Create real notification
    const channelDetail =
      paymentMethod === 'Card' && cardNetwork
        ? ` (${cardNetwork})`
        : paymentMethod === 'Online' && (onlineBankName || onlineChannel)
        ? ` (${onlineBankName || onlineChannel}${onlineAccountNumber ? ` - ${onlineAccountNumber}` : ''})`
        : '';
    const isSettledByAdmin = String(loggedInUser.role || '').toLowerCase().includes('admin') || loggedInUser.username === 'admin';
    const newNotif = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type: 'order',
      title: `Balance Settled #${target.invoiceNumber}`,
      description: `Received Rs ${pay} via ${paymentMethod}${channelDetail}. ${isNowFullyPaid ? 'Fully Paid' : `Remaining: Rs ${newDue}`}`,
      orderId: target.id,
      invoiceNumber: target.invoiceNumber,
      amount: pay,
      read: false,
      timestamp: new Date().toISOString(),
      createdByUserId: loggedInUser.id || (loggedInUser.username ? `user_${loggedInUser.username}` : null),
      createdByRole: isSettledByAdmin ? 'admin' : 'cashier',
      targetRoles: ['admin'],
    };
    const updatedNotifs = [newNotif, ...(get().notifications || [])];
    storage.set('notifications', updatedNotifs);

    set({ orders: updatedOrders, notifications: updatedNotifs });

    // Sync to backend non-blocking
    OrderRepository.settleBalance(target.id, {
      amountPaid: pay,
      paymentMethod,
      cardNetwork,
      cardSlipNumber,
      onlineChannel,
      onlineAccountId,
      onlineAccountNumber,
      onlineAccountTitle,
      onlineBankName,
      onlineTransactionId,
      receivedBy: loggedInUser.name || loggedInUser.username || 'Cashier',
      note,
    }).catch((err) => {
      console.warn('[Store] Order balance settle sync warning:', err.message);
    });

    return updatedOrder;
  },

  // Deletion & Audit History State
  deletionHistory: (() => {
    const saved = storage.get('deletion_history', null);
    if (saved && Array.isArray(saved)) return saved;
    const initial = [
      {
        id: 'del-demo-1',
        type: 'invoice_delete',
        title: 'Invoice #INV-0004 Cleared',
        deletedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        reason: 'Customer cancelled at counter before preparation',
        totalInvoicesDeleted: 1,
        totalAmount: 1100,
        invoices: [
          {
            id: 'ord-del-004',
            invoiceNumber: 'INV-0004',
            orderType: 'Takeaway',
            paymentMethod: 'Cash',
            grandTotal: 1100,
            completedAt: new Date(Date.now() - 3600000 * 3).toISOString(),
            lines: [
              {
                id: 'l1',
                itemName: 'Special Chicken Biryani',
                portion: '1 Kg',
                addons: ['Zeera Raita (Rs 40)', 'Fresh Salad (Rs 50)'],
                quantity: 1,
                unitPrice: 900,
                lineSubtotal: 900,
              },
              {
                id: 'l2',
                itemName: 'Gulab Jamun (2 Pcs)',
                portion: 'Standard',
                addons: [],
                quantity: 1,
                unitPrice: 200,
                lineSubtotal: 200,
              },
            ],
          },
        ],
      },
    ];
    storage.set('deletion_history', initial);
    return initial;
  })(),

  // Append new reversal
  addReversal: (reversal) => {
    const currentReversals = get().reversals || [];
    const revOrderKey = reversal.originalOrderId || reversal.orderId;
    const revInvKey = reversal.originalInvoiceNumber || reversal.invoiceNumber;

    // Guard: Prevent double-reversing the same order/invoice
    const isAlreadyReversed = currentReversals.some((r) => {
      if (r.id === reversal.id) return true;
      if (revOrderKey && (r.originalOrderId === revOrderKey || r.orderId === revOrderKey)) return true;
      if (revInvKey && (r.originalInvoiceNumber === revInvKey || r.invoiceNumber === revInvKey)) return true;
      return false;
    });

    if (isAlreadyReversed) {
      console.warn('[Store] Reversal already exists for order:', revOrderKey || revInvKey);
      return;
    }

    const updated = [reversal, ...currentReversals];
    const targetOrder = get().orders.find(
      (o) => (revOrderKey && o.id === revOrderKey) || (revInvKey && o.invoiceNumber === revInvKey)
    );
    // Mark target order as reversed in order list
    const updatedOrders = get().orders.map((o) =>
      (revOrderKey && o.id === revOrderKey) || (revInvKey && o.invoiceNumber === revInvKey)
        ? { ...o, status: 'reversed', reversalId: reversal.id }
        : o
    );
    storage.set('reversals', updated);
    storage.set('orders', updatedOrders);

    // Live sync to MongoDB Atlas via ReversalRepository
    ReversalRepository.create(reversal).catch((err) => {
      console.warn('[Store] Reversal Atlas sync warning:', err.message);
    });

    // Audit record of reversal
    let updatedHistory = get().deletionHistory || [];
    if (targetOrder) {
      const auditEntry = {
        id: `del-rev-${Date.now()}`,
        type: 'invoice_reversal',
        title: `Invoice #${reversal.originalInvoiceNumber} Reversed`,
        deletedAt: new Date().toISOString(),
        reason: reversal.reason || 'Reversed',
        totalInvoicesDeleted: 1,
        totalAmount: reversal.totalReversedIncludingTax || targetOrder.grandTotal,
        invoices: [
          {
            id: targetOrder.id,
            invoiceNumber: targetOrder.invoiceNumber,
            orderType: targetOrder.orderType || 'Dine-In',
            paymentMethod: targetOrder.paymentMethod || 'Cash',
            grandTotal: targetOrder.grandTotal,
            completedAt: targetOrder.completedAt || targetOrder.createdAt,
            lines: (targetOrder.lines || []).map((l) => ({
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
          },
        ],
      };
      updatedHistory = [auditEntry, ...updatedHistory];
      storage.set('deletion_history', updatedHistory);
    }

    // Create reversal notification
    const newNotif = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type: 'reversal',
      title: `Invoice Reversed #${reversal.originalInvoiceNumber}`,
      description: `Refund Rs ${reversal.totalReversedIncludingTax || 0} • ${reversal.reason || 'Reversed'}`,
      orderId: reversal.originalOrderId,
      invoiceNumber: reversal.originalInvoiceNumber,
      amount: reversal.totalReversedIncludingTax,
      read: false,
      timestamp: new Date().toISOString(),
      createdByRole: 'admin',
      targetRoles: ['admin'],
    };
    const updatedNotifs = [newNotif, ...(get().notifications || [])];
    storage.set('notifications', updatedNotifs);

    set({
      reversals: updated,
      orders: updatedOrders,
      notifications: updatedNotifs,
      deletionHistory: updatedHistory,
    });
  },

  // Delete specific invoice with full audit details
  deleteInvoice: (invoiceId, reason = 'Manually removed by admin') => {
    const targetOrder = get().orders.find((o) => o.id === invoiceId || o.invoiceNumber === invoiceId);
    if (!targetOrder) return false;

    const remainingOrders = get().orders.filter((o) => o.id !== targetOrder.id);
    storage.set('orders', remainingOrders);

    const auditEntry = {
      id: `del-inv-${Date.now()}`,
      type: 'invoice_delete',
      title: `Invoice #${targetOrder.invoiceNumber} Deleted`,
      deletedAt: new Date().toISOString(),
      reason,
      totalInvoicesDeleted: 1,
      totalAmount: targetOrder.grandTotal || 0,
      invoices: [
        {
          id: targetOrder.id,
          invoiceNumber: targetOrder.invoiceNumber,
          orderType: targetOrder.orderType || 'Dine-In',
          paymentMethod: targetOrder.paymentMethod || 'Cash',
          grandTotal: targetOrder.grandTotal,
          completedAt: targetOrder.completedAt || targetOrder.createdAt,
          lines: (targetOrder.lines || []).map((l) => ({
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
        },
      ],
    };

    const updatedHistory = [auditEntry, ...(get().deletionHistory || [])];
    storage.set('deletion_history', updatedHistory);

    const newNotif = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type: 'reversal',
      title: `Invoice #${targetOrder.invoiceNumber} Deleted`,
      description: `Removed Rs ${targetOrder.grandTotal || 0} • ${reason}`,
      orderId: targetOrder.id,
      invoiceNumber: targetOrder.invoiceNumber,
      amount: targetOrder.grandTotal,
      read: false,
      timestamp: new Date().toISOString(),
      createdByRole: 'admin',
      targetRoles: ['admin'],
    };
    const updatedNotifs = [newNotif, ...(get().notifications || [])];
    storage.set('notifications', updatedNotifs);

    set({
      orders: remainingOrders,
      deletionHistory: updatedHistory,
      notifications: updatedNotifs,
    });
    return true;
  },

  clearDeletionHistory: () => {
    storage.set('deletion_history', []);
    set({ deletionHistory: [] });
  },

  // ================= CATEGORY ACTIONS =================
  addCategory: (category) => {
    const newRecord = {
      ...category,
      id: category.id || `cat-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      createdAt: category.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [newRecord, ...get().categories];
    storage.set('categories', updated);
    set({ categories: updated });

    // Live sync to MongoDB Atlas via CategoryRepository
    CategoryRepository.create(newRecord)
      .then((synced) => {
        if (synced && synced.id) {
          const liveCats = get().categories || [];
          const replaced = liveCats.map((c) =>
            c.id === newRecord.id || c.id === synced.id ? { ...c, ...synced } : c
          );
          storage.set('categories', replaced);
          set({ categories: replaced });
        }
      })
      .catch((err) => {
        console.warn('[Store] Category Atlas sync warning:', err.message);
      });

    return newRecord;
  },

  updateCategory: (id, updates) => {
    const updated = get().categories.map((c) =>
      c.id === id ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c
    );
    storage.set('categories', updated);
    set({ categories: updated });

    // Live sync to MongoDB Atlas via CategoryRepository
    CategoryRepository.update(id, updates)
      .then((synced) => {
        if (synced && synced.id) {
          const liveCats = get().categories || [];
          const replaced = liveCats.map((c) =>
            c.id === id || c.id === synced.id ? { ...c, ...synced } : c
          );
          storage.set('categories', replaced);
          set({ categories: replaced });
        }
      })
      .catch((err) => {
        console.warn('[Store] Category update Atlas sync warning:', err.message);
      });
  },

  setCategoryStatus: (id, status) => {
    get().updateCategory(id, { status });
  },

  deleteCategory: (id) => {
    const updated = get().categories.filter((c) => c.id !== id);
    storage.set('categories', updated);
    set({ categories: updated });

    // Live sync to MongoDB Atlas via CategoryRepository
    CategoryRepository.delete(id).catch((err) => {
      console.warn('[Store] Category delete Atlas sync warning:', err.message);
    });
  },

  // ================= MENU ITEM ACTIONS =================
  addItem: (item) => {
    const newRecord = {
      ...item,
      id: item.id || `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [...get().items, newRecord];
    storage.set('menu_items', updated);
    set({ items: updated });

    // Live sync to MongoDB Atlas via ItemRepository
    ItemRepository.create(newRecord)
      .then((synced) => {
        if (synced && synced.id) {
          const liveItems = get().items || [];
          const replaced = liveItems.map((i) =>
            i.id === newRecord.id || i.id === synced.id ? { ...i, ...synced } : i
          );
          storage.set('menu_items', replaced);
          set({ items: replaced });
        }
      })
      .catch((err) => {
        console.warn('[Store] Item Atlas sync warning:', err.message);
      });

    return newRecord;
  },

  updateItem: (id, updates) => {
    const updated = get().items.map((item) =>
      item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item
    );
    storage.set('menu_items', updated);
    set({ items: updated });

    // If costPrice is updated, heal any orders that previously lacked cost or used the legacy 0.55 heuristic
    if (updates.costPrice !== undefined && updates.costPrice !== null && !isNaN(Number(updates.costPrice))) {
      const currentOrders = get().orders || [];
      let anyChanged = false;
      const healedOrders = currentOrders.map((ord) => {
        if (!Array.isArray(ord.lines)) return ord;
        let lineChanged = false;
        const newLines = ord.lines.map((l) => {
          const matchItem = l.itemId === id || (l.itemNameSnapshot && updates.name && l.itemNameSnapshot.trim().toLowerCase() === updates.name.trim().toLowerCase());
          if (matchItem) {
            const isHeuristicFallback = Number(l.costPriceSnapshot) === Math.round(Number(l.unitPrice || 0) * 0.55);
            if (l.costPriceSnapshot == null || isHeuristicFallback) {
              lineChanged = true;
              anyChanged = true;
              const newCost = Number(updates.costPrice);
              const qty = Math.max(1, Number(l.quantity || 1));
              const isWeight = Boolean(l.pricingMode === 'portion' || l.pricingMode === 'custom_weight' || l.pricingMode === 'weight' || l.selectedWeightGrams);
              let derivedGrams = Number(l.selectedWeightGrams) || 0;
              if (isWeight && derivedGrams <= 0) {
                const label = String(l.selectedPortionLabel || l.portion || l.baseUnitSnapshot || '').toLowerCase();
                if (label.includes('1kg') || label === '1 kg') derivedGrams = 1000;
                else if (label.match(/(\d+)\s*g/)) derivedGrams = Number(label.match(/(\d+)\s*g/)[1]);
                else if (label.includes('half')) derivedGrams = 500;
                else if (label.includes('quarter')) derivedGrams = 250;
                else derivedGrams = 1000;
              }
              const itemCOGS = (isWeight && derivedGrams > 0)
                ? Math.round((derivedGrams / 1000) * newCost * qty)
                : Math.round(newCost * qty);
              const addonCOGS = Number(l.addonCOGS || 0);
              const totalCOGS = itemCOGS + addonCOGS;
              const netRev = Number(l.netRevenue ?? (Number(l.unitPrice || 0) * qty));
              const grossProfit = Math.round(netRev - totalCOGS);
              const margin = netRev > 0 ? Number(((grossProfit / netRev) * 100).toFixed(2)) : 0;
              return {
                ...l,
                costPriceSnapshot: newCost,
                itemCOGS,
                totalCOGS,
                grossProfit,
                grossProfitMargin: margin,
                hasCost: true,
                hasCostPrice: true,
              };
            }
          }
          return l;
        });
        return lineChanged ? { ...ord, lines: newLines } : ord;
      });
      if (anyChanged) {
        storage.set('orders', healedOrders);
        set({ orders: healedOrders });
      }
    }

    // Live sync to MongoDB Atlas via ItemRepository
    ItemRepository.update(id, updates)
      .then((synced) => {
        if (synced && synced.id) {
          const liveItems = get().items || [];
          const replaced = liveItems.map((i) =>
            i.id === id || i.id === synced.id ? { ...i, ...synced } : i
          );
          storage.set('menu_items', replaced);
          set({ items: replaced });
        }
      })
      .catch((err) => {
        console.warn('[Store] Item update Atlas sync warning:', err.message);
      });
  },

  setItemStatus: (id, status) => {
    get().updateItem(id, { status });
  },

  deleteItem: (id) => {
    const updated = get().items.filter((item) => item.id !== id);
    storage.set('menu_items', updated);
    set({ items: updated });

    // Live sync to MongoDB Atlas via ItemRepository
    ItemRepository.delete(id).catch((err) => {
      console.warn('[Store] Item delete Atlas sync warning:', err.message);
    });
  },

  // ================= ADD-ON ACTIONS =================
  addAddon: (addon) => {
    const existingIndex = get().addons.findIndex(
      (a) => a && (a.id === addon.id || (a.name && addon.name && a.name.trim().toLowerCase() === addon.name.trim().toLowerCase()))
    );
    const newRecord = {
      ...(existingIndex >= 0 ? get().addons[existingIndex] : {}),
      ...addon,
      id: addon.id || (existingIndex >= 0 ? get().addons[existingIndex].id : `addon-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`),
      createdAt: addon.createdAt || (existingIndex >= 0 ? get().addons[existingIndex].createdAt : new Date().toISOString()),
      updatedAt: new Date().toISOString(),
    };
    const remaining = existingIndex >= 0
      ? get().addons.filter((_, idx) => idx !== existingIndex)
      : get().addons;
    const updated = [newRecord, ...remaining];
    storage.set('addons', updated);
    set({ addons: updated });

    // Live sync to MongoDB Atlas via AddonRepository
    AddonRepository.create(newRecord)
      .then((synced) => {
        if (synced && synced.id) {
          const liveAdds = get().addons || [];
          const replaced = liveAdds.map((a) =>
            a.id === newRecord.id || a.id === synced.id ? { ...a, ...synced } : a
          );
          storage.set('addons', replaced);
          set({ addons: replaced });
        }
      })
      .catch((err) => {
        console.warn('[Store] Addon Atlas sync warning:', err.message);
      });

    return newRecord;
  },

  updateAddon: (id, updates) => {
    const existing = get().addons.find((a) => a.id === id);
    if (!existing) return;
    const updatedRecord = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    const remaining = get().addons.filter((a) => a.id !== id);
    const updated = [updatedRecord, ...remaining];
    storage.set('addons', updated);
    set({ addons: updated });

    // Live sync to MongoDB Atlas via AddonRepository
    AddonRepository.update(id, updates).catch((err) => {
      console.warn('[Store] Addon update Atlas sync warning:', err.message);
    });
  },

  setAddonStatus: (id, status) => {
    get().updateAddon(id, { status });
  },

  deleteAddon: (id) => {
    // 1. Remove from addons
    const updatedAddons = get().addons.filter((a) => a.id !== id);
    storage.set('addons', updatedAddons);

    // 2. Safely remove reference from items and categories
    const updatedItems = get().items.map((item) => {
      if (Array.isArray(item.addonIds) && item.addonIds.includes(id)) {
        return { ...item, addonIds: item.addonIds.filter((aid) => aid !== id) };
      }
      return item;
    });
    storage.set('menu_items', updatedItems);

    const updatedCategories = get().categories.map((cat) => {
      if (Array.isArray(cat.defaultAddonIds) && cat.defaultAddonIds.includes(id)) {
        return { ...cat, defaultAddonIds: cat.defaultAddonIds.filter((aid) => aid !== id) };
      }
      return cat;
    });
    storage.set('categories', updatedCategories);

    set({ addons: updatedAddons, items: updatedItems, categories: updatedCategories });

    // Live sync to MongoDB Atlas via AddonRepository
    AddonRepository.delete(id).catch((err) => {
      console.warn('[Store] Addon delete Atlas sync warning:', err.message);
    });
  },

  // ================= DEAL ACTIONS =================
  addDeal: (deal) => {
    const newRecord = {
      ...deal,
      id: deal.id || `deal-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      createdAt: deal.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [newRecord, ...get().deals];
    storage.set('deals', updated);
    set({ deals: updated });

    // Live sync to MongoDB Atlas via DealRepository
    DealRepository.create(newRecord)
      .then((synced) => {
        if (synced && synced.id) {
          const liveDeals = get().deals || [];
          const replaced = liveDeals.map((d) =>
            d.id === newRecord.id || d.id === synced.id ? { ...d, ...synced } : d
          );
          storage.set('deals', replaced);
          set({ deals: replaced });
        }
      })
      .catch((err) => {
        console.warn('[Store] Deal Atlas sync warning:', err.message);
      });

    return newRecord;
  },

  updateDeal: (id, updates) => {
    const updated = get().deals.map((d) =>
      d.id === id ? { ...d, ...updates, updatedAt: new Date().toISOString() } : d
    );
    storage.set('deals', updated);
    set({ deals: updated });

    // Live sync to MongoDB Atlas via DealRepository
    DealRepository.update(id, updates).catch((err) => {
      console.warn('[Store] Deal update Atlas sync warning:', err.message);
    });
  },

  setDealStatus: (id, status) => {
    get().updateDeal(id, { status });
  },

  deleteDeal: (id) => {
    const updated = get().deals.filter((d) => d.id !== id);
    storage.set('deals', updated);
    set({ deals: updated });

    // Live sync to MongoDB Atlas via DealRepository
    DealRepository.delete(id).catch((err) => {
      console.warn('[Store] Deal delete Atlas sync warning:', err.message);
    });
  },

  // Complete wipe of all restaurant data (categories, items, addons, deals, orders, reversals, expenses, tables)
  clearAllData: async () => {
    storage.set('categories', []);
    storage.set('menu_items', []);
    storage.set('addons', []);
    storage.set('deals', []);
    storage.set('orders', []);
    storage.set('reversals', []);
    storage.set('expenses', []);
    storage.set('tables', []);
    storage.set('shifts', []);
    storage.set('current_shift', null);
    storage.set('pos_cart', []);
    storage.set('cart_user_admin', []);
    storage.set('cart_user_cashier', []);
    storage.set('currentOrder_user_admin', []);
    storage.set('currentOrder_user_cashier', []);
    storage.set('notifications', []);
    const safeDefaults = getDefaultSettings();
    storage.set('settings', safeDefaults);
    try {
      await clearAllImages();
    } catch {}
    try {
      await SettingsRepository.dangerZoneReset({ confirmationPhrase: 'DELETE ALL DATA', resetType: 'all' });
    } catch {}
    set({
      categories: [],
      items: [],
      addons: [],
      deals: [],
      orders: [],
      reversals: [],
      expenses: [],
      tables: [],
      cart: [],
      notifications: [],
      orderType: safeDefaults?.pos?.defaultOrderType || 'Dine-In',
      settings: safeDefaults,
    });
  },

  // Clear only transaction ledger
  clearAllTransactions: () => {
    storage.set('orders', []);
    storage.set('reversals', []);
    set({ orders: [], reversals: [] });
  },

  // Reset to default seed catalog and transactions
  resetToDemoData: () => {
    storage.set('categories', seedCategories);
    storage.set('menu_items', seedMenuItems);
    storage.set('addons', seedAddons);
    storage.set('orders', defaultSeedData.orders);
    storage.set('reversals', defaultSeedData.reversals);
    set({
      categories: seedCategories,
      items: seedMenuItems,
      addons: seedAddons,
      orders: defaultSeedData.orders,
      reversals: defaultSeedData.reversals,
    });
  },

  // Reset to default seed transactions
  resetToDemoTransactions: () => {
    storage.set('orders', defaultSeedData.orders);
    storage.set('reversals', defaultSeedData.reversals);
    set({ orders: defaultSeedData.orders, reversals: defaultSeedData.reversals });
  },

  // Synchronize store with live Express + MongoDB Atlas backend
  syncWithBackend: async () => {
    try {
      const [cats, its, adds, dls, ords, revs, exps, expCats, tbls, curShift, fetchedSettings] = await Promise.all([
        CategoryRepository.getAll().catch(() => null),
        ItemRepository.getAll().catch(() => null),
        AddonRepository.getAll().catch(() => null),
        DealRepository.getAll().catch(() => null),
        OrderRepository.getAll().catch(() => null),
        ReversalRepository.getAll().catch(() => null),
        ExpenseRepository.getAll().catch(() => null),
        ExpenseRepository.getCategories().catch(() => null),
        TableRepository.getAll().catch(() => null),
        ShiftRepository.getCurrent().catch(() => null),
        SettingsRepository.fetchSettings().catch(() => null),
      ]);

      const updates = {};

      // 1. Categories
      if (Array.isArray(cats)) {
        const localCats = get().categories || [];
        const backendCatMap = new Map((cats || []).map((c) => [c.id, c]));
        const unsyncedCats = localCats.filter((c) => c?.id && !backendCatMap.has(c.id));
        unsyncedCats.forEach((c) => {
          CategoryRepository.create(c).catch(() => {});
        });
        const mergedCats = [...cats, ...unsyncedCats];
        updates.categories = mergedCats;
        storage.set('categories', mergedCats);
      }

      // 2. Menu Items
      if (Array.isArray(its)) {
        const localItems = get().items || [];
        const backendItemMap = new Map((its || []).map((i) => [i.id, i]));
        const unsyncedItems = localItems.filter((i) => i?.id && !backendItemMap.has(i.id));
        unsyncedItems.forEach((i) => {
          ItemRepository.create(i).catch(() => {});
        });
        const mergedItems = [...its, ...unsyncedItems];
        const healedItems = healMiscategorizedItems(mergedItems, get().categories || []);
        updates.items = healedItems;
        storage.set('menu_items', healedItems);
      }

      // 3. Add-ons
      if (Array.isArray(adds)) {
        const localAdds = get().addons || [];
        const backendAddMap = new Map((adds || []).map((a) => [a.id, a]));
        const unsyncedAdds = localAdds.filter((a) => a?.id && !backendAddMap.has(a.id));
        unsyncedAdds.forEach((a) => {
          AddonRepository.create(a).catch(() => {});
        });
        const mergedAdds = [...adds, ...unsyncedAdds];
        updates.addons = mergedAdds;
        storage.set('addons', mergedAdds);
      }

      // 3.5. Deals
      if (Array.isArray(dls)) {
        const localDeals = get().deals || [];
        const backendDealMap = new Map((dls || []).map((d) => [d.id, d]));
        const unsyncedDeals = localDeals.filter((d) => d?.id && !backendDealMap.has(d.id));
        unsyncedDeals.forEach((d) => {
          DealRepository.create(d).catch(() => {});
        });
        const mergedDeals = [...dls, ...unsyncedDeals];
        updates.deals = mergedDeals;
        storage.set('deals', mergedDeals);
      }

      // 4. Orders
      if (Array.isArray(ords)) {
        const localOrds = get().orders || [];
        const seenOrd = new Set();
        const mergedOrds = [];
        for (const o of ords) {
          const key = o.id || o.invoiceNumber;
          if (key && !seenOrd.has(key)) {
            seenOrd.add(key);
            mergedOrds.push(o);
          } else if (!key) {
            mergedOrds.push(o);
          }
        }
        for (const loc of localOrds) {
          const key = loc?.id || loc?.invoiceNumber;
          if (key && !seenOrd.has(key)) {
            seenOrd.add(key);
            mergedOrds.push(loc);
            OrderRepository.create(loc).catch(() => {});
          }
        }
        const healed = repairDuplicateInvoiceNumbersLocally(mergedOrds);
        const getSeq = (o) => {
          if (o.sequenceNumber != null && !isNaN(Number(o.sequenceNumber)) && Number(o.sequenceNumber) > 0) return Number(o.sequenceNumber);
          const m = String(o.invoiceNumber || o.id || '').match(/(\d+)/g);
          return m && m.length > 0 ? parseInt(m[m.length - 1], 10) || 0 : 0;
        };
        const sorted = [...healed].sort((a, b) => {
          const sA = getSeq(a);
          const sB = getSeq(b);
          if (sA !== 0 && sB !== 0 && sB !== sA) return sB - sA;
          const tA = new Date(a.completedAt || a.createdAt || 0).getTime();
          const tB = new Date(b.completedAt || b.createdAt || 0).getTime();
          if (tB !== tA) return tB - tA;
          return String(b.invoiceNumber || b.id || '').localeCompare(String(a.invoiceNumber || a.id || ''), undefined, { numeric: true });
        });
        updates.orders = sorted;
        storage.set('orders', sorted);
      }

      // 5. Reversals
      if (Array.isArray(revs)) {
        const localRevs = get().reversals || [];
        const seenRev = new Set();
        const mergedRevs = [];
        for (const r of revs) {
          const key = r.originalOrderId || r.originalInvoiceNumber || r.id;
          if (key && !seenRev.has(key)) {
            seenRev.add(key);
            mergedRevs.push(r);
          } else if (!key) {
            mergedRevs.push(r);
          }
        }
        for (const loc of localRevs) {
          const key = loc?.originalOrderId || loc?.originalInvoiceNumber || loc?.id;
          if (key && !seenRev.has(key)) {
            seenRev.add(key);
            mergedRevs.push(loc);
            ReversalRepository.create(loc).catch(() => {});
          }
        }
        updates.reversals = mergedRevs;
        storage.set('reversals', mergedRevs);
      }

      // 6. Expenses
      if (Array.isArray(exps)) {
        updates.expenses = exps;
        storage.set('expenses', exps);
      }

      // 6.5 Expense Categories
      if (Array.isArray(expCats)) {
        updates.expenseCategories = expCats;
        storage.set('expense_categories', expCats);
      }

      // 7. Tables
      if (Array.isArray(tbls)) {
        updates.tables = tbls;
        storage.set('tables', tbls);
      }

      // 8. Shift
      if (curShift !== undefined) {
        updates.currentShift = curShift;
      }

      // 9. Settings
      if (fetchedSettings && typeof fetchedSettings === 'object') {
        updates.settings = fetchedSettings;
        const defaultOrderType = fetchedSettings?.pos?.defaultOrderType || fetchedSettings?.defaultOrderType;
        if (defaultOrderType) {
          updates.orderType = defaultOrderType;
        }
      }

      if (Object.keys(updates).length > 0) {
        set(updates);
      }
    } catch (err) {
      console.warn('[Store] syncWithBackend warning:', err.message);
    }
  },
}));

export default useAppStore;
