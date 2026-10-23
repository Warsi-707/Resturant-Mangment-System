/**
 * Expense & Accounting Repository
 * Connects POS expenses & categories to Express REST API & MongoDB Atlas.
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

const EXPENSES_STORAGE_KEY = 'expenses';
const CATEGORIES_STORAGE_KEY = 'expense_categories';

export const ExpenseRepository = {
  /**
   * Fetch all expenses with optional filters
   */
  getAll: async (params = {}) => {
    if (isTestEnv()) {
      const saved = storage.get(EXPENSES_STORAGE_KEY, []);
      return Array.isArray(saved) ? saved : [];
    }

    const query = new URLSearchParams(params).toString();
    const endpoint = query ? `/expenses?${query}` : '/expenses';
    const res = await api.get(endpoint);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to fetch expenses from MongoDB');
  },

  /**
   * Fetch a single expense by ID
   */
  getById: async (id) => {
    if (isTestEnv()) {
      const all = storage.get(EXPENSES_STORAGE_KEY, []) || [];
      return all.find((e) => e.id === id || e._id === id) || null;
    }

    try {
      const res = await api.get(`/expenses/${id}`);
      if (res && res.success && res.data) {
        return res.data;
      }
    } catch {
      // Ignored
    }
    return null;
  },

  /**
   * Create a new expense record
   */
  create: async (expensePayload) => {
    if (isTestEnv()) {
      const all = storage.get(EXPENSES_STORAGE_KEY, []) || [];
      const fallbackExpense = {
        ...expensePayload,
        id: expensePayload.id || `exp-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        status: 'ACTIVE',
        expenseDate: expensePayload.expenseDate || new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const updated = [fallbackExpense, ...all.filter((e) => e.id !== fallbackExpense.id)];
      storage.set(EXPENSES_STORAGE_KEY, updated);
      return fallbackExpense;
    }

    const res = await api.post('/expenses', expensePayload);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to create expense in MongoDB');
  },

  /**
   * Update an existing expense record
   */
  update: async (id, updates) => {
    if (isTestEnv()) {
      const all = storage.get(EXPENSES_STORAGE_KEY, []) || [];
      let updatedItem = null;
      const updated = all.map((e) => {
        if (e.id === id || e._id === id) {
          updatedItem = { ...e, ...updates, updatedAt: new Date().toISOString() };
          return updatedItem;
        }
        return e;
      });
      storage.set(EXPENSES_STORAGE_KEY, updated);
      return updatedItem;
    }

    const res = await api.put(`/expenses/${id}`, updates);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to update expense in MongoDB');
  },

  /**
   * Void a posted expense (Audit preservation — NO hard deletion)
   */
  void: async (id, voidReason, actor = { id: '', name: 'Admin' }) => {
    if (isTestEnv()) {
      const all = storage.get(EXPENSES_STORAGE_KEY, []) || [];
      let voidedItem = null;
      const updated = all.map((e) => {
        if (e.id === id || e._id === id) {
          voidedItem = {
            ...e,
            status: 'VOIDED',
            voidReason,
            voidedAt: new Date().toISOString(),
            voidedByUserId: actor.id || '',
            voidedByName: actor.name || 'Admin',
            updatedAt: new Date().toISOString(),
          };
          return voidedItem;
        }
        return e;
      });
      storage.set(EXPENSES_STORAGE_KEY, updated);
      return voidedItem;
    }

    const res = await api.post(`/expenses/${id}/void`, { voidReason });
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to void expense in MongoDB');
  },

  /**
   * Fetch all expense categories
   */
  getCategories: async () => {
    if (isTestEnv()) {
      const saved = storage.get(CATEGORIES_STORAGE_KEY, null);
      if (Array.isArray(saved)) return saved;
      return [];
    }

    const res = await api.get('/expenses/categories');
    if (res && res.success && Array.isArray(res.data)) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to fetch expense categories from MongoDB');
  },

  /**
   * Create an expense category
   */
  createCategory: async (categoryPayload) => {
    if (isTestEnv()) {
      const all = storage.get(CATEGORIES_STORAGE_KEY, []) || [];
      const newCategory = {
        ...categoryPayload,
        id: categoryPayload.id || `exp-cat-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        status: categoryPayload.status || 'active',
        isDefault: false,
        createdAt: new Date().toISOString(),
      };
      storage.set(CATEGORIES_STORAGE_KEY, [...all, newCategory]);
      return newCategory;
    }

    const res = await api.post('/expenses/categories', categoryPayload);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to create expense category in MongoDB');
  },

  /**
   * Update an expense category
   */
  updateCategory: async (id, updates) => {
    if (isTestEnv()) {
      const all = storage.get(CATEGORIES_STORAGE_KEY, []) || [];
      let updatedCat = null;
      const updated = all.map((c) => {
        if (c.id === id || c._id === id) {
          updatedCat = { ...c, ...updates, updatedAt: new Date().toISOString() };
          return updatedCat;
        }
        return c;
      });
      storage.set(CATEGORIES_STORAGE_KEY, updated);
      return updatedCat;
    }

    const res = await api.put(`/expenses/categories/${id}`, updates);
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error(res?.error?.message || 'Failed to update expense category in MongoDB');
  },

  /**
   * Delete an expense category
   */
  deleteCategory: async (id) => {
    if (isTestEnv()) {
      const categories = storage.get(CATEGORIES_STORAGE_KEY, []) || [];
      const updated = categories.filter((c) => c.id !== id && c._id !== id);
      storage.set(CATEGORIES_STORAGE_KEY, updated);
      return true;
    }

    const res = await api.delete(`/expenses/categories/${id}`);
    return Boolean(res && res.success);
  },
};

export default ExpenseRepository;
