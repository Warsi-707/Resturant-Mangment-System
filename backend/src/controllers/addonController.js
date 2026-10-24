import mongoose from 'mongoose';
import { Addon } from '../models/Addon.js';
import { defaultAddons } from '../data/defaultAddons.js';
import { isDbConnected } from '../config/db.js';
import { isCashierRequest } from '../middleware/authMiddleware.js';

/**
 * GET /api/addons
 * Retrieve add-ons with type, status, category, item, search, and sorting support
 */
export async function getAllAddons(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection unavailable. MongoDB is required for add-ons.' },
      });
    }

    const { type, status, categoryId, itemId, search, sort = '-createdAt' } = req.query;
    const filter = {};

    if (type && type.trim()) {
      filter.type = type.trim();
    }

    if (status && ['active', 'inactive'].includes(status)) {
      filter.status = status;
    }

    if (categoryId && categoryId.trim()) {
      // Matches addons explicitly mapped to this category, OR universal addons with empty categoryIds
      filter.$or = [
        { categoryIds: categoryId.trim() },
        { categoryIds: { $size: 0 } },
      ];
    }

    if (itemId && itemId.trim()) {
      filter.itemIds = itemId.trim();
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { name: searchRegex },
        { description: searchRegex },
        { type: searchRegex },
      ];
    }

    const sortOption = {};
    if (sort === 'name') sortOption.name = 1;
    else if (sort === '-name') sortOption.name = -1;
    else if (sort === 'price') sortOption.price = 1;
    else if (sort === '-price') sortOption.price = -1;
    else if (sort === 'type') {
      sortOption.type = 1;
      sortOption.price = 1;
    } else {
      sortOption.createdAt = -1;
    }

    const addons = await Addon.find(filter).sort(sortOption);

    const isCashier = isCashierRequest(req);
    const sanitizedAddons = isCashier
      ? addons.map((addon) => {
          const doc = addon.toObject ? addon.toObject() : { ...addon };
          delete doc.costPrice;
          return doc;
        })
      : addons;

    return res.status(200).json({
      success: true,
      count: sanitizedAddons.length,
      data: sanitizedAddons,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/addons/:id
 * Retrieve a single add-on by custom id (e.g. addon-raita) or MongoDB _id
 */
export async function getAddonById(req, res, next) {
  try {
    const { id } = req.params;

    let addon = await Addon.findOne({ id });

    if (!addon && mongoose.Types.ObjectId.isValid(id)) {
      addon = await Addon.findById(id);
    }

    if (!addon) {
      return res.status(404).json({
        success: false,
        error: { message: `Add-on with ID '${id}' not found` },
      });
    }

    const isCashier = isCashierRequest(req);
    const doc = addon.toObject ? addon.toObject() : { ...addon };
    if (isCashier) {
      delete doc.costPrice;
    }

    return res.status(200).json({
      success: true,
      data: doc,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/addons
 * Create a new add-on
 */
export async function createAddon(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection unavailable. Cannot save add-on without MongoDB.' },
      });
    }

    const payload = { ...req.body };

    // Auto-generate custom ID if not provided
    if (!payload.id) {
      const slug = payload.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      payload.id = `addon-${slug || Date.now()}-${randomSuffix}`;
    }

    // Check duplicate ID
    const existing = await Addon.findOne({ id: payload.id });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { message: `Add-on with ID '${payload.id}' already exists` },
      });
    }

    const addon = await Addon.create(payload);

    return res.status(201).json({
      success: true,
      message: 'Add-on created successfully',
      data: addon,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/addons/:id
 * Update an existing add-on by custom id or _id
 */
export async function updateAddon(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection unavailable. Cannot update add-on without MongoDB.' },
      });
    }

    const { id } = req.params;
    const updates = { ...req.body };

    let addon = await Addon.findOneAndUpdate(
      { id },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!addon && mongoose.Types.ObjectId.isValid(id)) {
      addon = await Addon.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
      );
    }

    if (!addon) {
      return res.status(404).json({
        success: false,
        error: { message: `Add-on with ID '${id}' not found` },
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Add-on updated successfully',
      data: addon,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/addons/:id
 * Delete an add-on by custom id or _id
 */
export async function deleteAddon(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection unavailable. Cannot delete add-on without MongoDB.' },
      });
    }

    const { id } = req.params;

    let addon = await Addon.findOneAndDelete({ id });

    if (!addon && mongoose.Types.ObjectId.isValid(id)) {
      addon = await Addon.findByIdAndDelete(id);
    }

    if (!addon) {
      return res.status(404).json({
        success: false,
        error: { message: `Add-on with ID '${id}' not found` },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Add-on '${addon.name}' (${addon.id}) deleted successfully`,
      data: { id: addon.id, name: addon.name },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/addons/seed
 * Upsert canonical master add-ons into MongoDB Atlas
 */
export async function seedAddons(req, res, next) {
  try {
    const { force = false } = req.query;

    if (force === 'true' || force === true) {
      await Addon.deleteMany({});
    }

    const results = [];
    for (const item of defaultAddons) {
      const upserted = await Addon.findOneAndUpdate(
        { id: item.id },
        { $set: item },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      results.push(upserted);
    }

    const totalCount = await Addon.countDocuments();

    return res.status(200).json({
      success: true,
      message: `Master add-ons seeded successfully in MongoDB Atlas. Total add-ons: ${totalCount}`,
      count: results.length,
      data: results,
    });
  } catch (error) {
    next(error);
  }
}
