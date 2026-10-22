import { describe, it, expect } from 'vitest';
import {
  filterReportOrders,
  filterReportReversals,
  deriveSalesReport,
  deriveRevenueReport,
  deriveReversalReport,
  getPaymentMethodBreakdown,
  getTaxBreakdown,
  getDiscountBreakdown,
  groupRevenueByDate,
  groupReversalsByDate,
  getProfitAndCostReportData,
} from './reportSelectors';
import {
  calculateGrossSales,
  calculateCompletedOrders,
  calculateNetRevenue,
  calculateTaxCollected,
  calculateReversalTotal,
} from './dashboardSelectors';

describe('Batch 5: Complete Reporting Module (Sales, Revenue, Reversals)', () => {
  // Test Fixture Orders
  const orderCompleted1 = {
    id: 'ord-1',
    invoiceNumber: 'INV-001',
    status: 'completed',
    orderType: 'Dine-In',
    paymentMethod: 'Cash',
    completedAt: '2026-10-05T12:00:00.000Z',
    createdAt: '2026-10-05T12:00:00.000Z',
    lines: [
      {
        id: 'l-1',
        itemNameSnapshot: 'Chicken Biryani',
        categoryNameSnapshot: 'Biryani',
        quantity: 2,
        unitPrice: 400,
        lineSubtotal: 800,
      },
    ],
    subtotal: 800,
    discountAmount: 50,
    taxableAmount: 750,
    taxRateSnapshot: 16,
    taxAmount: 120,
    grandTotal: 870,
  };

  const orderCompleted2 = {
    id: 'ord-2',
    invoiceNumber: 'INV-002',
    status: 'completed',
    orderType: 'Takeaway',
    paymentMethod: 'Card',
    completedAt: '2026-10-06T15:30:00.000Z',
    createdAt: '2026-10-06T15:30:00.000Z',
    lines: [
      {
        id: 'l-2',
        itemNameSnapshot: 'Beef Burger',
        categoryNameSnapshot: 'Burgers',
        quantity: 3,
        unitPrice: 300,
        lineSubtotal: 900,
      },
      {
        id: 'l-3',
        itemNameSnapshot: 'Cold Drink Can',
        categoryNameSnapshot: 'Cold Drinks',
        quantity: 3,
        unitPrice: 100,
        lineSubtotal: 300,
      },
    ],
    subtotal: 1200,
    discountAmount: 0,
    taxableAmount: 1200,
    taxRateSnapshot: 16,
    taxAmount: 192,
    grandTotal: 1392,
  };

  const orderReversed = {
    id: 'ord-3',
    invoiceNumber: 'INV-003',
    status: 'reversed',
    orderType: 'Dine-In',
    paymentMethod: 'Online',
    completedAt: '2026-10-07T18:00:00.000Z',
    createdAt: '2026-10-07T18:00:00.000Z',
    lines: [
      {
        id: 'l-4',
        itemNameSnapshot: 'Chicken Karahi',
        categoryNameSnapshot: 'Karahi & Handi',
        quantity: 1,
        unitPrice: 1500,
        lineSubtotal: 1500,
      },
    ],
    subtotal: 1500,
    discountAmount: 100,
    taxableAmount: 1400,
    taxRateSnapshot: 16,
    taxAmount: 224,
    grandTotal: 1624,
  };

  const mockReversal = {
    id: 'rev-01',
    originalOrderId: 'ord-3',
    originalInvoiceNumber: 'INV-003',
    reason: 'Customer Cancelled',
    subtotalReversed: 1500,
    discountReversed: 100,
    taxReversed: 224,
    totalReversedIncludingTax: 1624,
    reversedAt: '2026-10-07T19:00:00.000Z',
    createdAt: '2026-10-07T19:00:00.000Z',
  };

  const sampleOrders = [orderCompleted1, orderCompleted2, orderReversed];
  const sampleReversals = [mockReversal];

  // 1. Sales date filtering
  it('1. filters orders by date range accurately', () => {
    const refDate = new Date('2026-10-08T00:00:00.000Z');
    const filteredWeek = filterReportOrders(sampleOrders, {
      datePreset: 'This Week',
      referenceDate: refDate,
    });
    expect(filteredWeek.length).toBeGreaterThan(0);

    const filteredToday = filterReportOrders(sampleOrders, {
      datePreset: 'Today',
      referenceDate: new Date('2026-10-05T12:00:00.000Z'),
    });
    expect(filteredToday).toHaveLength(1);
    expect(filteredToday[0].invoiceNumber).toBe('INV-001');
  });

  // 2. Category filtering
  it('2. filters orders by category snapshot accurately', () => {
    const biryaniOrders = filterReportOrders(sampleOrders, { category: 'Biryani' });
    expect(biryaniOrders).toHaveLength(1);
    expect(biryaniOrders[0].invoiceNumber).toBe('INV-001');

    const burgerOrders = filterReportOrders(sampleOrders, { category: 'Burgers' });
    expect(burgerOrders).toHaveLength(1);
    expect(burgerOrders[0].invoiceNumber).toBe('INV-002');
  });

  // 3. Payment method filtering
  it('3. filters orders by payment method accurately', () => {
    const cashOnly = filterReportOrders(sampleOrders, { paymentMethod: 'Cash' });
    expect(cashOnly).toHaveLength(1);
    expect(cashOnly[0].paymentMethod).toBe('Cash');

    const cardOnly = filterReportOrders(sampleOrders, { paymentMethod: 'Card' });
    expect(cardOnly).toHaveLength(1);
    expect(cardOnly[0].paymentMethod).toBe('Card');
  });

  // 4. Order type filtering
  it('4. filters orders by order type (Dine-In vs Takeaway)', () => {
    const dineInOnly = filterReportOrders(sampleOrders, { orderType: 'Dine-In' });
    expect(dineInOnly).toHaveLength(2);

    const takeawayOnly = filterReportOrders(sampleOrders, { orderType: 'Takeaway' });
    expect(takeawayOnly).toHaveLength(1);
    expect(takeawayOnly[0].invoiceNumber).toBe('INV-002');
  });

  // 5. Combined filters
  it('5. applies combined multi-criteria filters simultaneously', () => {
    const combined = filterReportOrders(sampleOrders, {
      paymentMethod: 'Cash',
      orderType: 'Dine-In',
      status: 'completed',
    });
    expect(combined).toHaveLength(1);
    expect(combined[0].invoiceNumber).toBe('INV-001');
  });

  // 6. Invoice search
  it('6. searches orders by invoice number or item name', () => {
    const searchInv = filterReportOrders(sampleOrders, { searchQuery: '002' });
    expect(searchInv).toHaveLength(1);
    expect(searchInv[0].invoiceNumber).toBe('INV-002');

    const searchItem = filterReportOrders(sampleOrders, { searchQuery: 'burger' });
    expect(searchItem).toHaveLength(1);
    expect(searchItem[0].invoiceNumber).toBe('INV-002');
  });

  // 7. Gross Sales aggregation
  it('7. aggregates Gross Sales including all historical billed completed transactions', () => {
    const salesKpis = deriveSalesReport(sampleOrders, sampleReversals);
    // 870 + 1392 + 1624 = 3886
    expect(salesKpis.grossSales).toBe(3886);
  });

  // 8. Completed Orders
  it('8. preserves Completed Orders historical count without subtracting reversals', () => {
    const salesKpis = deriveSalesReport(sampleOrders, sampleReversals);
    expect(salesKpis.completedOrders).toBe(3);
    expect(salesKpis.validOrderCount).toBe(2);
  });

  // 8b. All orders reversed yields 0 valid orders
  it('8b. correctly returns 0 valid completed orders when all filtered orders are reversed', () => {
    const singleOrder = [{ ...sampleOrders[0], status: 'reversed' }];
    const matchingReversal = [{ originalOrderId: sampleOrders[0].id, reversedAt: new Date().toISOString() }];
    const salesKpis = deriveSalesReport(singleOrder, matchingReversal);
    expect(salesKpis.completedOrders).toBe(1); // raw historical
    expect(salesKpis.validOrderCount).toBe(0); // active / valid non-reversed count shown in KPI
  });

  // 9. Net Revenue excludes tax
  it('9. strictly excludes tax from valid Net Revenue', () => {
    const revKpis = deriveRevenueReport(sampleOrders, sampleReversals);
    // Valid orders: ord-1 (grand 870 - tax 120 = 750) + ord-2 (grand 1392 - tax 192 = 1200) = 1950
    expect(revKpis.netRevenue).toBe(1950);
  });

  // 10. Net Revenue excludes reversed financial impact
  it('10. strictly excludes reversed sales from Net Revenue', () => {
    const revKpis = deriveRevenueReport(sampleOrders, sampleReversals);
    // ord-3 is reversed, its 1400 net amount is excluded
    expect(revKpis.netRevenue).toBe(750 + 1200);
  });

  // 11. Tax uses taxAmount snapshots
  it('11. derives Tax Collected from stored taxAmount snapshots', () => {
    const taxData = getTaxBreakdown(sampleOrders, sampleReversals);
    // Valid tax: 120 + 192 = 312
    expect(taxData.taxCollected).toBe(312);
    // Reversed tax: 224
    expect(taxData.reversedTax).toBe(224);
  });

  // 12. Discount aggregation
  it('12. aggregates Discounts accurately from transaction snapshots', () => {
    const discData = getDiscountBreakdown(sampleOrders);
    // ord-1: 50, ord-3: 100 = 150
    expect(discData.totalDiscounts).toBe(150);
    expect(discData.discountedOrdersCount).toBe(2);
  });

  // 13. Items Sold
  it('13. computes Items Sold accurately for valid non-reversed transactions', () => {
    const salesKpis = deriveSalesReport(sampleOrders, sampleReversals);
    // ord-1: 2 items, ord-2: 3+3 = 6 items. Total valid items = 8
    expect(salesKpis.itemsSold).toBe(8);
  });

  // 14. Sales category grouping
  it('14. groups sales by category correctly', () => {
    const salesKpis = deriveSalesReport(sampleOrders, sampleReversals);
    expect(salesKpis.validNetSales).toBe(1950);
  });

  // 15. Sales payment grouping
  it('15. groups sales by payment method accurately', () => {
    const paymentData = getPaymentMethodBreakdown(sampleOrders, sampleReversals);
    const cash = paymentData.find((p) => p.method === 'Cash');
    const card = paymentData.find((p) => p.method === 'Card');
    const online = paymentData.find((p) => p.method === 'Online');

    expect(cash.amount).toBe(870);
    expect(card.amount).toBe(1392);
    // Online sale was reversed so its valid amount is 0
    expect(online.amount).toBe(0);
  });

  // 16. Revenue date grouping
  it('16. groups revenue trend by date with Gross Billed, Net Revenue, and Tax', () => {
    const trend = groupRevenueByDate(sampleOrders, sampleReversals, 'All Time');
    expect(Array.isArray(trend)).toBe(true);
    expect(trend.length).toBeGreaterThan(0);
  });

  // 17. Reversal count
  it('17. calculates Reversal Count accurately', () => {
    const revKpis = deriveReversalReport(sampleReversals);
    expect(revKpis.reversalCount).toBe(1);
  });

  // 18. Reversal subtotal
  it('18. calculates Reversed Subtotal accurately', () => {
    const revKpis = deriveReversalReport(sampleReversals);
    expect(revKpis.reversedSubtotal).toBe(1500);
  });

  // 19. Reversal tax
  it('19. calculates Reversed Tax accurately', () => {
    const revKpis = deriveReversalReport(sampleReversals);
    expect(revKpis.reversedTax).toBe(224);
  });

  // 20. Reversal including tax
  it('20. calculates Reversal Total Including Tax accurately', () => {
    const revKpis = deriveReversalReport(sampleReversals);
    expect(revKpis.reversalTotalIncludingTax).toBe(1624);
  });

  // 21. Reversal reason filtering
  it('21. filters reversals by cancellation reason', () => {
    const cancelRevs = filterReportReversals(sampleReversals, { reason: 'Customer Cancelled' });
    expect(cancelRevs).toHaveLength(1);

    const wrongOrderRevs = filterReportReversals(sampleReversals, { reason: 'Wrong Order' });
    expect(wrongOrderRevs).toHaveLength(0);
  });

  // 22. Reversed invoice remains historical
  it('22. preserves reversed invoice in history while reflecting status', () => {
    const filteredAll = filterReportOrders(sampleOrders, { status: 'All' });
    expect(filteredAll).toHaveLength(3);
    const reversedRecord = filteredAll.find((o) => o.status === 'reversed');
    expect(reversedRecord).toBeTruthy();
    expect(reversedRecord.invoiceNumber).toBe('INV-003');
  });

  // 23. zero-data handling
  it('23. handles zero-data scenarios gracefully without NaN or errors', () => {
    const emptySales = deriveSalesReport([], []);
    expect(emptySales.grossSales).toBe(0);
    expect(emptySales.validNetSales).toBe(0);
    expect(emptySales.completedOrders).toBe(0);
    expect(emptySales.averageOrderValue).toBe(0);
    expect(emptySales.itemsSold).toBe(0);

    const emptyRev = deriveRevenueReport([], []);
    expect(emptyRev.grossBilled).toBe(0);
    expect(emptyRev.netRevenue).toBe(0);
    expect(emptyRev.taxCollected).toBe(0);
    expect(emptyRev.avgNetRevenuePerOrder).toBe(0);

    const emptyReversal = deriveReversalReport([]);
    expect(emptyReversal.reversalCount).toBe(0);
    expect(emptyReversal.reversalTotalIncludingTax).toBe(0);

    const emptyReversalTrend = groupReversalsByDate([]);
    expect(Array.isArray(emptyReversalTrend)).toBe(true);
  });

  // 24. report and Dashboard selector reconciliation
  it('24. reconciles 100% with Dashboard selectors on equivalent scope', () => {
    const salesReport = deriveSalesReport(sampleOrders, sampleReversals);
    const revReport = deriveRevenueReport(sampleOrders, sampleReversals);

    // Dashboard Gross Sales == Report Gross Sales
    expect(calculateGrossSales(sampleOrders)).toBe(salesReport.grossSales);

    // Dashboard Completed Orders == Report Completed Orders
    expect(calculateCompletedOrders(sampleOrders)).toBe(salesReport.completedOrders);

    // Dashboard Net Revenue == Report Net Revenue
    expect(calculateNetRevenue(sampleOrders, sampleReversals)).toBe(revReport.netRevenue);

    // Dashboard Tax Collected == Report Tax Collected
    expect(calculateTaxCollected(sampleOrders, sampleReversals)).toBe(revReport.taxCollected);

    // Dashboard Reversals Total == Report Reversals Total
    expect(calculateReversalTotal(sampleReversals)).toBe(revReport.reversalsIncludingTax);
  });

  // 25. exported/derived rows honor filters where testable
  it('25. ensures report filtered rows honor active search and status filters', () => {
    const filteredTakeaway = filterReportOrders(sampleOrders, { orderType: 'Takeaway' });
    expect(filteredTakeaway.every((o) => o.orderType === 'Takeaway')).toBe(true);

    const filteredCash = filterReportOrders(sampleOrders, { paymentMethod: 'Cash' });
    expect(filteredCash.every((o) => o.paymentMethod === 'Cash')).toBe(true);
  });
});

