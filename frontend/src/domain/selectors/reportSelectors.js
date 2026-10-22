/**
 * Domain Report Selectors & Aggregations
 * Pure, testable reporting logic for:
 * - Sales Report (KPIs, Daily Trends, Category Breakdown, Order Rows)
 * - Revenue Report (Gross vs Net, Tax Separation, Payment Breakdown, Discounts)
 * - Reversal Report (Reversal KPIs, Reversal Trends, Detailed Audit Rows)
 *
 * Reconciles 100% with canonical accounting rules in dashboardSelectors.js.
 */
import {
  isWithinInterval,
  parseISO,
  format,
  eachDayOfInterval,
  isSameDay,
  startOfDay,
} from 'date-fns';
import {
  getDateIntervalForPreset,
  getValidNonReversedOrders,
} from './dashboardSelectors';
import { storage } from '../../services/persistence/storage';
import { filterExpenses, calculateExpenseSummary } from '../rules/expenseRules';

function toSafeDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    try {
      const parsed = parseISO(val);
      if (!isNaN(parsed.getTime())) return parsed;
    } catch {}
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
    const num = Number(val);
    if (!isNaN(num) && num > 0) {
      const dNum = new Date(num);
      if (!isNaN(dNum.getTime())) return dNum;
    }
  }
  return null;
}

export function getInvoiceSequenceNumber(record) {
  if (!record) return 0;
  if (record.sequenceNumber != null && !isNaN(Number(record.sequenceNumber)) && Number(record.sequenceNumber) > 0) {
    return Number(record.sequenceNumber);
  }
  const str = String(record.invoiceNumber || record.originalInvoiceNumber || record.id || '');
  const matches = str.match(/(\d+)/g);
  if (matches && matches.length > 0) {
    return parseInt(matches[matches.length - 1], 10) || 0;
  }
  return 0;
}

export function sortInvoicesDescending(a, b) {
  // 1. Numeric sequence descending (INV-0005 -> 5, INV-0004 -> 4, etc.)
  const seqA = getInvoiceSequenceNumber(a);
  const seqB = getInvoiceSequenceNumber(b);
  if (seqA !== 0 && seqB !== 0 && seqB !== seqA) {
    return seqB - seqA;
  }

  // 2. Completion / creation timestamp descending
  const timeA = new Date(a.completedAt || a.createdAt || a.reversedAt || 0).getTime();
  const timeB = new Date(b.completedAt || b.createdAt || b.reversedAt || 0).getTime();
  if (timeB !== timeA) {
    return timeB - timeA;
  }

  // 3. Natural numeric string comparison
  return String(b.invoiceNumber || b.originalInvoiceNumber || b.id || '').localeCompare(
    String(a.invoiceNumber || a.originalInvoiceNumber || a.id || ''),
    undefined,
    { numeric: true }
  );
}

export function sortInvoicesAscending(a, b) {
  return sortInvoicesDescending(b, a);
}

/**
 * 1. Filter Orders by comprehensive report filters:
 * - datePreset ('Today' | 'This Week' | 'This Month' | 'All Time' | 'Custom')
 * - customRange ({ startDate, endDate })
 * - categoryId / categoryName
 * - paymentMethod ('All' | 'Cash' | 'Card' | 'Online')
 * - orderType ('All' | 'Dine-In' | 'Takeaway')
 * - status ('All' | 'completed' | 'reversed')
 * - searchQuery (matches invoiceNumber or item name)
 */
export function filterReportOrders(orders = [], filters = {}) {
  if (!Array.isArray(orders) || orders.length === 0) return [];

  const {
    datePreset = 'All Time',
    customRange = null,
    category = 'All',
    paymentMethod = 'All',
    orderType = 'All',
    status = 'All',
    searchQuery = '',
    referenceDate = new Date(),
  } = filters;

  const interval = (datePreset !== 'All Time' && datePreset !== 'All Dates')
    ? getDateIntervalForPreset(datePreset, customRange, referenceDate)
    : null;

  const query = (searchQuery || '').trim().toLowerCase();

  const filtered = orders.filter((order) => {
    // Date filter
    if (interval) {
      const dateVal = order.completedAt || order.createdAt;
      const d = toSafeDate(dateVal);
      if (!d) return false;
      try {
        if (!isWithinInterval(d, { start: interval.start, end: interval.end })) {
          return false;
        }
      } catch {
        return false;
      }
    }

    // Status filter
    if (status && status !== 'All') {
      const orderStatus = (order.status || 'completed').toLowerCase();
      const isPartial =
        (Number(order.balanceDue) > 0 || (order.paymentStatus || '').toLowerCase() === 'partial') &&
        orderStatus !== 'reversed';
      const target = status.toLowerCase();

      if (target === 'partial' || target === 'outstanding') {
        if (!isPartial) return false;
      } else if (target === 'completed') {
        if (orderStatus !== 'completed' || isPartial) return false;
      } else if (orderStatus !== target) {
        return false;
      }
    }

    // Payment method filter
    if (paymentMethod && paymentMethod !== 'All') {
      if (String(order.paymentMethod || '').toLowerCase() !== paymentMethod.toLowerCase()) {
        return false;
      }
    }

    // Order type filter
    if (orderType && orderType !== 'All') {
      if (String(order.orderType || '').toLowerCase() !== orderType.toLowerCase()) {
        return false;
      }
    }

    // Category filter
    if (category && category !== 'All') {
      const catLower = category.toLowerCase();
      const isAddonFilter = catLower === 'add-ons' || catLower === 'addon' || catLower === 'add-on';
      const hasCategoryMatch = (order.lines || []).some((l) => {
        const lineCat = String(l.categoryNameSnapshot || l.categoryName || '').toLowerCase();
        const hasAddonMatch =
          isAddonFilter &&
          ((Array.isArray(l.addonSnapshots) && l.addonSnapshots.length > 0) ||
            (Array.isArray(l.addons) && l.addons.length > 0) ||
            (Array.isArray(l.selectedAddons) && l.selectedAddons.length > 0));
        return lineCat === catLower || lineCat.includes(catLower) || hasAddonMatch;
      });
      if (!hasCategoryMatch) return false;
    }

    // Search query filter (matches invoiceNumber, item names, addon names, or deal included items)
    if (query) {
      const matchInv = String(order.invoiceNumber || '').toLowerCase().includes(query);
      const matchItem = (order.lines || []).some((l) => {
        const matchLineItem = String(l.itemNameSnapshot || l.name || '').toLowerCase().includes(query);
        const rawAddons = Array.isArray(l.addonSnapshots)
          ? l.addonSnapshots
          : Array.isArray(l.addons)
          ? l.addons
          : Array.isArray(l.selectedAddons)
          ? l.selectedAddons
          : [];
        const matchAddon = rawAddons.some((a) => String(a.name || '').toLowerCase().includes(query));
        const rawIncluded = Array.isArray(l.includedItems) ? l.includedItems : [];
        const matchIncluded = rawIncluded.some((inc) => String(inc.name || inc.itemName || '').toLowerCase().includes(query));
        return matchLineItem || matchAddon || matchIncluded;
      });
      if (!matchInv && !matchItem) return false;
    }

    return true;
  });

  // Tarteeb: Always sort chronologically by newest invoice sequence/timestamp first
  return filtered.sort(sortInvoicesDescending);
}

/**
 * 2. Filter Reversals by report filters:
 * - datePreset, customRange
 * - reason ('All' | specific reason string)
 * - searchQuery (matches originalInvoiceNumber, reversal ID, or reason)
 */
