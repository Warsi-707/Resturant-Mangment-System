import { Deal } from '../models/Deal.js';
import { isDbConnected } from '../config/db.js';
import { isCashierRequest } from '../middleware/authMiddleware.js';

/**
 * GET /api/deals
 * Retrieve all deals with optional status, search, and sorting
 */
export async function getAllDeals(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection unavailable. MongoDB is required for deals.' },
      });
    }

    const { status, search, sort = 'sortOrder' } = req.query;
    const filter = {};

    if (status && ['active', 'inactive'].includes(status)) {
      filter.status = status;
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { name: searchRegex },
        { description: searchRegex },
      ];
    }

    const sortOption = {};
    if (sort === 'name') sortOption.name = 1;
    else if (sort === '-name') sortOption.name = -1;
    else if (sort === 'dealPrice') sortOption.dealPrice = 1;
    else if (sort === '-dealPrice') sortOption.dealPrice = -1;
    else {
      sortOption.sortOrder = 1;
      sortOption.createdAt = -1;
    }

    const deals = await Deal.find(filter).sort(sortOption);

    const isCashier = isCashierRequest(req);
    const sanitizedDeals = isCashier
      ? deals.map((deal) => {
          const doc = deal.toObject ? deal.toObject() : { ...deal };
          delete doc.costPrice;
          delete doc.totalCost;
          delete doc.estimatedGrossProfit;
          delete doc.profitMargin;
          if (Array.isArray(doc.includedItems)) {
            doc.includedItems = doc.includedItems.map((inc) => {
              const incDoc = { ...(inc.toObject ? inc.toObject() : inc) };
              delete incDoc.costPrice;
              return incDoc;
            });
          }
          return doc;
        })
      : deals;

    return res.status(200).json({
      success: true,
      count: sanitizedDeals.length,
      data: sanitizedDeals,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/deals/:id
 * Retrieve a single deal by its ID
 */
export async function getDealById(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection currently unavailable.' },
      });
    }

    const { id } = req.params;
    const deal = await Deal.findOne({ id });

    if (!deal) {
      return res.status(404).json({
        success: false,
        error: { message: `Deal with ID '${id}' not found` },
      });
    }

    const isCashier = isCashierRequest(req);
    const doc = deal.toObject ? deal.toObject() : { ...deal };
    if (isCashier) {
      delete doc.costPrice;
      delete doc.totalCost;
      delete doc.estimatedGrossProfit;
      delete doc.profitMargin;
      if (Array.isArray(doc.includedItems)) {
        doc.includedItems = doc.includedItems.map((inc) => {
          const incDoc = { ...(inc.toObject ? inc.toObject() : inc) };
          delete incDoc.costPrice;
          return incDoc;
        });
      }
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
 * POST /api/deals
 * Create a new deal
 */
export async function createDeal(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection currently unavailable.' },
      });
    }

    const {
      id,
      name,
      description = '',
      imageRef = '',
      dealPrice,
      status = 'active',
      includedItems = [],
      sortOrder = null,
    } = req.body;

    const dealId = id || `deal-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    // Ensure unique id
    const existing = await Deal.findOne({ id: dealId });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { message: `Deal with ID '${dealId}' already exists` },
      });
    }

    const newDeal = await Deal.create({
      id: dealId,
      name: name.trim(),
      description: description.trim(),
      imageRef: imageRef.trim(),
      dealPrice,
      status,
      includedItems,
      sortOrder: sortOrder || undefined,
    });

    return res.status(201).json({
      success: true,
      data: newDeal,
      message: 'Deal created successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/deals/:id
 * Update an existing deal
 */
export async function updateDeal(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection currently unavailable.' },
      });
    }

    const { id } = req.params;
    const updates = { ...req.body };
    delete updates.id; // Prevent updating id

    const deal = await Deal.findOneAndUpdate({ id }, updates, {
      new: true,
      runValidators: true,
    });

    if (!deal) {
      return res.status(404).json({
        success: false,
        error: { message: `Deal with ID '${id}' not found` },
      });
    }

    return res.status(200).json({
      success: true,
      data: deal,
      message: 'Deal updated successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/deals/:id
 * Delete a deal
 */
export async function deleteDeal(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection currently unavailable.' },
      });
    }

    const { id } = req.params;
    const deal = await Deal.findOneAndDelete({ id });

    if (!deal) {
      return res.status(404).json({
        success: false,
        error: { message: `Deal with ID '${id}' not found` },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Deal '${deal.name}' deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
}
