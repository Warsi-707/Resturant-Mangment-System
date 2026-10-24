import mongoose from 'mongoose';
import { Expense } from '../models/Expense.js';
import { ExpenseCategory } from '../models/ExpenseCategory.js';
import { Order } from '../models/Order.js';
import { Reversal } from '../models/Reversal.js';
import { isDbConnected, connectDB } from '../config/db.js';
import { isCashierRequest } from '../middleware/authMiddleware.js';
import { DEFAULT_EXPENSE_CATEGORIES } from '../validators/expenseValidator.js';

// Helper: Ensure DB connection is active (handles serverless cold starts)
async function ensureDb() {
  if (isDbConnected()) return true;
  if (process.env.MONGODB_URI) {
    try {
      await connectDB();
      return isDbConnected();
    } catch (err) {
      console.warn('[ExpenseController] connectDB error:', err.message);
      return false;
    }
  }
  return false;
}

function getStartOfDay(d = new Date()) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getEndOfDay(d = new Date()) {
  const date = new Date(d);
  date.setHours(23, 59, 59, 999);
  return date;
}

function resolveDateFilter(preset, start, end) {
  const now = new Date();
  if (preset === 'Today') {
    return { $gte: getStartOfDay(now), $lte: getEndOfDay(now) };
  }
  if (preset === 'Yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { $gte: getStartOfDay(y), $lte: getEndOfDay(y) };
  }
  if (preset === 'This Week') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(diff);
    startOfWeek.setHours(0, 0, 0, 0);
    return { $gte: startOfWeek, $lte: getEndOfDay(now) };
  }
  if (preset === 'Last Week') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) - 7;
    const startOfLastWeek = new Date(now);
    startOfLastWeek.setDate(diff);
    startOfLastWeek.setHours(0, 0, 0, 0);
    const endOfLastWeek = new Date(startOfLastWeek);
    endOfLastWeek.setDate(startOfLastWeek.getDate() + 6);
    endOfLastWeek.setHours(23, 59, 59, 999);
    return { $gte: startOfLastWeek, $lte: endOfLastWeek };
  }
  if (preset === 'This Month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { $gte: startOfMonth, $lte: getEndOfDay(now) };
  }
  if (preset === 'Last Month') {
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { $gte: startOfLastMonth, $lte: endOfLastMonth };
  }
  if (preset === 'Custom' && start && end) {
    try {
      const s = new Date(start);
      const e = new Date(end);
      return { $gte: getStartOfDay(s), $lte: getEndOfDay(e) };
    } catch {
      return null;
    }
  }
  return null;
}

function resolveActor(req, body = {}) {
  const isCashierReq = isCashierRequest(req);
  const isCashier = Boolean(isCashierReq);
  const isAdmin = !isCashier;

  const actorId =
    req.user?.id ||
    req.user?._id ||
    req.headers?.['x-user-id'] ||
    req.query?.userId ||
    body?.createdByUserId ||
    (isAdmin ? 'user_admin' : 'user_cashier');

  const actorName =
    req.user?.name ||
    req.user?.username ||
    req.headers?.['x-user-name'] ||
    req.query?.userName ||
    body?.createdByName ||
    (isAdmin ? 'Admin' : 'Cashier');

  const actorRole = isAdmin ? 'admin' : 'cashier';

  return {
    id: String(actorId).trim(),
    name: String(actorName).trim(),
    role: actorRole,
    isCashier,
    isAdmin,
  };
}

/**
 * GET /api/expenses
 * List all expenses with filtering and summary cards data
 * - Admin: sees all expenses across all users
 * - Cashier: sees ONLY expenses entered by that logged-in cashier
 */