export function filterReportReversals(reversals = [], filters = {}) {
  if (!Array.isArray(reversals) || reversals.length === 0) return [];

  // Deduplicate by original order/invoice key to prevent duplicate count and inflated totals
  const seen = new Set();
  const deduped = [];
  for (const r of reversals) {
    const key = r.originalOrderId || r.originalInvoiceNumber || r.id;
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    } else if (!key) {
      deduped.push(r);
    }
  }

  const {
    datePreset = 'All Time',
    customRange = null,
    reason = 'All',
    searchQuery = '',
    referenceDate = new Date(),
  } = filters;

  const interval = (datePreset !== 'All Time' && datePreset !== 'All Dates')
    ? getDateIntervalForPreset(datePreset, customRange, referenceDate)
    : null;

  const query = (searchQuery || '').trim().toLowerCase();

  const filtered = deduped.filter((rev) => {
    // Date filter
    if (interval) {
      const dateVal = rev.reversedAt || rev.createdAt;
      const d = toSafeDate(dateVal);
      if (!d) return false;
      try {
        if (!isWithinInterval(d, { start: interval.start, end: interval.end })) {
          return false;
        }
      } catch {
        return false;
      }
    }

    // Reason filter
    if (reason && reason !== 'All') {
      const revReason = String(rev.reason || '').toLowerCase();
      if (!revReason.includes(reason.toLowerCase())) return false;
    }

    // Search query filter
    if (query) {
      const matchInv = String(rev.originalInvoiceNumber || '').toLowerCase().includes(query);
      const matchId = String(rev.id || '').toLowerCase().includes(query);
      const matchReason = String(rev.reason || '').toLowerCase().includes(query);
      if (!matchInv && !matchId && !matchReason) return false;
    }

    return true;
  });

  return filtered.sort(sortInvoicesDescending);
}

/**
 * 3. Derive Sales Report KPIs
 * Reconciles with Dashboard calculations:
 * - Gross Sales: Sum of all completed invoice grand totals
 * - Valid Net Sales: Sum of valid non-reversed invoice subtotals (or grand totals without tax)
 * - Completed Orders: Total historical completed orders
 * - Valid Orders Count: Non-reversed orders count
 * - Average Order Value: Valid gross sales / valid orders count
 * - Items Sold: Sum of quantities in valid orders
 * - Discounts Given: Total discounts given across filtered orders
 */
export function deriveSalesReport(filteredOrders = [], filteredReversals = []) {
  const validOrders = getValidNonReversedOrders(filteredOrders, filteredReversals);

  const grossSales = filteredOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0);
  const completedOrders = filteredOrders.length;
  const validOrderCount = validOrders.length;

  const validBilledSales = validOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0);
  const validNetSales = validOrders.reduce((sum, o) => {
    const grand = Number(o.grandTotal) || 0;
    const tax = Number(o.taxAmount) || 0;
    return sum + (grand - tax);
  }, 0);

  const averageOrderValue = validOrderCount > 0
    ? Math.round(validBilledSales / validOrderCount)
    : 0;

  const itemsSold = validOrders.reduce((sum, o) => {
    const lineQty = (o.lines || []).reduce((q, l) => q + (Number(l.quantity) || 1), 0);
    return sum + lineQty;
  }, 0);

  const discountsGiven = filteredOrders.reduce((sum, o) => sum + (Number(o.discountAmount) || 0), 0);

  // Deals analytics
  let dealsSold = 0;
  let dealRevenue = 0;
  let dealCost = 0;
  let dealGrossProfit = 0;

  validOrders.forEach((o) => {
    (o.lines || []).forEach((l) => {
      if (l.isDeal) {
        const qty = Number(l.quantity) || 1;
        dealsSold += qty;
        const rev = Number(l.netRevenue ?? (l.lineSubtotal ?? (Number(l.unitPrice || 0) * qty)));
        dealRevenue += rev;
        if (l.totalCOGS !== undefined && l.totalCOGS !== null) {
          dealCost += Number(l.totalCOGS);
          dealGrossProfit += Number(l.grossProfit ?? (rev - Number(l.totalCOGS)));
        }
      }
    });
  });

  const taxCollected = validOrders.reduce((sum, o) => sum + (Number(o.taxAmount) || 0), 0);
  const totalTax = filteredOrders.reduce((sum, o) => sum + (Number(o.taxAmount) || 0), 0);

  return {
    grossSales,
    validBilledSales,
    totalSale: validBilledSales,
    validNetSales,
    completedOrders,
    validOrderCount,
    averageOrderValue,
    itemsSold,
    discountsGiven,
    totalDiscounts: discountsGiven,
    taxCollected: totalTax,
    validTaxCollected: taxCollected,
    dealsSold,
    dealRevenue,
    dealCost,
    dealGrossProfit,
  };
}

/**
 * Dedicated Deals analytics selector
 */
export function deriveDealsReport(filteredOrders = [], filteredReversals = []) {
  const { dealsSold, dealRevenue, dealCost, dealGrossProfit } = deriveSalesReport(filteredOrders, filteredReversals);
  return { dealsSold, dealRevenue, dealCost, dealGrossProfit };
}

/**
 * 4. Derive Revenue Report KPIs
 * - Gross Billed: All completed sales
 * - Discounts: Discounts given
 * - Tax Collected: Stored tax amounts in valid non-reversed sales
 * - Reversals Including Tax: Total customer-billed reversals
 * - Net Revenue: Valid sales excluding tax and reversals (grandTotal - taxAmount)
 * - Average Net Revenue per Valid Order: Net Revenue / validOrderCount
 */
export function deriveRevenueReport(filteredOrders = [], filteredReversals = []) {
  const validOrders = getValidNonReversedOrders(filteredOrders, filteredReversals);

  const grossBilled = filteredOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0);
  const totalDiscounts = filteredOrders.reduce((sum, o) => sum + (Number(o.discountAmount) || 0), 0);
  const validDiscounts = validOrders.reduce((sum, o) => sum + (Number(o.discountAmount) || 0), 0);

  // Tax Collected derives strictly from stored snapshots in valid non-reversed orders
  const taxCollected = validOrders.reduce((sum, o) => sum + (Number(o.taxAmount) || 0), 0);

  // Reversals
  const reversalsIncludingTax = filteredReversals.reduce(
    (sum, r) => sum + (Number(r.totalReversedIncludingTax) || 0),
    0
  );
  const reversedTax = filteredReversals.reduce((sum, r) => sum + (Number(r.taxReversed) || 0), 0);

  // Net Revenue = valid gross sales - valid tax
  const netRevenue = validOrders.reduce((sum, o) => {
    const grand = Number(o.grandTotal) || 0;
    const tax = Number(o.taxAmount) || 0;
    return sum + (grand - tax);
  }, 0);

  const validOrderCount = validOrders.length;
  const avgNetRevenuePerOrder = validOrderCount > 0
    ? Math.round(netRevenue / validOrderCount)
    : 0;

  const validBilled = validOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0);
  const totalCollected = validOrders.reduce((sum, o) => {
    const grand = Number(o.grandTotal) || 0;
    const due = Math.max(0, Number(o.balanceDue != null ? o.balanceDue : (o.amountReceived != null ? Math.max(0, grand - Number(o.amountReceived)) : 0)));
    return sum + Math.max(0, grand - due);
  }, 0);
  const outstandingDue = validOrders.reduce((sum, o) => {
    const due = o.balanceDue != null
      ? Number(o.balanceDue)
      : (o.amountReceived != null ? Math.max(0, (Number(o.grandTotal) || 0) - Number(o.amountReceived)) : 0);
    return sum + Math.max(0, due || 0);
  }, 0);

  return {
    grossBilled,
    validBilled,
    totalSale: validBilled,
    validDiscounts,
    totalDiscounts,
    taxCollected,
    reversalsIncludingTax,
    reversedTax,
    netRevenue,
    totalCollected,
    outstandingDue,
    avgNetRevenuePerOrder,
    validOrderCount,
  };
}

/**
 * 5. Derive Reversal Report KPIs
 * - Reversal Count
 * - Reversed Subtotal
 * - Reversed Discount Impact
 * - Reversed Tax
 * - Reversal Total Including Tax
 */