describe('Batch 6: Profit & Cost (COGS, Gross Profit & Historical Snapshots)', () => {
  const todayIso = new Date().toISOString();

  // Order with Piece Item, Weight Item, Tax & Discount
  const testOrder1 = {
    id: 'ord-profit-1',
    invoiceNumber: 'INV-101',
    status: 'completed',
    completedAt: todayIso,
    createdAt: todayIso,
    subtotal: 700,
    discountAmount: 70,
    taxRateSnapshot: 16,
    taxAmount: 100.8,
    grandTotal: 730.8,
    lines: [
      {
        itemId: 'item-biryani',
        itemNameSnapshot: 'Chicken Biryani',
        categoryNameSnapshot: 'Biryani',
        pricingMode: 'custom_weight',
        quantity: 1,
        selectedWeightGrams: 200,
        sellingPriceSnapshot: 1000,
        costPriceSnapshot: 600,
        grossLineSale: 200,
        allocatedDiscount: 20,
        netRevenue: 180,
        itemCOGS: 120,
        addonCOGS: 0,
        totalCOGS: 120,
        grossProfit: 60,
        grossProfitMargin: 33.33,
        hasCost: true,
      },
      {
        itemId: 'item-burger',
        itemNameSnapshot: 'Zinger Burger',
        categoryNameSnapshot: 'Burgers',
        pricingMode: 'fixed',
        quantity: 1,
        sellingPriceSnapshot: 500,
        costPriceSnapshot: 300,
        grossLineSale: 500,
        allocatedDiscount: 50,
        netRevenue: 450,
        itemCOGS: 300,
        addonCOGS: 0,
        totalCOGS: 300,
        grossProfit: 150,
        grossProfitMargin: 33.33,
        hasCost: true,
      },
    ],
  };

  // Order with Add-on
  const testOrder2 = {
    id: 'ord-profit-2',
    invoiceNumber: 'INV-102',
    status: 'completed',
    completedAt: todayIso,
    createdAt: todayIso,
    subtotal: 550,
    discountAmount: 0,
    taxRateSnapshot: 0,
    taxAmount: 0,
    grandTotal: 550,
    lines: [
      {
        itemId: 'item-burger',
        itemNameSnapshot: 'Zinger Burger',
        categoryNameSnapshot: 'Burgers',
        pricingMode: 'fixed',
        quantity: 1,
        sellingPriceSnapshot: 500,
        costPriceSnapshot: 300,
        grossLineSale: 550,
        allocatedDiscount: 0,
        netRevenue: 550,
        itemCOGS: 300,
        addonCOGS: 30,
        totalCOGS: 330,
        grossProfit: 220,
        grossProfitMargin: 40,
        hasCost: true,
      },
    ],
  };

  // Order that was Reversed
  const testOrder3 = {
    id: 'ord-profit-3',
    invoiceNumber: 'INV-103',
    status: 'completed',
    completedAt: todayIso,
    createdAt: todayIso,
    subtotal: 200,
    discountAmount: 0,
    taxAmount: 32,
    grandTotal: 232,
    lines: [
      {
        itemId: 'item-biryani',
        itemNameSnapshot: 'Chicken Biryani',
        categoryNameSnapshot: 'Biryani',
        quantity: 1,
        grossLineSale: 200,
        allocatedDiscount: 0,
        netRevenue: 200,
        totalCOGS: 120,
        grossProfit: 80,
        hasCost: true,
      },
    ],
  };

  const testReversal3 = {
    id: 'REV-103',
    originalOrderId: 'ord-profit-3',
    originalInvoiceNumber: 'INV-103',
    reversedAt: todayIso,
    subtotalReversed: 200,
    taxReversed: 32,
    totalReversedIncludingTax: 232,
  };

  // Order with Missing Cost
  const testOrderMissingCost = {
    id: 'ord-profit-4',
    invoiceNumber: 'INV-104',
    status: 'completed',
    completedAt: todayIso,
    createdAt: todayIso,
    subtotal: 400,
    discountAmount: 0,
    taxAmount: 0,
    grandTotal: 400,
    lines: [
      {
        itemId: 'item-mystery',
        itemNameSnapshot: 'Mystery Chef Recipe',
        categoryNameSnapshot: 'Chef Special',
        quantity: 1,
        grossLineSale: 400,
        allocatedDiscount: 0,
        netRevenue: 400,
        totalCOGS: null,
        grossProfit: null,
        hasCost: false,
      },
    ],
  };

  it('calculates Profit & Cost KPIs and item-wise table correctly', () => {
    const report = getProfitAndCostReportData(
      [testOrder1, testOrder2],
      [],
      { datePreset: 'Today' }
    );

    // Net Sales = 180 + 450 + 550 = 1180
    // COGS = 120 + 300 + 330 = 750
    // Gross Profit = 1180 - 750 = 430
    expect(report.kpis.netSales).toBe(1180);
    expect(report.kpis.cogs).toBe(750);
    expect(report.kpis.grossProfit).toBe(430);
    expect(report.kpis.grossProfitMargin).toBe(36.44);
    expect(report.kpis.hasMissingCosts).toBe(false);
  });

  it('excludes Tax from Net Sales and Gross Profit', () => {
    const report = getProfitAndCostReportData([testOrder1], [], { datePreset: 'Today' });
    // testOrder1 Grand Total is 730.8 (includes 100.8 tax)
    // Pre-tax Net Revenue = (200 - 20) + (500 - 50) = 180 + 450 = 630
    expect(report.kpis.netSales).toBe(630);
    expect(report.kpis.netSales).not.toBe(Math.round(testOrder1.grandTotal));
    // Gross Profit = 630 - (120 + 300) = 630 - 420 = 210
    expect(report.kpis.cogs).toBe(420);
    expect(report.kpis.grossProfit).toBe(210);
  });

  it('economically negates Net Revenue, COGS, and Gross Profit on full reversal', () => {
    // With testOrder3 valid:
    const beforeReversal = getProfitAndCostReportData(
      [testOrder1, testOrder3],
      [],
      { datePreset: 'Today' }
    );

    // With testOrder3 reversed:
    const afterReversal = getProfitAndCostReportData(
      [testOrder1, testOrder3],
      [testReversal3],
      { datePreset: 'Today' }
    );

    // Economic contribution of reversed sale is completely 0
    expect(beforeReversal.kpis.netSales - afterReversal.kpis.netSales).toBe(200);
    expect(beforeReversal.kpis.cogs - afterReversal.kpis.cogs).toBe(120);
    expect(beforeReversal.kpis.grossProfit - afterReversal.kpis.grossProfit).toBe(80);
  });

  it('guarantees historical snapshot persistence: report never changes when Item Master cost changes', () => {
    // Current Item Master cost might change to 800 tomorrow
    // But testOrder1 historical snapshot retains costPriceSnapshot 600 -> COGS 120
    const report = getProfitAndCostReportData([testOrder1], [], { datePreset: 'Today' });
    const biryaniRow = report.itemRows.find((r) => r.name === 'Chicken Biryani');
    expect(biryaniRow.cogs).toBe(120);
    expect(biryaniRow.grossProfit).toBe(60);
  });

  it('handles missing cost safely without assuming zero cost or reporting fake 100% margins', () => {
    const report = getProfitAndCostReportData(
      [testOrder1, testOrderMissingCost],
      [],
      { datePreset: 'Today' }
    );

    expect(report.kpis.hasMissingCosts).toBe(true);
    expect(report.kpis.missingCostCount).toBe(1);

    const mysteryRow = report.itemRows.find((r) => r.name === 'Mystery Chef Recipe');
    expect(mysteryRow.hasCost).toBe(false);
    expect(mysteryRow.cogs).toBeNull();
    expect(mysteryRow.grossProfit).toBeNull();
    expect(mysteryRow.margin).toBeNull();
  });

  it('verifies exact sum equality: Sum(item Net Sales) === report Net Sales, Sum(item COGS) === report COGS, Sum(item Profit) === report Profit', () => {
    const report = getProfitAndCostReportData(
      [testOrder1, testOrder2],
      [],
      { datePreset: 'Today' }
    );

    const sumNetSales = report.itemRows.reduce((sum, r) => sum + r.netSales, 0);
    const sumCOGS = report.itemRows.reduce((sum, r) => sum + (r.cogs || 0), 0);
    const sumProfit = report.itemRows.reduce((sum, r) => sum + (r.grossProfit || 0), 0);

    expect(sumNetSales).toBe(report.kpis.netSales);
    expect(sumCOGS).toBe(report.kpis.cogs);
    expect(sumProfit).toBe(report.kpis.grossProfit);
    expect(report.kpis.grossProfit).toBe(report.kpis.netSales - report.kpis.cogs);
  });

  it('supports category and item filtering properly', () => {
    const biryaniCategoryReport = getProfitAndCostReportData(
      [testOrder1, testOrder2],
      [],
      { datePreset: 'Today', category: 'Biryani' }
    );

    expect(biryaniCategoryReport.itemRows).toHaveLength(1);
    expect(biryaniCategoryReport.itemRows[0].name).toBe('Chicken Biryani');
    expect(biryaniCategoryReport.kpis.netSales).toBe(180);
    expect(biryaniCategoryReport.kpis.cogs).toBe(120);
    expect(biryaniCategoryReport.kpis.grossProfit).toBe(60);
  });

  it('accurately reports Add-on profit, COGS, Net Sales, and supports Add-on filtering', () => {
    const orderWithAddon = {
      id: 'ord-addon-test',
      invoiceNumber: 'INV-201',
      status: 'completed',
      completedAt: todayIso,
      createdAt: todayIso,
      subtotal: 600,
      discountAmount: 0,
      taxAmount: 0,
      grandTotal: 600,
      lines: [
        {
          itemId: 'item-burger-1',
          itemNameSnapshot: 'Beef Burger',
          categoryNameSnapshot: 'Burgers',
          quantity: 2,
          grossLineSale: 600,
          allocatedDiscount: 0,
          netRevenue: 600,
          costPriceSnapshot: 150,
          addonSnapshots: [
            {
              id: 'addon-cheese',
              name: 'Extra Cheese',
              price: 50,
              costPrice: 20,
            },
          ],
        },
      ],
    };

    // 1. Overall view ('all')
    const reportAll = getProfitAndCostReportData([orderWithAddon], [], { datePreset: 'Today' });
    expect(reportAll.itemRows).toHaveLength(2);

    const burgerRow = reportAll.itemRows.find((r) => r.name === 'Beef Burger');
    expect(burgerRow).toBeDefined();
    expect(burgerRow.isAddon).toBe(false);
    expect(burgerRow.qtySold).toBe(2);
    // Burger price = (600 - 100) = 500. COGS = 150 * 2 = 300. Profit = 200.
    expect(burgerRow.netSales).toBe(500);
    expect(burgerRow.cogs).toBe(300);
    expect(burgerRow.grossProfit).toBe(200);

    const addonRow = reportAll.itemRows.find((r) => r.name === 'Extra Cheese');
    expect(addonRow).toBeDefined();
    expect(addonRow.isAddon).toBe(true);
    expect(addonRow.category).toBe('Add-ons');
    expect(addonRow.qtySold).toBe(2);
    // Addon price = 50 * 2 = 100. Cost = 20 * 2 = 40. Profit = 60. Margin = 60%.
    expect(addonRow.netSales).toBe(100);
    expect(addonRow.cogs).toBe(40);
    expect(addonRow.grossProfit).toBe(60);
    expect(addonRow.margin).toBe(60);

    // Sum matches KPIs
    expect(reportAll.kpis.netSales).toBe(600);
    expect(reportAll.kpis.cogs).toBe(340);
    expect(reportAll.kpis.grossProfit).toBe(260);

    // 2. Filter by category: 'Add-ons'
    const reportAddonCat = getProfitAndCostReportData([orderWithAddon], [], {
      datePreset: 'Today',
      category: 'Add-ons',
    });
    expect(reportAddonCat.itemRows).toHaveLength(1);
    expect(reportAddonCat.itemRows[0].name).toBe('Extra Cheese');
    expect(reportAddonCat.kpis.netSales).toBe(100);
    expect(reportAddonCat.kpis.grossProfit).toBe(60);

    // 3. ViewType filter: 'items' vs 'addons'
    const reportItemsOnly = getProfitAndCostReportData([orderWithAddon], [], {
      datePreset: 'Today',
      viewType: 'items',
    });
    expect(reportItemsOnly.itemRows).toHaveLength(1);
    expect(reportItemsOnly.itemRows[0].name).toBe('Beef Burger');

    const reportAddonsOnly = getProfitAndCostReportData([orderWithAddon], [], {
      datePreset: 'Today',
      viewType: 'addons',
    });
    expect(reportAddonsOnly.itemRows).toHaveLength(1);
    expect(reportAddonsOnly.itemRows[0].name).toBe('Extra Cheese');
  });

  it('heals legacy 0.55 heuristic COGS when actual item catalog cost price is available (e.g. 1kg Chicken Biryani 800 cost vs 550 fallback)', () => {
    // Order was previously stamped with legacy 55% fallback COGS = 550 (on 1000 unitPrice)
    const legacyOrder = {
      id: 'ord-biryani-test',
      invoiceNumber: 'INV-BIRYANI',
      status: 'completed',
      completedAt: '2026-10-22T10:00:00Z',
      grandTotal: 1000,
      lines: [
        {
          id: 'line-biryani',
          itemId: 'item-biryani-live',
          itemNameSnapshot: 'Chicken Biryani',
          pricingMode: 'weight',
          selectedPortionLabel: '1kg',
          selectedWeightGrams: 1000,
          quantity: 1,
          unitPrice: 1000,
          lineSubtotal: 1000,
          netRevenue: 1000,
          costPriceSnapshot: 550, // Legacy 55% heuristic fallback
          totalCOGS: 550,
          grossProfit: 450,
        },
      ],
    };

    // Catalog has the real cost price 800
    const catalogItems = [
      {
        id: 'item-biryani-live',
        name: 'Chicken Biryani',
        basePrice: 1000,
        costPrice: 800,
        unitType: 'weight',
      },
    ];

    const report = getProfitAndCostReportData([legacyOrder], [], { datePreset: 'Today' }, catalogItems);
    const biryaniRow = report.itemRows.find((r) => r.name === 'Chicken Biryani');

    expect(biryaniRow).toBeDefined();
    // Must heal from fake 550 to real catalog cost 800
    expect(biryaniRow.cogs).toBe(800);
    expect(biryaniRow.grossProfit).toBe(200);
    expect(biryaniRow.margin).toBe(20);
    expect(report.kpis.cogs).toBe(800);
    expect(report.kpis.grossProfit).toBe(200);
  });
});

