import mongoose from 'mongoose';
import { MenuItem } from '../models/Item.js';
import { Category } from '../models/Category.js';
import { defaultItems } from '../data/defaultItems.js';
import cloudinary from '../config/cloudinary.js';
import { isDbConnected } from '../config/db.js';
import { isCashierRequest } from '../middleware/authMiddleware.js';

// Precompiled regex with word boundaries for high-performance, accurate tiering
const DESSERT_REGEX = /\b(desert|dessert|sweet|ice\s*cream|icecream|kheer|halwa|gulab\s*jamun|jalebi|rasmalai|mithai|meetha|falooda|custard|pudding|cake|pastry|brownie)\b/i;

const DRINK_REGEX = /\b(drink|coldrink|cold\s*drink|softdrink|soft\s*drink|beverage|water|juice|soda|shake|smoothie|dew|coke|pepsi|fanta|sprite|m[ia]rinda|7\s*up|sting|red\s*bull|monster|lemonade|lassi|mineral\s*water|cold\s*item|tea|coffee|chai|bottle)\b/i;

/**
 * Escapes special characters for safe use in a RegExp
 */
function escapeRegex(text) {
  return String(text).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/**
 * Builds unified query filter for custom slug id or Mongo _id
 */
function buildIdFilter(id) {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return { $or: [{ id }, { _id: id }] };
  }
  return { id };
}

/**
 * Sanitizes sensitive fields (e.g. costPrice) based on role
 */
function sanitizeItemForClient(item, isCashier) {
  if (!item) return item;
  const doc = typeof item.toObject === 'function' ? item.toObject() : { ...item };
  if (isCashier) {
    delete doc.costPrice;
  }
  return doc;
}

/**
 * Categorizes a menu item into display tiers:
 * Tier 1: Main food items
 * Tier 2: Desserts & Sweets
 * Tier 3: Drinks & Beverages
 */
export function getItemTier(item) {
  const combined = `${item?.categoryName || ''} ${item?.name || ''} ${item?.description || ''}`;

  if (DESSERT_REGEX.test(combined)) return 2;
  if (DRINK_REGEX.test(combined)) return 3;

  return 1;
}

/**
 * GET /api/items
 * Retrieve items with category, status, search, and sorting support
 */
