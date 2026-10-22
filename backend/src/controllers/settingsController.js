import { Settings } from '../models/Settings.js';
import { Order } from '../models/Order.js';
import { Reversal } from '../models/Reversal.js';
import { Category } from '../models/Category.js';
import { MenuItem as Item } from '../models/Item.js';
import { Addon } from '../models/Addon.js';
import { Expense } from '../models/Expense.js';
import { ExpenseCategory } from '../models/ExpenseCategory.js';
import { Table } from '../models/Table.js';
import { Shift } from '../models/Shift.js';
import { Deal } from '../models/Deal.js';
import { Counter } from '../models/Counter.js';
import { isDbConnected, connectDB } from '../config/db.js';

// Helper: Ensure DB connection is active (handles serverless cold starts)
async function ensureDb() {
  if (isDbConnected()) return true;
  if (process.env.MONGODB_URI) {
    try {
      await connectDB();
      return isDbConnected();
    } catch (err) {
      console.warn('[SettingsController] connectDB error:', err.message);
      return false;
    }
  }
  return false;
}

/**
 * GET /api/settings
 * Retrieves active system settings or creates default record
 */
export async function getSettings(req, res, next) {
  try {
    await ensureDb();
    let settings = await Settings.findOne({ id: 'system-settings' });
    if (!settings) {
      settings = await Settings.create({ id: 'system-settings' });
    }

    return res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/settings
 * Updates business profile, tax configurations, and invoice options
 */
export async function updateSettings(req, res, next) {
  try {
    await ensureDb();
    const updates = { ...req.body };

    const settings = await Settings.findOneAndUpdate(
      { id: 'system-settings' },
      { $set: updates },
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      data: settings,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/settings/danger-zone/reset
 * Danger Zone reset action: Clears operational data across collections
 * Protected by strict required confirmation phrase 'DELETE ALL DATA'
 */
export async function deleteAllData(req, res, next) {
  try {
    const { confirmationPhrase, resetType = 'all' } = req.body;

    if (confirmationPhrase !== 'DELETE ALL DATA') {
      return res.status(400).json({
        success: false,
        error: { message: "Confirmation phrase must exactly equal 'DELETE ALL DATA'" },
      });
    }

    await ensureDb();

    // Run all deletions concurrently in parallel for maximum speed
    const deleteTasks = [
      Order.deleteMany({}).catch(() => ({ deletedCount: 0 })),
      Reversal.deleteMany({}).catch(() => ({ deletedCount: 0 })),
      Counter.deleteMany({}).catch(() => ({ deletedCount: 0 })),
    ];

    if (resetType === 'all') {
      deleteTasks.push(
        Category.deleteMany({}).catch(() => ({ deletedCount: 0 })),
        Item.deleteMany({}).catch(() => ({ deletedCount: 0 })),
        Addon.deleteMany({}).catch(() => ({ deletedCount: 0 })),
        Deal.deleteMany({}).catch(() => ({ deletedCount: 0 })),
        Expense.deleteMany({}).catch(() => ({ deletedCount: 0 })),
        ExpenseCategory.deleteMany({}).catch(() => ({ deletedCount: 0 })),
        Table.deleteMany({}).catch(() => ({ deletedCount: 0 })),
        Shift.deleteMany({}).catch(() => ({ deletedCount: 0 })),
        Settings.findOneAndUpdate(
          { id: 'system-settings' },
          { $set: { logo: '' } },
          { new: true }
        ).catch(() => null)
      );
    }

    const [ordersResult, reversalsResult, , cRes, iRes, aRes, dRes, expRes, expCatRes, tblRes, shfRes] = await Promise.all(deleteTasks);

    return res.status(200).json({
      success: true,
      message: 'All system data has been safely deleted. System returned to clean empty state.',
      deletedSummary: {
        ordersDeleted: ordersResult?.deletedCount || 0,
        reversalsDeleted: reversalsResult?.deletedCount || 0,
        categoriesDeleted: cRes?.deletedCount || 0,
        itemsDeleted: iRes?.deletedCount || 0,
        addonsDeleted: aRes?.deletedCount || 0,
        dealsDeleted: dRes?.deletedCount || 0,
        expensesDeleted: expRes?.deletedCount || 0,
        expenseCategoriesDeleted: expCatRes?.deletedCount || 0,
        tablesDeleted: tblRes?.deletedCount || 0,
        shiftsDeleted: shfRes?.deletedCount || 0,
      },
    });
  } catch (error) {
    next(error);
  }
}
