import mongoose from 'mongoose';
import { Order } from '../models/Order.js';
import { Counter } from '../models/Counter.js';
import { MenuItem } from '../models/Item.js';
import { Deal } from '../models/Deal.js';
import { isDbConnected } from '../config/db.js';

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

function getStartOfWeek(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getEndOfWeek(d = new Date()) {
  const start = getStartOfWeek(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function getStartOfMonth(d = new Date()) {
  const date = new Date(d);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getEndOfMonth(d = new Date()) {
  const date = new Date(d);
  date.setMonth(date.getMonth() + 1, 0);
  date.setHours(23, 59, 59, 999);
  return date;
}

/**
 * Calculates date range boundaries based on named preset or custom dates
 */
function resolveDateRange(datePreset, startDate, endDate) {
  const now = new Date();
  if (datePreset === 'Today') {
    return { $gte: getStartOfDay(now), $lte: getEndOfDay(now) };
  }
  if (datePreset === 'This Week') {
    return {
      $gte: getStartOfWeek(now),
      $lte: getEndOfWeek(now),
    };
  }
  if (datePreset === 'This Month') {
    return { $gte: getStartOfMonth(now), $lte: getEndOfMonth(now) };
  }
  if (datePreset === 'Custom' && startDate && endDate) {
    try {
      const s = new Date(startDate);
      const e = new Date(endDate);
      return { $gte: getStartOfDay(s), $lte: getEndOfDay(e) };
    } catch {
      // Fallback
    }
  }
  return null;
}

/**
 * Safely generates the next sequential unique invoice number atomically from the database.
 * Prevents duplicate invoice numbers across multiple users, browser tabs, or concurrent sales.
 */
/**
 * Safely generates the next sequential unique invoice number atomically from the database.
 * Prevents duplicate invoice numbers across multiple users, browser tabs, or concurrent sales.
 * Respects client-preferred sequence (e.g. from POS offline/online ledger) if unique and higher.
 */
export async function getNextInvoiceSequence(prefix = 'INV-', preferredSeq = null, preferredInvoiceNumber = null) {
  const cleanPrefix = (prefix || 'INV-').trim();
  const reqSeq = preferredSeq != null && !isNaN(Number(preferredSeq)) && Number(preferredSeq) > 0 ? Number(preferredSeq) : null;
  const reqInv = preferredInvoiceNumber ? String(preferredInvoiceNumber).trim() : null;

  if (!isDbConnected()) {
    if (reqInv && reqSeq) {
      const existing = await Order.findOne({ invoiceNumber: reqInv }).lean();
      if (!existing) {
        return { sequenceNumber: reqSeq, invoiceNumber: reqInv };
      }
    }
    const highest = await Order.findOne().sort({ sequenceNumber: -1 }).lean();
    const nextSeq = Math.max(highest?.sequenceNumber || 0, reqSeq || 0) + 1;
    return {
      sequenceNumber: nextSeq,
      invoiceNumber: `${cleanPrefix}${String(nextSeq).padStart(4, '0')}`,
    };
  }

  // 1. If preferred sequence and invoiceNumber provided by POS, verify uniqueness and adopt safely
  if (reqInv && reqSeq) {
    const existing = await Order.findOne({ invoiceNumber: reqInv }, { _id: 1 }).lean();
    if (!existing) {
      await Counter.findOneAndUpdate(
        { _id: 'order_invoice_sequence' },
        { $max: { seq: reqSeq } },
        { upsert: true }
      );
      return {
        sequenceNumber: reqSeq,
        invoiceNumber: reqInv,
      };
    }
  }

  // 2. Find highest numeric sequence currently in the Order collection to sync counter safely
  const highestOrderBySeq = await Order.findOne({}, { sequenceNumber: 1, invoiceNumber: 1 })
    .sort({ sequenceNumber: -1 })
    .lean();

  let maxSeq = highestOrderBySeq?.sequenceNumber || 0;

  if (highestOrderBySeq?.invoiceNumber) {
    const num = parseInt(String(highestOrderBySeq.invoiceNumber).replace(/\D/g, ''), 10);
    if (!isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  if (reqSeq && reqSeq > maxSeq) {
    maxSeq = reqSeq;
  }

  // Ensure counter is at least maxSeq
  await Counter.findOneAndUpdate(
    { _id: 'order_invoice_sequence' },
    { $max: { seq: maxSeq } },
    { upsert: true }
  );

  // 3. Atomically increment counter and verify uniqueness against Order collection
  let attempts = 0;
  while (attempts < 50) {
    attempts++;
    const counterDoc = await Counter.findOneAndUpdate(
      { _id: 'order_invoice_sequence' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const candidateSeq = counterDoc.seq;
    const candidateInvoiceNumber = `${cleanPrefix}${String(candidateSeq).padStart(4, '0')}`;

    // Verify no existing order collides with this invoiceNumber
    const existing = await Order.findOne({ invoiceNumber: candidateInvoiceNumber }, { _id: 1 }).lean();
    if (!existing) {
      return {
        sequenceNumber: candidateSeq,
        invoiceNumber: candidateInvoiceNumber,
      };
    }
  }

  // Fallback guaranteed uniqueness
  const fallbackSeq = Date.now();
  return {
    sequenceNumber: fallbackSeq,
    invoiceNumber: `${cleanPrefix}${fallbackSeq}`,
  };
}

/**
 * Safely sanitizes existing orders in MongoDB that share duplicate invoice numbers.
 * NEVER deletes any completed order. Preserves all items, lines, amounts, and dates.
 * Reassigns duplicate orders to unique consecutive sequential invoice numbers.
 */
export async function repairDuplicateInvoiceNumbers(prefix = 'INV-') {
  if (!isDbConnected()) return { repaired: 0 };

  const orders = await Order.find({}).sort({ createdAt: 1, _id: 1 });
  const invoiceMap = new Map();
  let maxSeq = 0;

  for (const o of orders) {
    const inv = String(o.invoiceNumber || '').trim();
    if (inv) {
      const num = parseInt(inv.replace(/\D/g, ''), 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
    if (o.sequenceNumber && o.sequenceNumber > maxSeq) {
      maxSeq = o.sequenceNumber;
    }
  }

  let repairedCount = 0;
  for (const o of orders) {
    const inv = String(o.invoiceNumber || '').trim();
    if (!invoiceMap.has(inv)) {
      invoiceMap.set(inv, o._id.toString());
    } else {
      // Duplicate detected! Reassign to next consecutive unique sequence
      maxSeq += 1;
      const newSeq = maxSeq;
      const newInv = `${prefix}${String(newSeq).padStart(4, '0')}`;
      o.sequenceNumber = newSeq;
      o.invoiceNumber = newInv;
      await o.save();
      invoiceMap.set(newInv, o._id.toString());
      repairedCount++;
    }
  }

  if (maxSeq > 0) {
    await Counter.findOneAndUpdate(
      { _id: 'order_invoice_sequence' },
      { $max: { seq: maxSeq } },
      { upsert: true }
    );
  }

  return { repaired: repairedCount, maxSeq };
}

/**
 * GET /api/orders/next-invoice-number
 * Returns the authoritative next invoice sequence and number from the server
 */
export async function getNextInvoiceNumberHandler(req, res, next) {
  try {
    const prefix = req.query.prefix || 'INV-';
    const nextInvoice = await getNextInvoiceSequence(prefix);
    return res.status(200).json({
      success: true,
      ...nextInvoice,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/orders/repair-invoices
 * Heals duplicate invoice numbers across all orders in MongoDB Atlas.
 */
export async function repairDuplicateInvoicesHandler(req, res, next) {
  try {
    const prefix = req.body?.prefix || req.query?.prefix || 'INV-';
    const result = await repairDuplicateInvoiceNumbers(prefix);
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/orders
 * Creates a completed order with snapshot lines, auto-incremented invoice number,
 * immutable creator attribution, and server-validated pure domain calculations.
 */
export async function createOrder(req, res, next) {
    const body = { ...req.body };

    // Idempotency check: If order already exists in cloud database, return existing order safely
    if (isDbConnected() && body.id) {
      const existing = await Order.findOne({ id: body.id });
      if (existing) {
        return res.status(200).json({
          success: true,
          message: 'Order already exists in cloud database',
          data: existing,
        });
      }
    }

    // DB lookup for cost enrichment if line costs were omitted (e.g. Cashier client)
    let dbItemMap = new Map();
    let dbDealMap = new Map();
    if (isDbConnected() && Array.isArray(body.lines)) {
      const itemIds = body.lines.map((l) => l.itemId).filter(Boolean);
      const dealIds = body.lines.filter((l) => l.isDeal && l.dealId).map((l) => l.dealId);
      if (itemIds.length > 0) {
        try {
          const foundItems = await MenuItem.find({ id: { $in: itemIds } });
          foundItems.forEach((it) => dbItemMap.set(it.id, it));
        } catch {
          // ignore lookup error
        }
      }
      if (dealIds.length > 0) {
        try {
          const foundDeals = await Deal.find({ id: { $in: dealIds } });
          foundDeals.forEach((dl) => dbDealMap.set(dl.id, dl));
        } catch {
          // ignore lookup error
        }
      }
    }

    // 1. Calculate each line's subtotal and addons, preserving all snapshots & deals
    const calculatedLines = body.lines.map((l, index) => {
      const addonsTotal = (l.addonSnapshots || []).reduce(
        (sum, a) => sum + (Number(a.price) || 0),
        0
      );
      const unitPrice = Number(l.unitPrice) || 0;
      const quantity = Math.max(1, Math.floor(Number(l.quantity) || 1));
      const lineSubtotal = Math.round((unitPrice + addonsTotal) * quantity);

      const dbItem = dbItemMap.get(l.itemId);
      const dbDeal = l.dealId ? dbDealMap.get(l.dealId) : null;
      let costPriceSnapshot = l.costPriceSnapshot;
      if (costPriceSnapshot === undefined || costPriceSnapshot === null) {
        costPriceSnapshot = dbItem?.costPrice ?? null;
      }

      let includedItems = Array.isArray(l.includedItems) ? l.includedItems : [];
      if (l.isDeal && dbDeal && Array.isArray(dbDeal.includedItems)) {
        includedItems = includedItems.map((inc) => {
          if (inc.costPrice !== undefined && inc.costPrice !== null) return inc;
          const matchedInc = dbDeal.includedItems.find((di) => di.itemId === inc.itemId || di.name === inc.name);
          return {
            ...inc,
            costPrice: matchedInc?.costPrice ?? null,
          };
        });
      }

      let itemCOGS = l.itemCOGS;
      let totalCOGS = l.totalCOGS;
      let grossProfit = l.grossProfit;
      let grossProfitMargin = l.grossProfitMargin;
      let hasCost = l.hasCost;

      const grossLineSale = l.grossLineSale !== undefined ? l.grossLineSale : lineSubtotal;
      const allocatedDiscount = l.allocatedDiscount || 0;
      const netRevenue = l.netRevenue !== undefined ? l.netRevenue : Math.max(0, grossLineSale - allocatedDiscount);

      if (l.isDeal) {
        let dealUnitCost = 0;
        let dealHasAllCost = includedItems.length > 0;
        includedItems.forEach((inc) => {
          if (inc.costPrice === null || inc.costPrice === undefined) {
            dealHasAllCost = false;
          } else {
            dealUnitCost += Number(inc.costPrice) * (Number(inc.quantity) || 1);
          }
        });
        if (dealHasAllCost && (totalCOGS === undefined || totalCOGS === null)) {
          itemCOGS = dealUnitCost * quantity;
          totalCOGS = itemCOGS;
          hasCost = true;
          grossProfit = netRevenue - totalCOGS;
          grossProfitMargin = netRevenue > 0 ? Number(((grossProfit / netRevenue) * 100).toFixed(2)) : 0;
        }
      } else if (costPriceSnapshot !== null && costPriceSnapshot !== undefined && (totalCOGS === undefined || totalCOGS === null)) {
        itemCOGS = Number(costPriceSnapshot) * quantity;
        const addonCOGS = l.addonCOGS || 0;
        totalCOGS = itemCOGS + addonCOGS;
        hasCost = true;
        grossProfit = netRevenue - totalCOGS;
        grossProfitMargin = netRevenue > 0 ? Number(((grossProfit / netRevenue) * 100).toFixed(2)) : 0;
      }

      return {
        id: l.id || `line-${index + 1}-${Date.now()}`,
        itemId: l.itemId,
        itemNameSnapshot: l.itemNameSnapshot,
        itemImageSnapshot: l.itemImageSnapshot || '',
        categoryIdSnapshot: l.categoryIdSnapshot || '',
        categoryNameSnapshot: l.categoryNameSnapshot || '',
        pricingMode: l.pricingMode || (l.isDeal ? 'deal' : 'piece'),
        isDeal: Boolean(l.isDeal),
        dealId: l.dealId || null,
        includedItems,
        selectedPortionLabel: l.selectedPortionLabel || '',
        selectedWeightGrams: Number(l.selectedWeightGrams) || 0,
        baseUnitSnapshot: l.baseUnitSnapshot || 'piece',
        basePriceSnapshot: Number(l.basePriceSnapshot) || 0,
        addonSnapshots: l.addonSnapshots || [],
        addonsTotal,
        unitPrice,
        quantity,
        lineSubtotal,
        sellingPriceSnapshot: l.sellingPriceSnapshot,
        costPriceSnapshot,
        portionPrice: l.portionPrice,
        quantitySnapshot: l.quantitySnapshot || quantity,
        weightGramsSnapshot: l.weightGramsSnapshot,
        itemGrossSale: l.itemGrossSale !== undefined ? l.itemGrossSale : lineSubtotal,
        addonGrossSale: l.addonGrossSale || 0,
        grossLineSale,
        allocatedDiscount,
        netRevenue,
        itemCOGS,
        addonCOGS: l.addonCOGS,
        totalCOGS,
        grossProfit,
        grossProfitMargin,
        hasCost,
        note: l.note || '',
      };
    });

    // 2. Calculate Order Financials
    const subtotal = calculatedLines.reduce((sum, l) => sum + l.lineSubtotal, 0);

    let discountAmount = 0;
    const discountValue = Number(body.discountValue) || 0;
    if (body.discountType === 'percentage') {
      discountAmount = Math.round((subtotal * Math.min(100, discountValue)) / 100);
    } else if (body.discountType === 'fixed') {
      discountAmount = Math.min(subtotal, Math.round(discountValue));
    }

    const taxableAmount = Math.max(0, subtotal - discountAmount);
    const taxRateSnapshot = Number(body.taxRateSnapshot) || 0;
    const taxAmount = Math.round((taxableAmount * taxRateSnapshot) / 100);
    const grandTotal = Math.max(0, taxableAmount + taxAmount);

    let amountReceived = Number(body.amountReceived) || 0;
    let changeAmount = 0;

    let balanceDue = 0;
    let paymentStatus = 'paid';

    if (body.paymentMethod === 'Cash') {
      const isPartialAllowed = body.allowPartialPayment === true || body.paymentStatus === 'partial' || Number(body.balanceDue) > 0;
      if (amountReceived < grandTotal) {
        if (!isPartialAllowed) {
          return res.status(400).json({
            success: false,
            error: {
              message: `Insufficient cash received. Required: Rs ${grandTotal}, Received: Rs ${amountReceived}`,
            },
          });
        }
        balanceDue = Math.max(0, grandTotal - amountReceived);
        paymentStatus = amountReceived > 0 ? 'partial' : 'unpaid';
        changeAmount = 0;
      } else {
        changeAmount = Math.max(0, amountReceived - grandTotal);
        balanceDue = 0;
        paymentStatus = 'paid';
      }
    } else {
      amountReceived = grandTotal;
      changeAmount = 0;
      balanceDue = 0;
      paymentStatus = 'paid';
    }

    // 3. Generate sequential invoice number atomically on the server
    const invoicePrefix = body.invoicePrefix || 'INV-';
    const { sequenceNumber, invoiceNumber } = await getNextInvoiceSequence(
      invoicePrefix,
      body.sequenceNumber,
      body.invoiceNumber
    );

    // 4. Order ID
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const id = body.id || `ord-${Date.now()}-${randomSuffix}`;

    // 5. Creator attribution (immutable snapshot at sale completion)
    const reqRole = req.user?.role || req.headers?.['x-user-role'];
    const isReqAdmin = String(reqRole || '').toLowerCase().includes('admin') || String(body.createdByRole || '').toLowerCase() === 'admin';
    const createdByUserId = body.createdByUserId || (req.user?.id ? String(req.user.id) : (isReqAdmin ? 'user_admin' : 'user_cashier'));
    const createdByName = body.createdByName || body.cashierName || req.user?.name || req.user?.username || (isReqAdmin ? 'Admin' : 'Cashier');
    const createdByRole = body.createdByRole || (isReqAdmin ? 'admin' : 'cashier');

    const orderPayload = {
      id,
      invoiceNumber,
      sequenceNumber,
      status: 'completed',
      orderType: body.orderType || 'Dine-In',
      guestCount: body.orderType === 'Takeaway' ? 1 : (Number(body.guestCount) || 1),
      createdByUserId,
      createdByName,
      createdByRole,
      cashierName: createdByName,
      customerName: body.customerName || '',
      customerPhone: body.customerPhone || '',
      tableNumber: body.tableNumber || '',
      lines: calculatedLines,
      subtotal,
      discountType: body.discountType || 'none',
      discountValue,
      discountAmount,
      taxableAmount,
      taxRateSnapshot,
      taxAmount,
      grandTotal,
      paymentMethod: body.paymentMethod || 'Cash',
      amountReceived,
      changeAmount,
      balanceDue,
      paymentStatus,
      completedAt: body.completedAt ? new Date(body.completedAt) : new Date(),
      createdAt: body.createdAt ? new Date(body.createdAt) : new Date(),
    };

    const createdOrder = await Order.create(orderPayload);

    return res.status(201).json({
      success: true,
      message: `Sale completed successfully. Invoice #${invoiceNumber}`,
      data: createdOrder,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/orders
 * Returns orders with rich filtering, search, pagination, and calculated summary metrics
 */
export async function getAllOrders(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(200).json({
        success: true,
        count: 0,
        total: 0,
        page: 1,
        totalPages: 1,
        data: [],
        metrics: {
          grossSales: 0,
          netRevenue: 0,
          totalTax: 0,
          reversalsTotal: 0,
          totalItemsSold: 0,
          averageOrderValue: 0,
          completedOrdersCount: 0,
        },
        offline: true,
      });
    }

    // Auto-heal duplicate invoice numbers if any exist in the database
    try {
      const duplicates = await Order.aggregate([
        { $group: { _id: '$invoiceNumber', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 }, _id: { $ne: null } } },
      ]);
      if (duplicates && duplicates.length > 0) {
        await repairDuplicateInvoiceNumbers();
      }
    } catch {
      // Non-blocking auto-repair attempt
    }

    const {
      status,
      orderType,
      paymentMethod,
      datePreset,
      startDate,
      endDate,
      search,
      createdByUserId,
      page = 1,
      limit = 50,
      sort = '-completedAt',
    } = req.query;

    const filter = {};

    if (createdByUserId) {
      filter.createdByUserId = createdByUserId;
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (orderType && orderType !== 'all') {
      filter.orderType = orderType;
    }

    if (paymentMethod && paymentMethod !== 'all') {
      filter.paymentMethod = paymentMethod;
    }

    const dateRange = resolveDateRange(datePreset, startDate, endDate);
    if (dateRange) {
      filter.completedAt = dateRange;
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { invoiceNumber: searchRegex },
        { customerName: searchRegex },
        { customerPhone: searchRegex },
        { tableNumber: searchRegex },
        { 'lines.itemNameSnapshot': searchRegex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const sortOptions = {};
    if (sort === '-completedAt') sortOptions.completedAt = -1;
    else if (sort === 'completedAt') sortOptions.completedAt = 1;
    else if (sort === '-grandTotal') sortOptions.grandTotal = -1;
    else if (sort === 'grandTotal') sortOptions.grandTotal = 1;
    else sortOptions.completedAt = -1;

    const [orders, totalMatching] = await Promise.all([
      Order.find(filter).sort(sortOptions).skip(skip).limit(limitNum),
      Order.countDocuments(filter),
    ]);

    // Calculate aggregated metrics for the filtered view
    const allMatching = await Order.find(filter);
    const grossSales = allMatching.reduce((s, o) => s + (o.grandTotal || 0), 0);
    const validOrders = allMatching.filter((o) => o.status !== 'reversed');
    const reversedOrders = allMatching.filter((o) => o.status === 'reversed');

    const netRevenue = validOrders.reduce((s, o) => s + (o.grandTotal - (o.taxAmount || 0)), 0);
    const totalTax = validOrders.reduce((s, o) => s + (o.taxAmount || 0), 0);
    const reversalsTotal = reversedOrders.reduce((s, o) => s + (o.grandTotal || 0), 0);
    const totalItemsSold = validOrders.reduce(
      (s, o) => s + o.lines.reduce((ls, l) => ls + (l.quantity || 1), 0),
      0
    );

    return res.status(200).json({
      success: true,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalMatching,
        pages: Math.ceil(totalMatching / limitNum) || 1,
      },
      summary: {
        totalOrders: allMatching.length,
        validOrdersCount: validOrders.length,
        reversedOrdersCount: reversedOrders.length,
        grossSales,
        netRevenue,
        totalTax,
        reversalsTotal,
        totalItemsSold,
        averageOrderValue:
          validOrders.length > 0
            ? Math.round(
                validOrders.reduce((s, o) => s + (o.grandTotal || 0), 0) / validOrders.length
              )
            : 0,
      },
      data: orders,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/orders/:id
 * Retrieve order by custom id, invoiceNumber (e.g. INV-0001), or MongoDB _id
 */
export async function getOrderById(req, res, next) {
  try {
    const { id } = req.params;

    let order = await Order.findOne({ id });

    if (!order) {
      order = await Order.findOne({ invoiceNumber: id.toUpperCase() });
    }

    if (!order && mongoose.Types.ObjectId.isValid(id)) {
      order = await Order.findById(id);
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { message: `Order '${id}' not found` },
      });
    }

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/orders/:id/kitchen-status
 * Updates the kitchen preparation status ('received' | 'preparing' | 'ready' | 'served')
 */
export async function updateKitchenStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { kitchenStatus } = req.body;

    const allowed = ['received', 'preparing', 'ready', 'served'];
    if (!kitchenStatus || !allowed.includes(kitchenStatus)) {
      return res.status(400).json({
        success: false,
        error: { message: `Invalid kitchen status. Must be one of: ${allowed.join(', ')}` },
      });
    }

    let order = await Order.findOne({ id });
    if (!order && mongoose.Types.ObjectId.isValid(id)) {
      order = await Order.findById(id);
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { message: `Order '${id}' not found` },
      });
    }

    order.kitchenStatus = kitchenStatus;
    await order.save();

    return res.status(200).json({
      success: true,
      message: `Kitchen status updated to '${kitchenStatus}'`,
      data: order,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/orders/seed
 * Seeds realistic starter orders for testing POS, receipts, and reporting
 */
export async function seedOrders(req, res, next) {
  try {
    const { force = false } = req.query;

    if (force === 'true' || force === true) {
      await Order.deleteMany({});
    }

    const count = await Order.countDocuments();
    if (count > 0 && !force) {
      return res.status(200).json({
        success: true,
        message: `Orders already seeded. Total orders: ${count}`,
        count,
      });
    }

    const sampleOrders = [
      {
        id: 'ord-sample-01',
        invoiceNumber: 'INV-0001',
        sequenceNumber: 1,
        status: 'completed',
        orderType: 'Dine-In',
        cashierName: 'Cashier 1',
        customerName: 'Usman Ali',
        customerPhone: '0300-1234567',
        tableNumber: 'Table 4',
        lines: [
          {
            id: 'l1',
            itemId: 'item-1',
            itemNameSnapshot: 'Special Chicken Biryani',
            categoryIdSnapshot: 'cat-biryani',
            pricingMode: 'portion',
            selectedPortionLabel: '500g',
            selectedWeightGrams: 500,
            baseUnitSnapshot: 'kg',
            basePriceSnapshot: 1000,
            addonSnapshots: [
              { id: 'addon-raita', name: 'Zeera Raita', price: 60 },
              { id: 'addon-salad', name: 'Fresh Kachumber Salad', price: 80 },
            ],
            addonsTotal: 140,
            unitPrice: 500,
            quantity: 2,
            lineSubtotal: 1280, // (500 + 140) * 2
            note: 'Less spicy',
          },
          {
            id: 'l2',
            itemId: 'item-2',
            itemNameSnapshot: 'Crispy Zinger Burger',
            categoryIdSnapshot: 'cat-burgers',
            pricingMode: 'piece',
            baseUnitSnapshot: 'piece',
            basePriceSnapshot: 480,
            addonSnapshots: [{ id: 'addon-cheese', name: 'Cheddar Cheese Slice', price: 70 }],
            addonsTotal: 70,
            unitPrice: 480,
            quantity: 1,
            lineSubtotal: 550, // (480 + 70) * 1
          },
        ],
        subtotal: 1830,
        discountType: 'none',
        discountValue: 0,
        discountAmount: 0,
        taxableAmount: 1830,
        taxRateSnapshot: 16,
        taxAmount: 293, // 1830 * 0.16 = 292.8 -> 293
        grandTotal: 2123,
        paymentMethod: 'Cash',
        amountReceived: 2500,
        changeAmount: 377,
        completedAt: new Date(Date.now() - 3600000 * 2), // 2 hours ago
      },
      {
        id: 'ord-sample-02',
        invoiceNumber: 'INV-0002',
        sequenceNumber: 2,
        status: 'completed',
        orderType: 'Takeaway',
        cashierName: 'Cashier 1',
        customerName: 'Farhan Khan',
        customerPhone: '0321-9876543',
        lines: [
          {
            id: 'l3',
            itemId: 'item-2',
            itemNameSnapshot: 'Crispy Zinger Burger',
            categoryIdSnapshot: 'cat-burgers',
            pricingMode: 'piece',
            baseUnitSnapshot: 'piece',
            basePriceSnapshot: 480,
            addonSnapshots: [{ id: 'addon-fries', name: 'Mini French Fries', price: 120 }],
            addonsTotal: 120,
            unitPrice: 480,
            quantity: 2,
            lineSubtotal: 1200,
          },
        ],
        subtotal: 1200,
        discountType: 'fixed',
        discountValue: 100,
        discountAmount: 100,
        taxableAmount: 1100,
        taxRateSnapshot: 16,
        taxAmount: 176,
        grandTotal: 1276,
        paymentMethod: 'Card',
        amountReceived: 1276,
        changeAmount: 0,
        completedAt: new Date(Date.now() - 3600000), // 1 hour ago
      },
    ];

    await Order.insertMany(sampleOrders);

    return res.status(200).json({
      success: true,
      message: 'Sample orders seeded successfully in MongoDB Atlas.',
      count: sampleOrders.length,
      data: sampleOrders,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/orders/:id/settle-balance
 * Settle or partially pay the outstanding balance for an order
 */
export async function settleOrderBalance(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Database connection currently unavailable.' },
      });
    }

    const { id } = req.params;

    const {
      amountPaid,
      paymentMethod = 'Cash',
      receivedBy = 'Cashier',
      cardNetwork,
      cardSlipNumber,
      onlineChannel,
      onlineAccountId,
      onlineAccountNumber,
      onlineAccountTitle,
      onlineBankName,
      onlineTransactionId,
      note = '',
    } = req.body;

    let order = await Order.findOne({ id });
    if (!order && mongoose.Types.ObjectId.isValid(id)) {
      order = await Order.findById(id);
    }
    if (!order) {
      order = await Order.findOne({ invoiceNumber: id.toUpperCase() });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { message: `Order '${id}' not found` },
      });
    }

    const grandTotal = Number(order.grandTotal) || 0;
    const prevReceived = Number(order.amountReceived) || 0;
    const prevDue = Number(order.balanceDue != null ? order.balanceDue : Math.max(0, grandTotal - prevReceived));
    const pay = Math.max(0, Number(amountPaid) || 0);

    const actualPay = Math.min(prevDue, pay);
    const newDue = Math.max(0, prevDue - actualPay);
    const newReceived = prevReceived + actualPay;

    order.amountReceived = newReceived;
    order.balanceDue = newDue;
    order.paymentStatus = newDue === 0 ? 'paid' : 'partial';
    if (newDue === 0 && order.status !== 'reversed') {
      order.status = 'completed';
    }

    if (paymentMethod === 'Card') {
      if (cardNetwork) order.cardNetwork = cardNetwork;
      if (cardSlipNumber) order.posSlipNumber = cardSlipNumber;
    } else if (paymentMethod === 'Online') {
      if (onlineChannel) order.onlineChannel = onlineChannel;
      if (onlineAccountId) order.onlineAccountId = onlineAccountId;
      if (onlineAccountNumber) order.onlineAccountNumber = onlineAccountNumber;
      if (onlineAccountTitle) order.onlineAccountTitle = onlineAccountTitle;
      if (onlineBankName) order.onlineBankName = onlineBankName;
      if (onlineTransactionId) order.transactionId = onlineTransactionId;
    }

    if (!Array.isArray(order.settlementHistory)) {
      order.settlementHistory = [];
    }
    order.settlementHistory.push({
      id: `stl-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      amountPaid: actualPay,
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
      settledAt: new Date(),
      settledBy: receivedBy,
      note,
    });

    await order.save();

    return res.status(200).json({
      success: true,
      message: `Balance settled. Paid: Rs ${actualPay}, Remaining: Rs ${newDue}`,
      data: order,
    });
  } catch (error) {
    next(error);
  }
}