export function deriveReversalReport(filteredReversals = []) {
  const reversalCount = filteredReversals.length;

  const reversedSubtotal = filteredReversals.reduce(
    (sum, r) => sum + (Number(r.subtotalReversed) || 0),
    0
  );

  const reversedDiscountImpact = filteredReversals.reduce(
    (sum, r) => sum + (Number(r.discountReversed) || 0),
    0
  );

  const reversedTax = filteredReversals.reduce(
    (sum, r) => sum + (Number(r.taxReversed) || 0),
    0
  );

  const reversalTotalIncludingTax = filteredReversals.reduce(
    (sum, r) => sum + (Number(r.totalReversedIncludingTax) || 0),
    0
  );

  return {
    reversalCount,
    reversedSubtotal,
    reversedDiscountImpact,
    reversedTax,
    reversalTotalIncludingTax,
  };
}

/**
 * 6. Payment Method Breakdown (Cash, Card, Online)
 * Returns breakdown of amounts, counts, and percentages for valid orders.
 */
export function getPaymentMethodBreakdown(filteredOrders = [], filteredReversals = []) {
  const validOrders = getValidNonReversedOrders(filteredOrders, filteredReversals);
  const totalBilled = validOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0);

  const methods = ['Cash', 'Card', 'Online'];
  const breakdown = methods.map((method) => {
    const matching = validOrders.filter(
      (o) => String(o.paymentMethod || '').toLowerCase() === method.toLowerCase()
    );
    const amount = matching.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0);
    const count = matching.length;
    const percentage = totalBilled > 0 ? Math.round((amount / totalBilled) * 100) : 0;

    return {
      method,
      amount,
      count,
      percentage,
    };
  });

  return breakdown;
}

/**
 * 7. Tax Summary Breakdown
 * Returns Tax Collected, Reversed Tax, and Net Valid Tax from stored snapshots
 */
export function getTaxBreakdown(filteredOrders = [], filteredReversals = []) {
  const validOrders = getValidNonReversedOrders(filteredOrders, filteredReversals);
  const taxCollected = validOrders.reduce((sum, o) => sum + (Number(o.taxAmount) || 0), 0);

  const reversedTax = filteredReversals.reduce(
    (sum, r) => sum + (Number(r.taxReversed) || 0),
    0
  );

  const grossTaxHistorical = filteredOrders.reduce(
    (sum, o) => sum + (Number(o.taxAmount) || 0),
    0
  );

  return {
    taxCollected, // Active valid tax
    reversedTax,
    grossTaxHistorical,
    netValidTax: taxCollected,
  };
}

/**
 * 8. Discount Summary Breakdown
 * Returns total discounts, percentage discounts contribution, and fixed discount contribution
 */
export function getDiscountBreakdown(filteredOrders = []) {
  let totalDiscounts = 0;
  let percentageDiscountsAmount = 0;
  let fixedDiscountsAmount = 0;
  let discountedOrdersCount = 0;

  filteredOrders.forEach((o) => {
    const disc = Number(o.discountAmount) || 0;
    if (disc > 0) {
      totalDiscounts += disc;
      discountedOrdersCount += 1;
      if (o.discountType === 'percentage') {
        percentageDiscountsAmount += disc;
      } else {
        fixedDiscountsAmount += disc;
      }
    }
  });

  return {
    totalDiscounts,
    percentageDiscountsAmount,
    fixedDiscountsAmount,
    discountedOrdersCount,
  };
}

/**
 * 9. Daily Revenue Trend Breakdown (Gross Billed vs Net Revenue vs Tax)
 */
export function groupRevenueByDate(filteredOrders = [], filteredReversals = [], datePreset = 'This Week', customRange = null, referenceDate = new Date()) {
  const interval = getDateIntervalForPreset(datePreset, customRange, referenceDate);
  const reversedIds = new Set(filteredReversals.map((r) => r.originalOrderId));

  let days = [];
  const isAstronomical = !interval || datePreset === 'All Time' || datePreset === 'All Dates' || interval.start.getFullYear() < 2000 || interval.end.getFullYear() > 2100;

  if (isAstronomical) {
    const allDates = [
      ...filteredOrders.map((o) => o.completedAt || o.createdAt),
      ...filteredReversals.map((r) => r.reversedAt || r.createdAt),
    ]
      .filter(Boolean)
      .map((d) => (typeof d === 'string' ? parseISO(d) : new Date(d)))
      .filter((d) => !isNaN(d.getTime()));

    if (allDates.length === 0) {
      days = [startOfDay(referenceDate)];
    } else {
      const timestamps = allDates.map((d) => startOfDay(d).getTime());
      const minDate = new Date(Math.min(...timestamps));
      const maxDate = new Date(Math.max(...timestamps));
      const dayDiff = Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24));

      if (dayDiff <= 31) {
        days = eachDayOfInterval({ start: minDate, end: maxDate });
      } else {
        const uniqueDayTimes = Array.from(new Set(timestamps)).sort((a, b) => a - b);
        days = uniqueDayTimes.map((t) => new Date(t));
      }
    }
  } else {
    try {
      days = eachDayOfInterval({ start: interval.start, end: interval.end });
    } catch {
      days = [startOfDay(referenceDate)];
    }
  }

  // Cap day count to 31 for performance and readability
  const slicedDays = days.slice(-31);

  return slicedDays.map((d) => {
    const dayLabel = format(d, 'dd MMM');

    const ordersOnDay = filteredOrders.filter((o) => {
      const dateVal = o.completedAt || o.createdAt;
      if (!dateVal) return false;
      try {
        const orderDate = typeof dateVal === 'string' ? parseISO(dateVal) : new Date(dateVal);
        return isSameDay(d, orderDate);
      } catch {
        return false;
      }
    });

    const grossBilled = ordersOnDay.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0);

    const validOrdersOnDay = ordersOnDay.filter(
      (o) => o.status !== 'reversed' && !reversedIds.has(o.id)
    );

    const netRevenue = validOrdersOnDay.reduce((sum, o) => {
      const g = Number(o.grandTotal) || 0;
      const t = Number(o.taxAmount) || 0;
      return sum + (g - t);
    }, 0);

    const tax = validOrdersOnDay.reduce((sum, o) => sum + (Number(o.taxAmount) || 0), 0);

    return {
      date: dayLabel,
      grossBilled,
      netRevenue,
      tax,
      orderCount: validOrdersOnDay.length,
    };
  });
}

/**
 * 10. Reversal Trend Grouped by Date
 */
export function groupReversalsByDate(filteredReversals = [], datePreset = 'This Week', customRange = null, referenceDate = new Date()) {
  const interval = getDateIntervalForPreset(datePreset, customRange, referenceDate);

  let days = [];
  const isAstronomical = !interval || datePreset === 'All Time' || datePreset === 'All Dates' || interval.start.getFullYear() < 2000 || interval.end.getFullYear() > 2100;

  if (isAstronomical) {
    const allDates = filteredReversals
      .map((r) => r.reversedAt || r.createdAt)
      .filter(Boolean)
      .map((d) => (typeof d === 'string' ? parseISO(d) : new Date(d)))
      .filter((d) => !isNaN(d.getTime()));

    if (allDates.length === 0) {
      days = [startOfDay(referenceDate)];
    } else {
      const timestamps = allDates.map((d) => startOfDay(d).getTime());
      const minDate = new Date(Math.min(...timestamps));
      const maxDate = new Date(Math.max(...timestamps));
      const dayDiff = Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24));

      if (dayDiff <= 31) {
        days = eachDayOfInterval({ start: minDate, end: maxDate });
      } else {
        const uniqueDayTimes = Array.from(new Set(timestamps)).sort((a, b) => a - b);
        days = uniqueDayTimes.map((t) => new Date(t));
      }
    }
  } else {
    try {
      days = eachDayOfInterval({ start: interval.start, end: interval.end });
    } catch {
      days = [startOfDay(referenceDate)];
    }
  }

  const slicedDays = days.slice(-31);

  return slicedDays.map((d) => {
    const dayLabel = format(d, 'dd MMM');

    const revsOnDay = filteredReversals.filter((r) => {
      const dateVal = r.reversedAt || r.createdAt;
      if (!dateVal) return false;
      try {
        const revDate = typeof dateVal === 'string' ? parseISO(dateVal) : new Date(dateVal);
        return isSameDay(d, revDate);
      } catch {
        return false;
      }
    });

    const reversalTotal = revsOnDay.reduce(
      (sum, r) => sum + (Number(r.totalReversedIncludingTax) || 0),
      0
    );

    return {
      date: dayLabel,
      reversalTotal,
      reversalCount: revsOnDay.length,
    };
  });
}