export async function getAllExpenses(req, res, next) {
  try {
    await ensureDb();
    const actor = resolveActor(req);

    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection unavailable. MongoDB is required for expenses.' },
      });
    }

    const {
      category,
      paymentMethod,
      status,
      datePreset,
      startDate,
      endDate,
      search,
    } = req.query;

    const query = {};

    // Role-based scoping: Cashier sees ONLY expenses created by their logged-in user ID
    if (actor.isCashier) {
      query.createdByUserId = actor.id;
      query.createdByRole = { $ne: 'admin' };
    }

    // 1. Status filter
    if (status && status !== 'All' && status !== 'all') {
      query.status = status.toUpperCase();
    }

    // 2. Category filter
    if (category && category !== 'All' && category !== 'all') {
      query.category = category;
    }

    // 3. Payment Method filter
    if (paymentMethod && paymentMethod !== 'All' && paymentMethod !== 'all') {
      const pmUpper = paymentMethod.toUpperCase();
      query.paymentMethod = { $regex: new RegExp(`^${pmUpper}$`, 'i') };
    }

    // 4. Date filter
    const dateRange = resolveDateFilter(datePreset, startDate, endDate);
    if (dateRange) {
      query.expenseDate = dateRange;
    }

    // 5. Search filter (Description, Reference, Online Method, Category)
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { description: searchRegex },
        { referenceNumber: searchRegex },
        { onlineMethodSnapshot: searchRegex },
        { category: searchRegex },
        { title: searchRegex },
        { note: searchRegex },
      ];
    }

    const expenses = await Expense.find(query).sort({ expenseDate: -1, createdAt: -1 });

    // Compute active summary strictly excluding VOIDED
    let totalExpenses = 0;
    let cashExpenses = 0;
    let onlineExpenses = 0;
    let activeCount = 0;
    let voidedCount = 0;

    expenses.forEach((e) => {
      const isVoided = String(e.status).toUpperCase() === 'VOIDED';
      if (isVoided) {
        voidedCount += 1;
      } else {
        activeCount += 1;
        const amt = Number(e.amount) || 0;
        totalExpenses += amt;
        const pm = String(e.paymentMethod).toUpperCase();
        if (pm === 'CASH') {
          cashExpenses += amt;
        } else if (pm === 'ONLINE') {
          onlineExpenses += amt;
        }
      }
    });

    return res.status(200).json({
      success: true,
      pagination: {
        total: expenses.length,
      },
      data: expenses,
      summary: {
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        totalAmount: Math.round(totalExpenses * 100) / 100,
        cashExpenses: Math.round(cashExpenses * 100) / 100,
        bankExpenses: Math.round(onlineExpenses * 100) / 100,
        onlineExpenses: Math.round(onlineExpenses * 100) / 100,
        categoryBreakdown: {},
        activeCount,
        voidedCount,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/expenses/:id
 * Retrieve single expense details
 */
export async function getExpenseById(req, res, next) {
  try {
    await ensureDb();
    const actor = resolveActor(req);

    const { id } = req.params;
    const query = mongoose.Types.ObjectId.isValid(id) ? { $or: [{ id }, { _id: id }] } : { id };
    const expense = await Expense.findOne(query);
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: `Expense with ID ${id} not found.`,
      });
    }

    // Role-based visibility: Cashier can ONLY see their own expenses (never Admin's or another Cashier's)
    if (actor.isCashier) {
      const isOwner =
        String(expense.createdByUserId).trim() === actor.id &&
        String(expense.createdByRole).toLowerCase() !== 'admin';
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only view your own expense records.',
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: expense,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/expenses
 * Create a new expense entry
 * - Both Admin and Cashier can record expenses
 * - Creator attribution derived from authenticated session
 */
export async function createExpense(req, res, next) {
  try {
    await ensureDb();
    const payload = { ...req.body };

    // Amount validation
    const amt = Number(payload.amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Expense amount must be strictly greater than zero.',
      });
    }
    payload.amount = Math.round(amt * 100) / 100;

    // Payment method normalization
    const pmStr = String(payload.paymentMethod || 'Cash').trim();
    const isOnline = pmStr.toUpperCase() === 'ONLINE';
    payload.paymentMethod = isOnline ? 'Online' : 'Cash';

    if (isOnline) {
      const onlineMethod = String(payload.onlineMethodSnapshot || '').trim();
      if (!onlineMethod) {
        return res.status(400).json({
          success: false,
          message: 'Online Method / Account is required when payment method is Online.',
        });
      }
      payload.onlineMethodSnapshot = onlineMethod;
    } else {
      payload.onlineMethodSnapshot = '';
    }

    // ID generation
    if (!payload.id) {
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      payload.id = `exp-${Date.now()}-${randomSuffix}`;
    }

    // Date resolution
    payload.expenseDate = payload.expenseDate ? new Date(payload.expenseDate) : new Date();

    // Actor identity from authenticated context (never fake)
    const actor = resolveActor(req, payload);

    payload.createdByUserId = actor.id;
    payload.createdByName = actor.name;
    payload.createdByRole = actor.role;
    payload.status = 'ACTIVE';

    // Description / Legacy aliases
    if (!payload.description && payload.title) {
      payload.description = payload.title;
    }
    if (!payload.description && payload.note) {
      payload.description = payload.note;
    }
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection unavailable. Cannot save expense without MongoDB.' },
      });
    }

    const expense = await Expense.create(payload);

    return res.status(201).json({
      success: true,
      message: 'Expense recorded successfully',
      data: expense,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/expenses/:id
 * Update an active expense entry
 * - Admin can edit any active expense
 * - Cashier can ONLY edit their own active expense
 */
export async function updateExpense(req, res, next) {
  try {
    await ensureDb();
    const actor = resolveActor(req);

    const { id } = req.params;
    const query = mongoose.Types.ObjectId.isValid(id) ? { $or: [{ id }, { _id: id }] } : { id };
    const existing = await Expense.findOne(query);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: `Expense with ID ${id} not found.`,
      });
    }

    // Cashier can ONLY update their own active expense
    if (actor.isCashier) {
      const isOwner =
        String(existing.createdByUserId).trim() === actor.id &&
        String(existing.createdByRole).toLowerCase() !== 'admin';
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only edit expenses you entered.',
        });
      }
    }

    if (String(existing.status).toUpperCase() === 'VOIDED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit an expense that has been voided.',
      });
    }

    const updates = { ...req.body };

    // Prevent Cashier from altering creator attribution or status
    if (actor.isCashier) {
      delete updates.createdByUserId;
      delete updates.createdByName;
      delete updates.createdByRole;
      delete updates.status;
    }

    if (updates.amount !== undefined) {
      const amt = Number(updates.amount);
      if (isNaN(amt) || amt <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Expense amount must be strictly greater than zero.',
        });
      }
      updates.amount = Math.round(amt * 100) / 100;
    }

    if (updates.paymentMethod !== undefined) {
      const isOnline = String(updates.paymentMethod).toUpperCase() === 'ONLINE';
      updates.paymentMethod = isOnline ? 'Online' : 'Cash';
      if (isOnline) {
        const method = String(updates.onlineMethodSnapshot || existing.onlineMethodSnapshot || '').trim();
        if (!method) {
          return res.status(400).json({
            success: false,
            message: 'Online Method / Account is required when payment method is Online.',
          });
        }
        updates.onlineMethodSnapshot = method;
      } else {
        updates.onlineMethodSnapshot = '';
      }
    }

    if (updates.expenseDate) {
      updates.expenseDate = new Date(updates.expenseDate);
    }

    // Audit fields
    updates.updatedByUserId = actor.id;
    updates.updatedByName = actor.name;
    updates.updatedAt = new Date();

    Object.assign(existing, updates);
    await existing.save();

    return res.status(200).json({
      success: true,
      message: 'Expense updated successfully',
      data: existing,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/expenses/:id/void
 * Void a posted expense record with reason
 */
export async function voidExpense(req, res, next) {
  try {
    await ensureDb();
    const actor = resolveActor(req);
    if (actor.isCashier) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Cashiers cannot void expenses.',
      });
    }

    const { id } = req.params;
    const { voidReason } = req.body;

    if (!voidReason || !voidReason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A void reason is required to void an expense.',
      });
    }

    const query = mongoose.Types.ObjectId.isValid(id) ? { $or: [{ id }, { _id: id }] } : { id };
    const expense = await Expense.findOne(query);
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: `Expense with ID ${id} not found.`,
      });
    }

    if (String(expense.status).toUpperCase() === 'VOIDED') {
      return res.status(400).json({
        success: false,
        message: 'This expense has already been voided.',
      });
    }

    const actorId = req.user?.id || req.user?._id || req.headers['x-user-id'] || 'admin_user';
    const actorName = req.user?.name || req.user?.username || req.headers['x-user-name'] || 'Admin';

    expense.status = 'VOIDED';
    expense.voidReason = voidReason.trim();
    expense.voidedAt = new Date();
    expense.voidedByUserId = String(actorId);
    expense.voidedByName = String(actorName);

    await expense.save();

    return res.status(200).json({
      success: true,
      message: 'Expense has been voided successfully. It will contribute 0 to active financial totals.',
      data: expense,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/expenses/:id
 * Delete an expense entry
 */
export async function deleteExpense(req, res, next) {
  try {
    await ensureDb();
    const { id } = req.params;
    const query = mongoose.Types.ObjectId.isValid(id) ? { $or: [{ id }, { _id: id }] } : { id };
    if (isDbConnected()) {
      await Expense.findOneAndDelete(query);
    }
    return res.status(200).json({
      success: true,
      message: 'Expense deleted successfully',
      data: { id },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/expenses/categories
 * List all expense categories
 */
export async function getAllCategories(req, res, next) {
  try {
    await ensureDb();
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection unavailable. MongoDB is required for expense categories.' },
      });
    }

    const categories = await ExpenseCategory.find().sort({ name: 1 });
    return res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/expenses/categories
 * Add a new expense category
 */
export async function createCategory(req, res, next) {
  try {
    await ensureDb();
    const actor = resolveActor(req);
    if (actor.isCashier) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Cashiers cannot manage expense categories.',
      });
    }

    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection unavailable. Cannot save expense category without MongoDB.' },
      });
    }

    const { name, description = '', status = 'active' } = req.body;
    const cleanName = String(name).trim();

    const existing = await ExpenseCategory.findOne({
      name: { $regex: new RegExp(`^${cleanName}$`, 'i') },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `An expense category named "${cleanName}" already exists.`,
      });
    }

    const id = `exp-cat-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const newCategory = await ExpenseCategory.create({
      id,
      name: cleanName,
      description: description.trim(),
      status,
      isDefault: false,
    });

    return res.status(201).json({
      success: true,
      message: 'Expense category created successfully.',
      data: newCategory,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/expenses/categories/:id
 * Edit an expense category
 */
export async function updateCategory(req, res, next) {
  try {
    const actor = resolveActor(req);
    if (actor.isCashier) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Cashiers cannot manage expense categories.',
      });
    }

    const { id } = req.params;
    const { name, description, status } = req.body;

    if (!isDbConnected()) {
      return res.status(200).json({ success: true, data: { id, name, description, status } });
    }

    const category = await ExpenseCategory.findOne({ $or: [{ id }, { _id: id }] });
    if (!category) {
      return res.status(404).json({
        success: false,
        message: `Expense category ${id} not found.`,
      });
    }

    if (name && name.trim()) {
      const cleanName = name.trim();
      const existing = await ExpenseCategory.findOne({
        _id: { $ne: category._id },
        name: { $regex: new RegExp(`^${cleanName}$`, 'i') },
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Another category named "${cleanName}" already exists.`,
        });
      }
      category.name = cleanName;
    }

    if (description !== undefined) category.description = description.trim();
    if (status !== undefined) category.status = status;

    await category.save();

    return res.status(200).json({
      success: true,
      message: 'Expense category updated successfully.',
      data: category,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/expenses/categories/:id
 * Delete a category ONLY IF no historical expense records depend on it
 */
export async function deleteCategory(req, res, next) {
  try {
    const actor = resolveActor(req);
    if (actor.isCashier) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Cashiers cannot manage expense categories.',
      });
    }

    const { id } = req.params;
    if (!isDbConnected()) {
      return res.status(200).json({ success: true, message: 'Category removed.' });
    }

    const category = await ExpenseCategory.findOne({ $or: [{ id }, { _id: id }] });
    if (!category) {
      return res.status(404).json({
        success: false,
        message: `Expense category ${id} not found.`,
      });
    }

    // Check dependency: do NOT allow deletion if expenses depend on it!
    const dependentCount = await Expense.countDocuments({
      $or: [{ categoryId: category.id }, { category: category.name }],
    });

    if (dependentCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category "${category.name}" because ${dependentCount} historical expense record(s) depend on it. Please deactivate the category instead.`,
      });
    }

    await ExpenseCategory.deleteOne({ _id: category._id });

    return res.status(200).json({
      success: true,
      message: 'Expense category deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/expenses/profit-and-loss
 * Standard Operating Profit calculation:
 * Gross Profit = Net Revenue - COGS
 * Operating Profit = Gross Profit - Active Operating Expenses
 */
export async function getProfitAndLossSummary(req, res, next) {
  try {
    const actor = resolveActor(req);
    if (actor.isCashier) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Cashiers are not authorized to view Operating Profit.',
      });
    }

    const { datePreset = 'This Month', startDate, endDate } = req.query;
    const dateRange = resolveDateFilter(datePreset, startDate, endDate);

    const orderQuery = { status: 'completed' };
    const reversalQuery = {};
    const expenseQuery = { status: 'ACTIVE' };

    if (dateRange) {
      orderQuery.createdAt = dateRange;
      reversalQuery.createdAt = dateRange;
      expenseQuery.expenseDate = dateRange;
    }

    const [orders, reversals, expenses] = await Promise.all([
      isDbConnected() ? Order.find(orderQuery) : [],
      isDbConnected() ? Reversal.find(reversalQuery) : [],
      isDbConnected() ? Expense.find(expenseQuery) : [],
    ]);

    const reversedOrderIds = new Set(reversals.map((r) => r.orderId));
    const validOrders = orders.filter((o) => !reversedOrderIds.has(o.id));

    const grossSales = validOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0);
    const taxCollected = validOrders.reduce((sum, o) => sum + (Number(o.taxAmount) || 0), 0);
    const netRevenue = grossSales - taxCollected;

    // Estimate COGS from line items cost snapshot
    const totalCOGS = validOrders.reduce((sum, o) => {
      const orderCOGS = (o.lines || []).reduce((lSum, l) => {
        const itemCost = Number(l.costPrice || l.cost || 0);
        const qty = Number(l.quantity || 1);
        return lSum + (itemCost * qty);
      }, 0);
      return sum + orderCOGS;
    }, 0);

    const grossProfit = netRevenue - totalCOGS;

    // Total Operating Expenses (ACTIVE only)
    const operatingExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const operatingProfit = grossProfit - operatingExpenses;

    const cashExpenses = expenses
      .filter((e) => String(e.paymentMethod).toUpperCase() === 'CASH')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const onlineExpenses = expenses
      .filter((e) => String(e.paymentMethod).toUpperCase() === 'ONLINE')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const pnlObj = {
      grossBilledSales: Math.round(grossSales),
      totalReversals: 0,
      netRevenue: Math.round(netRevenue),
      totalExpenses: Math.round(operatingExpenses),
      netOperatingProfit: Math.round(operatingProfit),
      profitMarginPercent: netRevenue > 0 ? Number(((operatingProfit / netRevenue) * 100).toFixed(1)) : 0,
      isProfitable: operatingProfit >= 0,
    };

    return res.status(200).json({
      success: true,
      pnl: pnlObj,
      data: {
        period: datePreset,
        grossSales: Math.round(grossSales),
        netRevenue: Math.round(netRevenue),
        totalCOGS: Math.round(totalCOGS),
        grossProfit: Math.round(grossProfit),
        operatingExpenses: Math.round(operatingExpenses),
        operatingProfit: Math.round(operatingProfit),
        cashExpenses: Math.round(cashExpenses),
        onlineExpenses: Math.round(onlineExpenses),
        isProfitable: operatingProfit >= 0,
        activeExpenseCount: expenses.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/expenses/seed
 * Seed sample initial expenses if collection is empty
 */
export async function seedExpenses(req, res, next) {
  try {
    await ensureDb();
    if (isCashierRequest(req)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { force = false } = req.query;

    if (force === 'true' || force === true) {
      if (isDbConnected()) {
        await Expense.deleteMany({});
      }
    }

    let count = 0;
    if (isDbConnected()) {
      count = await Expense.countDocuments();
    }

    if (count > 0 && !force) {
      return res.status(200).json({
        success: true,
        message: `Expenses already seeded. Total: ${count}`,
        count,
      });
    }

    const sampleExpenses = [
      {
        id: 'exp-seed-01',
        title: 'Fresh Chicken & Meat Supply (30 Kg)',
        category: 'Raw Materials / Meat & Groceries',
        categoryNameSnapshot: 'Raw Materials / Meat & Groceries',
        amount: 16500,
        paymentMethod: 'Cash',
        status: 'ACTIVE',
        description: 'Fresh broiler chicken for Biryani and Karahi',
        referenceNumber: 'RCP-8812',
        createdByRole: 'admin',
        createdByName: 'Admin',
        expenseDate: new Date(Date.now() - 3600000 * 24),
      },
      {
        id: 'exp-seed-02',
        title: 'Commercial LPG Cylinder Refill (45kg)',
        category: 'Utilities',
        categoryNameSnapshot: 'Utilities',
        amount: 8500,
        paymentMethod: 'Cash',
        status: 'ACTIVE',
        description: 'Kitchen main burner commercial cylinder',
        referenceNumber: 'RCP-4419',
        createdByRole: 'admin',
        createdByName: 'Admin',
        expenseDate: new Date(Date.now() - 3600000 * 12),
      },
      {
        id: 'exp-seed-03',
        title: 'Food Packaging Boxes & Plastic Bags',
        category: 'Supplies',
        categoryNameSnapshot: 'Supplies',
        amount: 4200,
        paymentMethod: 'Cash',
        status: 'ACTIVE',
        description: 'Burger packaging boxes, foil wrap, carry bags',
        referenceNumber: 'RCP-9901',
        createdByRole: 'admin',
        createdByName: 'Admin',
        expenseDate: new Date(Date.now() - 3600000 * 6),
      },
      {
        id: 'exp-seed-04',
        title: 'Cooking Oil, Basmati Rice & Masala Spices',
        category: 'Raw Materials / Meat & Groceries',
        categoryNameSnapshot: 'Raw Materials / Meat & Groceries',
        amount: 12000,
        paymentMethod: 'Online',
        onlineMethodSnapshot: 'Meezan Bank',
        status: 'ACTIVE',
        description: '2 tins cooking oil, 50kg rice, whole spices',
        referenceNumber: 'INV-MT-1029',
        createdByRole: 'admin',
        createdByName: 'Admin',
        expenseDate: new Date(Date.now() - 3600000 * 4),
      },
    ];

    if (isDbConnected()) {
      await Expense.insertMany(sampleExpenses);
    }

    return res.status(200).json({
      success: true,
      message: 'Sample expenses seeded successfully in MongoDB Atlas',
      count: sampleExpenses.length,
      data: sampleExpenses,
    });
  } catch (error) {
    next(error);
  }
}
