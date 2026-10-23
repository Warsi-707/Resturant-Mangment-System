import { Category } from '../models/Category.js';
import { MenuItem } from '../models/Item.js';
import { Addon } from '../models/Addon.js';
import { Table } from '../models/Table.js';
import { Deal } from '../models/Deal.js';
import { Settings } from '../models/Settings.js';
import { ExpenseCategory } from '../models/ExpenseCategory.js';
import { ensureDefaultUsers } from '../controllers/authController.js';
import { defaultCategories } from '../data/defaultCategories.js';
import { defaultItems } from '../data/defaultItems.js';
import { defaultAddons } from '../data/defaultAddons.js';
import { DEFAULT_EXPENSE_CATEGORIES } from '../validators/expenseValidator.js';

const defaultTables = [
  { id: 'tbl-1', number: 1, name: 'Table 1', capacity: 2, zone: 'Main Dining Hall', status: 'available' },
  { id: 'tbl-2', number: 2, name: 'Table 2', capacity: 4, zone: 'Main Dining Hall', status: 'available' },
  { id: 'tbl-3', number: 3, name: 'Table 3', capacity: 4, zone: 'Main Dining Hall', status: 'available' },
  { id: 'tbl-4', number: 4, name: 'Table 4', capacity: 6, zone: 'Main Dining Hall', status: 'available' },
  { id: 'tbl-5', number: 5, name: 'Table 5', capacity: 6, zone: 'Main Dining Hall', status: 'available' },
  { id: 'tbl-6', number: 6, name: 'Family Booth 1', capacity: 6, zone: 'Family Section', status: 'available' },
  { id: 'tbl-7', number: 7, name: 'Family Booth 2', capacity: 8, zone: 'Family Section', status: 'available' },
  { id: 'tbl-8', number: 8, name: 'Family Booth 3', capacity: 8, zone: 'Family Section', status: 'available' },
  { id: 'tbl-9', number: 9, name: 'Terrace Garden 1', capacity: 4, zone: 'Outdoor Terrace', status: 'available' },
  { id: 'tbl-10', number: 10, name: 'Terrace Garden 2', capacity: 4, zone: 'Outdoor Terrace', status: 'available' },
  { id: 'tbl-11', number: 11, name: 'VIP Executive Room 1', capacity: 10, zone: 'VIP Lounge', status: 'available' },
  { id: 'tbl-12', number: 12, name: 'VIP Executive Room 2', capacity: 12, zone: 'VIP Lounge', status: 'available' },
];

let bootstrapPromise = null;

export async function bootstrapDatabase() {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      // 1. Ensure Default Users
      await ensureDefaultUsers().catch((err) => console.warn('[Bootstrap] Users seed warn:', err.message));

      // 2. Ensure Categories
      const catCount = await Category.countDocuments();
      if (catCount === 0) {
        for (const cat of defaultCategories) {
          await Category.findOneAndUpdate(
            { id: cat.id },
            { $set: cat },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
        console.log(`[Bootstrap] Seeded ${defaultCategories.length} categories into MongoDB.`);
      }

      // 3. Ensure Menu Items
      const itemCount = await MenuItem.countDocuments();
      if (itemCount === 0) {
        for (const it of defaultItems) {
          await MenuItem.findOneAndUpdate(
            { id: it.id },
            { $set: it },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
        console.log(`[Bootstrap] Seeded ${defaultItems.length} menu items into MongoDB.`);
      }

      // 4. Ensure Add-ons
      const addonCount = await Addon.countDocuments();
      if (addonCount === 0) {
        for (const add of defaultAddons) {
          await Addon.findOneAndUpdate(
            { id: add.id },
            { $set: add },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
        console.log(`[Bootstrap] Seeded ${defaultAddons.length} add-ons into MongoDB.`);
      }

      // 5. Ensure Tables
      const tableCount = await Table.countDocuments();
      if (tableCount === 0) {
        for (const tbl of defaultTables) {
          await Table.findOneAndUpdate(
            { id: tbl.id },
            { $set: tbl },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
        console.log(`[Bootstrap] Seeded ${defaultTables.length} tables into MongoDB.`);
      }

      // 6. Ensure Expense Categories
      const expCatCount = await ExpenseCategory.countDocuments();
      if (expCatCount === 0) {
        for (const name of DEFAULT_EXPENSE_CATEGORIES) {
          const catId = `exp-cat-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          await ExpenseCategory.findOneAndUpdate(
            { id: catId },
            { $set: { id: catId, name, isDefault: true, status: 'active' } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
        console.log(`[Bootstrap] Seeded ${DEFAULT_EXPENSE_CATEGORIES.length} expense categories into MongoDB.`);
      }

      // 6.5. Ensure Deals
      const dealCount = await Deal.countDocuments();
      if (dealCount === 0) {
        await Deal.create({
          id: 'deal-student-combo',
          name: 'Student Biryani Combo',
          description: 'Special Chicken Biryani + Soft Drink + Raita Salad Bundle',
          dealPrice: 850,
          status: 'active',
          sortOrder: 1,
          includedItems: [
            {
              itemId: 'item-1',
              itemType: 'item',
              name: 'Special Chicken Biryani',
              quantity: 1,
              unit: 'kg',
              portion: '1kg',
              sellingPrice: 900,
              costPrice: 500,
            },
          ],
        });
        console.log('[Bootstrap] Seeded initial starter deal into MongoDB.');
      }

      // 7. Ensure Settings
      const settingsCount = await Settings.countDocuments();
      if (settingsCount === 0) {
        await Settings.create({
          id: 'system-settings',
          businessName: 'Royal Spice Restaurant & POS',
          tagline: 'Authentic Traditional & Fast Food',
          phone: '+92 300 1234567',
          email: 'info@royalspice.com',
          address: 'Main Boulevard, Gulberg, Lahore, Pakistan',
          ntn: 'NTN-7894561-2',
          defaultTaxRate: 16,
          isTaxEnabled: true,
          invoicePrefix: 'INV-',
          footerNote: 'Thank you for your visit! Please visit again.',
          currencySymbol: 'Rs',
        });
        console.log('[Bootstrap] Seeded initial system settings into MongoDB.');
      }
    } catch (err) {
      console.warn('[Bootstrap] Auto-seed warning:', err.message);
    }
  })();

  return bootstrapPromise;
}