/**
 * 8. Profit & Cost Report Data Selector
 * Calculates:
 * - Net Sales (excluding tax, after discounts & reversals)
 * - COGS (historical cost snapshots, never recalculated from today's Item Master)
 * - Gross Profit & Margin
 * - Item-wise breakdown with Qty/Weight sold, Valid invoices, Net Sales, COGS, Profit, Margin
 * - Handles missing costs safely without assuming zero cost
 */
export function getProfitAndCostReportData(orders = [], reversals = [], filters = {}, itemsMaster = [], addonsMaster = []) {
  const filteredOrders = filterReportOrders(orders, filters);
  const validOrders = getValidNonReversedOrders(filteredOrders, reversals);

  const itemFilter = (filters.item || '').trim().toLowerCase();
  const categoryFilter = (filters.category || '').trim().toLowerCase();
  const viewType = (filters.viewType || 'all').trim().toLowerCase(); // 'all' | 'items' | 'addons'

  const masterItems = Array.isArray(itemsMaster) && itemsMaster.length > 0
    ? itemsMaster
    : Array.isArray(filters.itemsMaster)
    ? filters.itemsMaster
    : Array.isArray(filters.items)
    ? filters.items
    : [];

  const masterAddons = Array.isArray(addonsMaster) && addonsMaster.length > 0
    ? addonsMaster
    : Array.isArray(filters.addonsMaster)
    ? filters.addonsMaster
    : Array.isArray(filters.addons)
    ? filters.addons
    : [];

  const dealsList = storage.get('deals', []) || [];
  const itemMap = new Map();
  let missingCostLinesCount = 0;
  let validOrderCount = validOrders.length;
  let totalItemsSold = 0;

  validOrders.forEach((order) => {
    const orderTimestamp = toSafeDate(order.completedAt || order.createdAt)?.getTime() || 0;
    const lines = Array.isArray(order.lines) ? order.lines : [];

    lines.forEach((line) => {
      const lineItemId = String(line.itemId || line.id || 'unknown');
      const lineItemName = String(line.itemNameSnapshot || line.name || 'Item').trim();

      const foundDeal = (dealsList || []).find(
        (d) =>
          d.id === line.dealId ||
          d.id === line.itemId ||
          d.id === lineItemId ||
          (d.name && lineItemName && d.name.trim().toLowerCase() === lineItemName.toLowerCase()) ||
          (lineItemName.toLowerCase().includes('combo') && d.name && d.name.toLowerCase().includes('combo')) ||
          (lineItemName.toLowerCase().includes('deal') && d.name && d.name.toLowerCase().includes('deal'))
      );

      const isDealLine = Boolean(
        line.isDeal ||
        line.pricingMode === 'deal' ||
        line.dealId ||
        (Array.isArray(line.includedItems) && line.includedItems.length > 0) ||
        foundDeal !== undefined ||
        lineItemName.toLowerCase().includes('deal') ||
        lineItemName.toLowerCase().includes('combo') ||
        line.categoryIdSnapshot === 'cat-deals' ||
        line.categoryNameSnapshot === 'Deals' ||
        line.categoryName === 'Deals'
      );

      const lineCategory = isDealLine
        ? 'Deals'
        : String(
            line.categoryNameSnapshot && line.categoryNameSnapshot !== 'General'
              ? line.categoryNameSnapshot
              : line.categoryName && line.categoryName !== 'General'
              ? line.categoryName
              : 'General'
          );

      const qty = Math.max(1, Number(line.quantity || line.quantitySnapshot || 1));
      totalItemsSold += qty;

      const grossLineSale = Number(line.grossLineSale ?? line.lineSubtotal ?? (Number(line.unitPrice || 0) * qty));

      let allocatedDiscount = 0;
      if (line.allocatedDiscount !== undefined && line.allocatedDiscount !== null) {
        allocatedDiscount = Number(line.allocatedDiscount);
      } else if (order.discountAmount > 0 && order.subtotal > 0) {
        allocatedDiscount = Math.round((grossLineSale / order.subtotal) * order.discountAmount);
      }

      const netRevenue = line.netRevenue !== undefined && line.netRevenue !== null
        ? Number(line.netRevenue)
        : Math.max(0, grossLineSale - allocatedDiscount);

      // Extract raw addons attached to this line
      const rawAddons = Array.isArray(line.addonSnapshots) && line.addonSnapshots.length > 0
        ? line.addonSnapshots
        : Array.isArray(line.addons) && line.addons.length > 0
        ? line.addons
        : Array.isArray(line.selectedAddons) && line.selectedAddons.length > 0
        ? line.selectedAddons
        : [];

      // Check item / deal cost presence
      let lineItemCostPrice = null;
      let matchedCatItem = null;
      let dealComponentsBreakdown = [];

      const incItems = (Array.isArray(line.includedItems) && line.includedItems.length > 0)
        ? line.includedItems
        : (foundDeal?.includedItems || []);

      if (isDealLine) {
        let sumDealCost = 0;
        let dealAllCost = incItems.length > 0;

        const compList = incItems.map((inc) => {
          const incQty = Number(inc.quantity) || 1;
          const totalQty = incQty * qty;
          const masterMatch = (masterItems || []).find(
            (mi) => mi.id === inc.itemId || (mi.name && inc.name && mi.name.trim().toLowerCase() === inc.name.trim().toLowerCase())
          );
          let unitCost = null;
          if (inc.costPrice !== undefined && inc.costPrice !== null && !isNaN(Number(inc.costPrice)) && Number(inc.costPrice) >= 0) {
            unitCost = Number(inc.costPrice);
          } else if (masterMatch?.costPrice !== undefined && masterMatch?.costPrice !== null && !isNaN(Number(masterMatch.costPrice))) {
            unitCost = Number(masterMatch.costPrice);
          }
          const hasCompCost = unitCost !== null;
          if (hasCompCost) {
            sumDealCost += unitCost * totalQty;
          } else {
            dealAllCost = false;
          }

          const unitSelling = Number(inc.sellingPrice ?? masterMatch?.basePrice ?? 0);
          const totalSelling = unitSelling * totalQty;

          return {
            id: inc.itemId || inc.id || `comp_${(inc.name || 'item').toLowerCase()}`,
            name: inc.name || masterMatch?.name || 'Deal Item',
            portion: inc.portion || inc.portionDisplay || '',
            singleQty: incQty,
            totalQty,
            unitCost: unitCost || 0,
            totalCost: (unitCost || 0) * totalQty,
            unitSelling,
            totalSelling,
            hasCost: hasCompCost,
          };
        });

        if (dealAllCost && sumDealCost > 0) {
          lineItemCostPrice = Math.round(sumDealCost / qty);
        } else if (line.costPriceSnapshot !== undefined && line.costPriceSnapshot !== null && Number(line.costPriceSnapshot) > 0) {
          lineItemCostPrice = Number(line.costPriceSnapshot);
        }

        // Allocate net sales and calculate individual profit for each component inside this deal
        const totalRegSelling = compList.reduce((sum, c) => sum + c.totalSelling, 0);
        let remainingNet = netRevenue;

        dealComponentsBreakdown = compList.map((comp, cIdx) => {
          let allocatedSales = 0;
          if (cIdx === compList.length - 1) {
            allocatedSales = remainingNet;
          } else if (totalRegSelling > 0) {
            allocatedSales = Math.round((comp.totalSelling / totalRegSelling) * netRevenue);
            remainingNet -= allocatedSales;
          } else {
            allocatedSales = Math.round(netRevenue / Math.max(1, compList.length));
            remainingNet -= allocatedSales;
          }

          const compProfit = comp.hasCost ? (allocatedSales - comp.totalCost) : null;
          const compMargin = comp.hasCost && allocatedSales > 0
            ? Number(((compProfit / allocatedSales) * 100).toFixed(2))
            : null;

          return {
            ...comp,
            allocatedNetSales: allocatedSales,
            grossProfit: compProfit,
            margin: compMargin,
            profitMargin: compMargin !== null ? `${compMargin}%` : null,
          };
        });
      } else {
        if (line.costPriceSnapshot !== undefined && line.costPriceSnapshot !== null) {
          lineItemCostPrice = Number(line.costPriceSnapshot);
        } else if (line.costPrice !== undefined && line.costPrice !== null) {
          lineItemCostPrice = Number(line.costPrice);
        }

        if (masterItems.length > 0) {
          matchedCatItem = masterItems.find(
            (mi) =>
              mi &&
              (mi.id === line.itemId ||
                String(mi.id).toLowerCase() === String(line.itemId).toLowerCase() ||
                (mi.name && lineItemName && mi.name.trim().toLowerCase() === lineItemName.trim().toLowerCase()))
          );
          const isHeuristicFallback =
            lineItemCostPrice !== null &&
            lineItemCostPrice === Math.round(Number(line.unitPrice || 0) * 0.55);
          if ((lineItemCostPrice === null || isHeuristicFallback) && matchedCatItem?.costPrice !== undefined && matchedCatItem?.costPrice !== null) {
            lineItemCostPrice = Number(matchedCatItem.costPrice);
          }
        }
      }

      const isWeight = Boolean(
        line.pricingMode === 'portion' ||
        line.pricingMode === 'custom_weight' ||
        line.pricingMode === 'weight' ||
        (line.selectedWeightGrams && Number(line.selectedWeightGrams) > 0)
      );

      // Helper function for portion or piece COGS
      const calcItemBaseCOGS = () => {
        if (lineItemCostPrice === null || isNaN(lineItemCostPrice) || lineItemCostPrice < 0) {
          return null;
        }
        if (isWeight) {
          let derivedGrams = Number(line.selectedWeightGrams) || 0;
          if (derivedGrams <= 0) {
            const label = String(line.selectedPortionLabel || line.portion || line.baseUnitSnapshot || '').toLowerCase();
            if (label.includes('1kg') || label === '1 kg') derivedGrams = 1000;
            else if (label.match(/(\d+)\s*g/)) derivedGrams = Number(label.match(/(\d+)\s*g/)[1]);
            else if (label.includes('half')) derivedGrams = 500;
            else if (label.includes('quarter')) derivedGrams = 250;
            else derivedGrams = 1000;
          }
          if (derivedGrams > 0) {
            return Math.round((derivedGrams / 1000) * lineItemCostPrice * qty);
          }
          if (line.unitPrice && matchedCatItem?.basePrice) {
            const ratio = Math.min(1, Math.max(0.1, Number(line.unitPrice) / Number(matchedCatItem.basePrice)));
            return Math.round(lineItemCostPrice * ratio * qty);
          }
        }
        return Math.round(lineItemCostPrice * qty);
      };

      // Process attached add-ons
      let lineAddonsGrossSale = 0;
      let lineAddonsTotalCOGS = 0;
      const processedAddons = rawAddons.map((a, aIdx) => {
        const aName = String(a.name || 'Add-on').trim();
        const aId = String(a.id || `addon_${aName.toLowerCase()}`);
        const aQty = a.quantity !== undefined ? Math.max(1, Number(a.quantity)) : 1;
        const aPrice = Number(a.price ?? a.sellingPrice) || 0;
        const aGross = aPrice * aQty * qty;
        lineAddonsGrossSale += aGross;

        // Lookup add-on cost
        let aCost = null;
        if (a.costPrice !== undefined && a.costPrice !== null && a.costPrice !== '') {
          aCost = Number(a.costPrice);
        } else if (masterAddons.length > 0) {
          const found = masterAddons.find(
            (ma) =>
              ma &&
              (ma.id === a.id ||
                String(ma.id).toLowerCase() === String(a.id).toLowerCase() ||
                (ma.name && ma.name.trim().toLowerCase() === aName.toLowerCase()))
          );
          if (found?.costPrice !== undefined && found?.costPrice !== null && found?.costPrice !== '') {
            aCost = Number(found.costPrice);
          }
        }

        const aHasCost = aCost !== null && !isNaN(aCost) && aCost >= 0;
        const aTotalCOGS = aHasCost ? Math.round(aCost * aQty * qty) : null;
        if (aHasCost) {
          lineAddonsTotalCOGS += aTotalCOGS;
        }

        return {
          id: aId,
          name: aName,
          price: aPrice,
          singleQty: aQty,
          qty: aQty * qty,
          gross: aGross,
          cost: aCost,
          hasCost: aHasCost,
          totalCOGS: aTotalCOGS,
        };
      });

      const isHeuristicCOGS =
        line.totalCOGS !== undefined &&
        line.totalCOGS !== null &&
        Number(line.totalCOGS) === Math.round(Number(line.unitPrice || 0) * 0.55);

      let itemCOGSVal = null;
      if (isDealLine && lineItemCostPrice !== null) {
        itemCOGSVal = Math.round(lineItemCostPrice * qty);
      } else if (isHeuristicCOGS && lineItemCostPrice !== null) {
        itemCOGSVal = calcItemBaseCOGS();
      } else if (processedAddons.length === 0) {
        if (line.totalCOGS !== undefined && line.totalCOGS !== null) {
          itemCOGSVal = Number(line.totalCOGS);
        } else if (line.itemCOGS !== undefined && line.itemCOGS !== null) {
          itemCOGSVal = Number(line.itemCOGS) + (Number(line.addonCOGS) || 0);
        } else {
          itemCOGSVal = calcItemBaseCOGS();
        }
      } else {
        if (line.itemCOGS !== undefined && line.itemCOGS !== null) {
          itemCOGSVal = Number(line.itemCOGS);
        } else {
          const baseCOGS = calcItemBaseCOGS();
          if (baseCOGS !== null) {
            itemCOGSVal = baseCOGS;
          } else if (line.totalCOGS !== undefined && line.totalCOGS !== null) {
            itemCOGSVal = Math.max(0, Number(line.totalCOGS) - lineAddonsTotalCOGS);
          }
        }
      }

      // Calculate net revenue and COGS for Item and each Add-on
      let itemNetRevenue = netRevenue;
      if (processedAddons.length > 0 && grossLineSale > 0) {
        let sumAddonsNet = 0;
        processedAddons.forEach((pa) => {
          const aDiscount = Math.round((pa.gross / grossLineSale) * allocatedDiscount);
          pa.netRevenue = Math.max(0, pa.gross - aDiscount);
          sumAddonsNet += pa.netRevenue;
        });
        itemNetRevenue = Math.max(0, netRevenue - sumAddonsNet);
      }

      // If line had totalCOGS stored without breakdown, fallback appropriately
      if (itemCOGSVal === null && line.totalCOGS !== undefined && line.totalCOGS !== null) {
        if (processedAddons.length > 0) {
          itemCOGSVal = Math.max(0, Number(line.totalCOGS) - lineAddonsTotalCOGS);
        } else {
          itemCOGSVal = Number(line.totalCOGS);
        }
      }

      const itemHasCost = itemCOGSVal !== null;
      if (!itemHasCost && viewType !== 'addons') {
        missingCostLinesCount += 1;
      }

      // Check if Item matches filters
      const matchesCategoryItem =
        !categoryFilter ||
        categoryFilter === 'all' ||
        lineCategory.toLowerCase() === categoryFilter ||
        lineCategory.toLowerCase().includes(categoryFilter);

      const matchesNameItem =
        !itemFilter ||
        itemFilter === 'all' ||
        lineItemName.toLowerCase().includes(itemFilter) ||
        lineItemId.toLowerCase() === itemFilter;

      const shouldIncludeItem =
        (viewType === 'all' ||
          (viewType === 'items' && !isDealLine) ||
          (viewType === 'deals' && isDealLine)) &&
        categoryFilter !== 'add-ons' &&
        categoryFilter !== 'addon' &&
        matchesCategoryItem &&
        matchesNameItem;

      if (shouldIncludeItem) {
        const itemKey = `${lineItemId}_${lineItemName.toLowerCase()}`;
        if (!itemMap.has(itemKey)) {
          itemMap.set(itemKey, {
            id: lineItemId,
            name: lineItemName,
            category: lineCategory,
            isAddon: false,
            isDeal: isDealLine,
            includedItems: incItems,
            includedComponents: dealComponentsBreakdown,
            invoicesSet: new Set(),
            qtySold: 0,
            weightGramsSold: 0,
            isWeight,
            netSales: 0,
            cogs: 0,
            hasCost: true,
            missingCostCount: 0,
            lastSoldAt: orderTimestamp,
          });
        }
        const entry = itemMap.get(itemKey);
        entry.invoicesSet.add(order.invoiceNumber);
        entry.qtySold += qty;
        if (line.selectedWeightGrams) {
          entry.weightGramsSold += Number(line.selectedWeightGrams) * qty;
        }
        entry.netSales += itemNetRevenue;
        entry.lastSoldAt = Math.max(entry.lastSoldAt || 0, orderTimestamp);

        if (itemHasCost) {
          entry.cogs += itemCOGSVal;
        } else {
          entry.hasCost = false;
          entry.missingCostCount += 1;
        }

        if (dealComponentsBreakdown.length > 0) {
          entry.includedComponents = dealComponentsBreakdown;
        }
      }

      // Add processed Addons to itemMap
      if (viewType !== 'items' && viewType !== 'deals') {
        processedAddons.forEach((pa) => {
          if (!pa.hasCost) {
            missingCostLinesCount += 1;
          }

          const matchesCategoryAddon =
            !categoryFilter ||
            categoryFilter === 'all' ||
            categoryFilter === 'add-ons' ||
            categoryFilter === 'addon' ||
            categoryFilter === 'add-on';

          const matchesNameAddon =
            !itemFilter ||
            itemFilter === 'all' ||
            pa.name.toLowerCase().includes(itemFilter) ||
            pa.id.toLowerCase() === itemFilter;

          if (matchesCategoryAddon && matchesNameAddon) {
            const addonKey = `addon_${pa.id}_${pa.name.toLowerCase()}`;
            if (!itemMap.has(addonKey)) {
              itemMap.set(addonKey, {
                id: pa.id,
                name: pa.name,
                category: 'Add-ons',
                isAddon: true,
                invoicesSet: new Set(),
                qtySold: 0,
                weightGramsSold: 0,
                isWeight: false,
                netSales: 0,
                cogs: 0,
                hasCost: true,
                missingCostCount: 0,
                lastSoldAt: orderTimestamp,
              });
            }
            const aEntry = itemMap.get(addonKey);
            aEntry.invoicesSet.add(order.invoiceNumber);
            aEntry.qtySold += (pa.qty ?? qty);
            aEntry.netSales += (pa.netRevenue ?? pa.gross);
            aEntry.lastSoldAt = Math.max(aEntry.lastSoldAt || 0, orderTimestamp);

            if (pa.hasCost && pa.totalCOGS !== null) {
              aEntry.cogs += pa.totalCOGS;
            } else {
              aEntry.hasCost = false;
              aEntry.missingCostCount += 1;
            }
          }
        });
      }
    });
  });

  const baseRows = Array.from(itemMap.values()).map((entry) => {
    let qtyWeightDisplay = `${entry.qtySold} pcs`;
    if (entry.isWeight && entry.weightGramsSold > 0) {
      const kgVal = (entry.weightGramsSold / 1000).toFixed(2).replace(/\.00$/, '');
      qtyWeightDisplay = `${kgVal} kg`;
    }

    const netSales = Math.round(entry.netSales);
    const cogs = entry.hasCost ? Math.round(entry.cogs) : null;
    const grossProfit = entry.hasCost && cogs !== null ? (netSales - cogs) : null;

    const margin = entry.hasCost && grossProfit !== null && netSales > 0
      ? Number(((grossProfit / netSales) * 100).toFixed(2))
      : null;

    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      isAddon: Boolean(entry.isAddon),
      isDeal: Boolean(entry.isDeal),
      includedItems: entry.includedItems || [],
      includedComponents: entry.includedComponents || [],
      validInvoices: entry.invoicesSet.size,
      qtySold: entry.qtySold,
      weightGramsSold: entry.weightGramsSold,
      qtyWeightDisplay,
      netSales,
      cogs,
      grossProfit,
      margin,
      profitMargin: margin !== null ? `${margin}%` : null,
      hasCost: entry.hasCost,
      missingCostCount: entry.missingCostCount,
      lastSoldAt: entry.lastSoldAt || 0,
    };
  });

  const sortBy = (filters.sortBy || 'recent').toLowerCase().trim();

  // Sort base rows: Default to recently sold first (latest sale timestamp descending), then by netSales
  baseRows.sort((a, b) => {
    if (sortBy === 'sales' || sortBy === 'netsales') {
      return b.netSales - a.netSales;
    }
    if (sortBy === 'profit' || sortBy === 'grossprofit') {
      const pA = a.hasCost && a.grossProfit !== null ? a.grossProfit : -Infinity;
      const pB = b.hasCost && b.grossProfit !== null ? b.grossProfit : -Infinity;
      return pB - pA;
    }
    if (sortBy === 'margin') {
      const mA = a.hasCost && a.margin !== null ? a.margin : -Infinity;
      const mB = b.hasCost && b.margin !== null ? b.margin : -Infinity;
      return mB - mA;
    }
    if (sortBy === 'qty' || sortBy === 'quantity') {
      return b.qtySold - a.qtySold;
    }
    // Default: 'recent' (Latest sold items on top!)
    const timeDiff = (b.lastSoldAt || 0) - (a.lastSoldAt || 0);
    if (timeDiff !== 0) return timeDiff;
    return b.netSales - a.netSales;
  });

  let itemRows = [];
  if (viewType === 'deals') {
    baseRows.forEach((dealRow) => {
      itemRows.push(dealRow);
      if (Array.isArray(dealRow.includedComponents) && dealRow.includedComponents.length > 0) {
        dealRow.includedComponents.forEach((comp) => {
          itemRows.push({
            id: `${dealRow.id}_comp_${comp.id}`,
            name: comp.name,
            portion: comp.portion,
            parentDealName: dealRow.name,
            isDealComponent: true,
            isDeal: false,
            isAddon: false,
            category: 'Deal Item',
            validInvoices: dealRow.validInvoices,
            qtySold: comp.totalQty,
            weightGramsSold: 0,
            qtyWeightDisplay: `${comp.totalQty} pcs${comp.portion ? ` (${comp.portion})` : ''}`,
            netSales: Math.round(comp.allocatedNetSales),
            cogs: comp.hasCost ? Math.round(comp.totalCost) : null,
            grossProfit: comp.hasCost && comp.grossProfit !== null ? Math.round(comp.grossProfit) : null,
            margin: comp.margin,
            profitMargin: comp.profitMargin,
            hasCost: comp.hasCost,
            missingCostCount: comp.hasCost ? 0 : 1,
          });
        });
      }
    });
  } else {
    itemRows = baseRows;
  }

  // Exact mathematical totals derived from primary rows (avoid double counting child deal components)
  const primaryRows = itemRows.filter((r) => !r.isDealComponent);
  const totalNetSales = primaryRows.reduce((sum, r) => sum + r.netSales, 0);
  const totalCOGS = primaryRows.reduce((sum, r) => sum + (r.cogs || 0), 0);
  const totalGrossProfit = primaryRows.reduce((sum, r) => sum + (r.grossProfit || 0), 0);

  const overallMargin = totalNetSales > 0
    ? Number(((totalGrossProfit / totalNetSales) * 100).toFixed(2))
    : 0;

  return {
    kpis: {
      netSales: totalNetSales,
      cogs: totalCOGS,
      grossProfit: totalGrossProfit,
      grossProfitMargin: overallMargin,
      missingCostCount: missingCostLinesCount,
      hasMissingCosts: missingCostLinesCount > 0,
      validOrdersCount: validOrderCount,
      totalItemsCount: totalItemsSold,
    },
    itemRows,
  };
}