export async function getAllItems(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        offline: true,
      });
    }

    const { categoryId, status, search, sort = 'createdAt' } = req.query;
    const filter = {};

    if (categoryId && categoryId.trim()) {
      filter.categoryId = categoryId.trim();
    }

    if (status && ['active', 'inactive'].includes(status)) {
      filter.status = status;
    }

    if (search && search.trim()) {
      const safePattern = escapeRegex(search.trim());
      const searchRegex = new RegExp(safePattern, 'i');
      filter.$or = [
        { name: searchRegex },
        { description: searchRegex },
      ];
    }

    const sortOption = {};
    if (sort === 'name') sortOption.name = 1;
    else if (sort === '-name') sortOption.name = -1;
    else if (sort === 'price') sortOption.basePrice = 1;
    else if (sort === '-price') sortOption.basePrice = -1;
    else if (sort === '-createdAt') sortOption.createdAt = -1;
    else sortOption.createdAt = 1;

    let items = await MenuItem.find(filter).sort(sortOption);

    // Default natural sorting: Food first, Desserts next, Drinks/Water last
    // Memoize tiers so getItemTier is computed once per item, avoiding O(N log N) regex re-evaluations
    if (sort === 'createdAt' && items.length > 0) {
      const tierMap = new Map();
      for (const item of items) {
        tierMap.set(item.id || item._id, getItemTier(item));
      }

      items = [...items].sort((a, b) => {
        const tierA = tierMap.get(a.id || a._id) ?? 1;
        const tierB = tierMap.get(b.id || b._id) ?? 1;
        if (tierA !== tierB) return tierA - tierB;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
      });
    }

    const isCashier = isCashierRequest(req);
    const sanitizedItems = isCashier
      ? items.map((item) => sanitizeItemForClient(item, true))
      : items;

    return res.status(200).json({
      success: true,
      count: sanitizedItems.length,
      data: sanitizedItems,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/items/:id
 * Retrieve a single item by custom id (e.g. item-1) or MongoDB _id
 */
export async function getItemById(req, res, next) {
  try {
    const { id } = req.params;
    const query = buildIdFilter(id);

    const item = await MenuItem.findOne(query);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: { message: `Menu item with ID '${id}' not found` },
      });
    }

    const isCashier = isCashierRequest(req);
    const doc = sanitizeItemForClient(item, isCashier);

    return res.status(200).json({
      success: true,
      data: doc,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/items
 * Create a new menu item
 */
export async function createItem(req, res, next) {
  try {
    const payload = { ...req.body };

    // Validate that categoryId exists in database, or find by name / Mongo _id
    let category = await Category.findOne({
      $or: [
        { id: payload.categoryId },
        ...(mongoose.Types.ObjectId.isValid(payload.categoryId) ? [{ _id: payload.categoryId }] : []),
        ...(payload.categoryName ? [{ name: new RegExp('^' + escapeRegex(payload.categoryName) + '$', 'i') }] : []),
      ],
    });

    if (!category) {
      const catName = payload.categoryName || (payload.categoryId ? payload.categoryId.replace(/^cat-/, '').replace(/-/g, ' ') : 'General');
      category = await Category.create({
        id: payload.categoryId || `cat-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        name: catName,
        status: 'active',
      }).catch(() => null);
    }

    // Set categoryName snapshot if not passed
    if (category && !payload.categoryName) {
      payload.categoryName = category.name;
    }

    // Auto-generate unique ID if not provided
    if (!payload.id) {
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      payload.id = `item-${Date.now()}-${randomSuffix}`;
    }

    // Auto-upload base64 images to Cloudinary so MongoDB stays lightweight
    if (payload.imageRef && payload.imageRef.startsWith('data:')) {
      try {
        const uploadRes = await cloudinary.uploader.upload(payload.imageRef, {
          folder: 'rms_pos/menu',
          resource_type: 'image',
        });
        payload.imageRef = uploadRes.secure_url;
      } catch (err) {
        console.warn('[itemController] Cloudinary auto-upload warning:', err.message);
        // Avoid persisting multi-megabyte base64 strings into MongoDB document on failure
        delete payload.imageRef;
      }
    }

    // Check duplicate ID
    const existing = await MenuItem.findOne({ id: payload.id });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { message: `Menu item with ID '${payload.id}' already exists` },
      });
    }

    const item = await MenuItem.create(payload);

    return res.status(201).json({
      success: true,
      message: 'Menu item created successfully',
      data: item,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: { message: `Menu item with ID '${req.body?.id}' already exists` },
      });
    }
    next(error);
  }
}

/**
 * PUT /api/items/:id
 * Update an existing menu item by custom id or _id
 */
export async function updateItem(req, res, next) {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // Protect primary identifiers from accidental mutation
    delete updates._id;
    delete updates.id;

    // If categoryId is changed, verify new category exists and update categoryName
    if (updates.categoryId) {
      const category = await Category.findOne({ id: updates.categoryId });
      if (!category) {
        return res.status(400).json({
          success: false,
          error: { message: `Referenced Category ID '${updates.categoryId}' does not exist` },
        });
      }
      if (!updates.categoryName) {
        updates.categoryName = category.name;
      }
    }

    // Auto-upload base64 images to Cloudinary so MongoDB stays lightweight
    if (updates.imageRef && updates.imageRef.startsWith('data:')) {
      try {
        const uploadRes = await cloudinary.uploader.upload(updates.imageRef, {
          folder: 'rms_pos/menu',
          resource_type: 'image',
        });
        updates.imageRef = uploadRes.secure_url;
      } catch (err) {
        console.warn('[itemController] Cloudinary auto-upload warning:', err.message);
        // Don't overwrite imageRef with huge raw base64 data on failed upload
        delete updates.imageRef;
      }
    }

    const query = buildIdFilter(id);

    const item = await MenuItem.findOneAndUpdate(
      query,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        error: { message: `Menu item with ID '${id}' not found` },
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Menu item updated successfully',
      data: item,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/items/:id
 * Delete a menu item by custom id or _id
 */
export async function deleteItem(req, res, next) {
  try {
    const { id } = req.params;
    const query = buildIdFilter(id);

    const item = await MenuItem.findOneAndDelete(query);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: { message: `Menu item with ID '${id}' not found` },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Menu item '${item.name}' (${item.id}) deleted successfully`,
      data: { id: item.id, name: item.name },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/items/seed
 * Upsert canonical default items into MongoDB Atlas using bulk operations
 */
export async function seedItems(req, res, next) {
  try {
    const { force = false } = req.query;

    if (force === 'true' || force === true) {
      await MenuItem.deleteMany({});
    }

    const operations = defaultItems.map((item) => ({
      updateOne: {
        filter: { id: item.id },
        update: { $set: item },
        upsert: true,
      },
    }));

    if (operations.length > 0) {
      await MenuItem.bulkWrite(operations, { ordered: false });
    }

    const seededItems = await MenuItem.find({
      id: { $in: defaultItems.map((d) => d.id) },
    });
    const totalCount = await MenuItem.countDocuments();

    return res.status(200).json({
      success: true,
      message: `Default menu items seeded successfully in MongoDB Atlas. Total items: ${totalCount}`,
      count: seededItems.length,
      data: seededItems,
    });
  } catch (error) {
    next(error);
  }
}