/**
 * 9. Financial Trend By Date Selector
 * Returns clean daily/monthly points for Net Revenue, Total COGS, and Gross Profit.
 */
export function groupFinancialTrendByDate(
  filteredOrders = [],
  filteredReversals = [],
  datePreset = 'This Week',
  customRange = null,
  referenceDate = new Date(),
  itemsMaster = [],
  addonsMaster = []
) {
  const interval = (datePreset !== 'All Time' && datePreset !== 'All Dates')
    ? getDateIntervalForPreset(datePreset, customRange, referenceDate)
    : null;

  const reversedIds = new Set(
    filteredReversals.flatMap((r) => [r.originalOrderId, r.orderId, r.originalInvoiceNumber]).filter(Boolean)
  );

  let days = [];
  const isAstronomical =
    !interval ||
    datePreset === 'All Time' ||
    datePreset === 'All Dates' ||
    interval.start.getFullYear() < 2000 ||
    interval.end.getFullYear() > 2100;

  if (isAstronomical) {
    const allDates = [
      ...filteredOrders.map((o) => o.completedAt || o.createdAt),
      ...filteredReversals.map((r) => r.reversedAt || r.createdAt),
    ]
      .filter(Boolean)
      .map((d) => toSafeDate(d))
      .filter((d) => d && !isNaN(d.getTime()));

    if (allDates.length === 0) {
      days = [startOfDay(referenceDate)];
    } else {
      const timestamps = allDates.map((d) => startOfDay(d).getTime());
      const minDate = new Date(Math.min(...timestamps));
      const maxDate = new Date(Math.max(...timestamps));
      const dayDiff = Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24));

      if (dayDiff <= 31) {
        days = eachDayOfInterval({ start: minDate, end: maxDate });
      } else {
        const uniqueDayTimes = Array.from(new Set(timestamps)).sort((a, b) => a - b);
        days = uniqueDayTimes.map((t) => new Date(t));
      }
    }
  } else {
    try {
      days = eachDayOfInterval({ start: interval.start, end: interval.end });
    } catch {
      days = [startOfDay(referenceDate)];
    }
  }

  // Cap day count to 31 for chart legibility
  const slicedDays = days.slice(-31);

  return slicedDays.map((d) => {
    const dayLabel = format(d, 'dd MMM');

    const ordersOnDay = filteredOrders.filter((o) => {
      const dateVal = o.completedAt || o.createdAt;
      const orderDate = toSafeDate(dateVal);
      if (!orderDate) return false;
      return isSameDay(d, orderDate);
    });

    const validOrdersOnDay = ordersOnDay.filter(
      (o) => o.status !== 'reversed' && !reversedIds.has(o.id) && !reversedIds.has(o.invoiceNumber)
    );

    const netRevenue = validOrdersOnDay.reduce((sum, o) => {
      const grand = Number(o.grandTotal) || 0;
      const tax = Number(o.taxAmount) || 0;
      return sum + (grand - tax);
    }, 0);

    // Derive day's COGS from valid orders
    let dayCOGS = 0;
    validOrdersOnDay.forEach((o) => {
      (o.lines || []).forEach((l) => {
        if (l.totalCOGS !== undefined && l.totalCOGS !== null) {
          dayCOGS += Number(l.totalCOGS);
        } else if (l.itemCOGS !== undefined && l.itemCOGS !== null) {
          dayCOGS += Number(l.itemCOGS) + (Number(l.addonCOGS) || 0);
        } else if (l.costPriceSnapshot !== undefined && l.costPriceSnapshot !== null) {
          const qty = Math.max(1, Number(l.quantity || 1));
          dayCOGS += Number(l.costPriceSnapshot) * qty;
        }
      });
    });

    const grossProfit = netRevenue - dayCOGS;

    return {
      date: format(d, 'yyyy-MM-dd'),
      label: dayLabel,
      netRevenue,
      cogs: dayCOGS,
      grossProfit,
    };
  });
}

/**
 * 10. Financial Summary / Profit & Loss Report Selector
 * Reconciles 100% with:
 * - Revenue Section: Gross Sales - Discounts - Reversals = Net Revenue (Tax strictly excluded)
 * - Cost of Sales: Food COGS + Add-on COGS + Deal COGS = Total COGS (Historical sale snapshots)
 * - Gross Profit: Net Revenue - Total COGS
 * - Gross Margin %: (Gross Profit / Net Revenue) * 100 (Safe against zero revenue)
 * - Tax Summary: Tax Collected strictly separated
 * - Payment Collection: Cash, Card, Online, Other reconciled with completed transactions
 * - Reversals & Discounts Audit
 * - Item Profitability Table with proper weights for weight items
 */
export function deriveFinancialSummaryReport(
  orders = [],
  reversals = [],
  filters = {},
  itemsMaster = [],
  addonsMaster = [],
  expenses = []
) {
  const filteredOrders = filterReportOrders(orders, filters);
  const filteredReversals = filterReportReversals(reversals, filters);
  const validOrders = getValidNonReversedOrders(filteredOrders, filteredReversals);

  // 1. REVENUE SECTION
  // Gross Sales = Sum of all completed orders' subtotal (before discounts and before tax)
  const grossSales = filteredOrders.reduce((sum, o) => {
    const sub = Number(o.subtotal);
    if (!isNaN(sub) && sub > 0) return sum + sub;
    const linesGross = (o.lines || []).reduce((lSum, l) => lSum + (Number(l.lineSubtotal) || (Number(l.unitPrice || 0) * Math.max(1, Number(l.quantity || 1)))), 0);
    return sum + linesGross;
  }, 0);

  // Discounts = Total discounts across all completed orders in range
  const totalDiscounts = filteredOrders.reduce((sum, o) => sum + (Number(o.discountAmount) || 0), 0);

  // Net Revenue = Sum of valid non-reversed sales excluding tax (grandTotal - taxAmount)
  const netRevenue = validOrders.reduce((sum, o) => {
    const grand = Number(o.grandTotal) || 0;
    const tax = Number(o.taxAmount) || 0;
    return sum + (grand - tax);
  }, 0);

  // Reversal Effect on Net Revenue = (Gross Sales - Discounts) - Net Revenue
  // Guarantees: Gross Sales - Discounts - Reversal Effect === Net Revenue 100% exact!
  const reversalEffect = Math.max(0, (grossSales - totalDiscounts) - netRevenue);

  // 2. COST OF SALES & ITEM PROFITABILITY
  // Reuse getProfitAndCostReportData for historical snapshot consistency
  const profitData = getProfitAndCostReportData(
    orders,
    reversals,
    { ...filters, viewType: 'all', sortBy: filters.sortBy || 'sales' },
    itemsMaster,
    addonsMaster
  );

  const primaryItemRows = (profitData.itemRows || []).filter((r) => !r.isDealComponent);

  let foodCOGS = 0;
  let dealCOGS = 0;
  let addonCOGS = 0;

  primaryItemRows.forEach((r) => {
    const cogsVal = r.hasCost && r.cogs !== null ? Number(r.cogs) : 0;
    if (r.isDeal) {
      dealCOGS += cogsVal;
    } else if (r.isAddon) {
      addonCOGS += cogsVal;
    } else {
      foodCOGS += cogsVal;
    }
  });

  const totalCOGS = foodCOGS + dealCOGS + addonCOGS;
  const missingCostCount = profitData.kpis?.missingCostCount || 0;
  const hasIncompleteCosts = profitData.kpis?.hasMissingCosts || missingCostCount > 0;

  // 3. GROSS PROFIT (Existing pure calculation untouched)
  const grossProfit = netRevenue - totalCOGS;
  const grossProfitMargin = netRevenue > 0
    ? Number(((grossProfit / netRevenue) * 100).toFixed(2))
    : 0;

  // 3.1 OPERATING EXPENSES & OPERATING PROFIT (Regression-locked: does not change Gross Profit or Revenue)
  const filteredExpenses = filterExpenses(expenses, filters);
  const expenseSummary = calculateExpenseSummary(filteredExpenses);
  const operatingExpenses = expenseSummary.totalExpenses;
  const operatingExpensesBreakdown = expenseSummary.categoryBreakdown;
  const operatingProfit = Math.round((grossProfit - operatingExpenses) * 100) / 100;
  const operatingProfitMargin = netRevenue > 0
    ? Number(((operatingProfit / netRevenue) * 100).toFixed(2))
    : 0;

  // 4. TAX SUMMARY (Strictly excluded from Revenue and Profit)
  const taxCollected = validOrders.reduce((sum, o) => sum + (Number(o.taxAmount) || 0), 0);

  // 5. PAYMENT COLLECTION (Reconciles actual collected tenders with completed valid transactions)
  let cashTotal = 0;
  let cardTotal = 0;
  let onlineTotal = 0;
  let otherTotal = 0;
  let cashCount = 0;
  let cardCount = 0;
  let onlineCount = 0;
  let otherCount = 0;

  validOrders.forEach((o) => {
    const grand = Number(o.grandTotal) || 0;
    const due = Math.max(0, Number(o.balanceDue != null ? o.balanceDue : (o.amountReceived != null ? Math.max(0, grand - Number(o.amountReceived)) : 0)));
    const collected = Math.max(0, grand - due);
    const method = String(o.paymentMethod || 'Cash').trim().toLowerCase();
    if (method === 'cash') {
      cashTotal += collected;
      cashCount += 1;
    } else if (method === 'card') {
      cardTotal += collected;
      cardCount += 1;
    } else if (method === 'online') {
      onlineTotal += collected;
      onlineCount += 1;
    } else {
      otherTotal += collected;
      otherCount += 1;
    }
  });

  const totalCollected = validOrders.reduce((sum, o) => {
    const grand = Number(o.grandTotal) || 0;
    const due = Math.max(0, Number(o.balanceDue != null ? o.balanceDue : (o.amountReceived != null ? Math.max(0, grand - Number(o.amountReceived)) : 0)));
    return sum + Math.max(0, grand - due);
  }, 0);

  const paymentBreakdownList = [
    { method: 'Cash', amount: cashTotal, count: cashCount, percentage: totalCollected > 0 ? Math.round((cashTotal / totalCollected) * 100) : 0 },
    { method: 'Card', amount: cardTotal, count: cardCount, percentage: totalCollected > 0 ? Math.round((cardTotal / totalCollected) * 100) : 0 },
    { method: 'Online', amount: onlineTotal, count: onlineCount, percentage: totalCollected > 0 ? Math.round((onlineTotal / totalCollected) * 100) : 0 },
    ...(otherTotal > 0 || otherCount > 0
      ? [{ method: 'Other', amount: otherTotal, count: otherCount, percentage: totalCollected > 0 ? Math.round((otherTotal / totalCollected) * 100) : 0 }]
      : []),
  ];

  // 6. OUTSTANDING RECEIVABLES & VALID BILLED RECONCILIATION
  const totalOutstanding = validOrders.reduce((sum, o) => {
    const due = o.balanceDue != null
      ? Number(o.balanceDue)
      : (o.amountReceived != null ? Math.max(0, (Number(o.grandTotal) || 0) - Number(o.amountReceived)) : 0);
    return sum + Math.max(0, due || 0);
  }, 0);
  const outstandingCount = validOrders.filter((o) => {
    const due = o.balanceDue != null
      ? Number(o.balanceDue)
      : (o.amountReceived != null ? Math.max(0, (Number(o.grandTotal) || 0) - Number(o.amountReceived)) : 0);
    return due > 0;
  }).length;
  const validBilled = validOrders.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0);

  // 7. REVERSALS AUDIT
  const reversalCount = filteredReversals.length;
  const reversalValue = filteredReversals.reduce(
    (sum, r) => sum + (Number(r.totalReversedIncludingTax) || 0),
    0
  );
  const reversalNetValue = filteredReversals.reduce(
    (sum, r) => sum + ((Number(r.totalReversedIncludingTax) || 0) - (Number(r.taxReversed) || 0)),
    0
  );

  // 8. DAILY TREND POINTS (One clean chart)
  const trendPoints = groupFinancialTrendByDate(
    filteredOrders,
    filteredReversals,
    filters.datePreset,
    filters.customRange,
    filters.referenceDate || new Date(),
    itemsMaster,
    addonsMaster
  );

  return {
    statement: {
      // Revenue
      grossSales,
      validBilled,
      discounts: totalDiscounts,
      reversalEffect,
      netRevenue,

      // Cost of Sales
      foodCOGS,
      addonCOGS,
      dealCOGS,
      totalCOGS,
      hasIncompleteCosts,
      missingCostCount,

      // Profit
      grossProfit,
      grossProfitMargin,

      // Operating Expenses & Operating Profit (Regression-Locked)
      operatingExpenses,
      operatingExpensesBreakdown,
      operatingProfit,
      operatingProfitMargin,
      activeExpenseCount: expenseSummary.expenseEntries,
      cashExpenses: expenseSummary.cashExpenses,
      onlineExpenses: expenseSummary.onlineExpenses,
      expensePaymentBreakdown: expenseSummary.paymentMethodBreakdown,

      // Tax
      taxCollected,

      // Payments
      cashTotal,
      cardTotal,
      onlineTotal,
      otherTotal,
      totalCollected,
      paymentBreakdownList,
      totalOutstanding,
      outstandingCount,

      // Reversals & Discounts
      totalDiscounts,
      reversalCount,
      reversalValue,
      reversalNetValue,
    },
    itemRows: primaryItemRows,
    trendPoints,
    kpis: {
      grossSales,
      validBilled,
      discounts: totalDiscounts,
      reversalEffect,
      netRevenue,
      foodCOGS,
      addonCOGS,
      dealCOGS,
      totalCOGS,
      grossProfit,
      grossProfitMargin,
      operatingExpenses,
      operatingProfit,
      operatingProfitMargin,
      taxCollected,
      totalCollected,
      totalOutstanding,
      outstandingCount,
      reversalCount,
      reversalValue,
      hasIncompleteCosts,
      missingCostCount,
      completedOrdersCount: filteredOrders.length,
      validOrdersCount: validOrders.length,
    },
  };
}
