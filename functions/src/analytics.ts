import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { getFirestore, Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

const requestSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const pageSize = 500;
const paidPaymentStatuses = new Set(["paid", "captured", "succeeded", "refunded", "partially_refunded"]);
const cancelledStatuses = new Set(["cancelled", "canceled"]);
const completedStatuses = new Set(["complete", "completed", "delivered"]);
const pendingStatuses = new Set(["pending", "processing", "awaiting_payment"]);
const ga4Client = new BetaAnalyticsDataClient();

interface MoneyByCurrency {
  currency: string;
  amountMinor: number;
}

interface OrderMetrics {
  orders: number;
  completedOrders: number;
  pendingOrders: number;
  cancelledOrders: number;
  paidOrders: number;
  unverifiedOrders: number;
  grossByCurrency: Map<string, number>;
  netByCurrency: Map<string, number>;
  refundsByCurrency: Map<string, number>;
  discountsByCurrency: Map<string, number>;
  paidOrderCountsByCurrency: Map<string, number>;
  salesByDay: Map<string, {
    orders: number;
    revenueByCurrency: Map<string, number>;
    grossByCurrency: Map<string, number>;
    refundsByCurrency: Map<string, number>;
  }>;
  salesByCategory: Map<string, { units: number; revenueByCurrency: Map<string, number> }>;
  salesByProduct: Map<string, { name: string; units: number; revenueByCurrency: Map<string, number> }>;
  salesByPaymentMethod: Map<string, { orders: number; revenueByCurrency: Map<string, number> }>;
  couponUsage: Map<string, { orders: number; discountByCurrency: Map<string, number>; revenueByCurrency: Map<string, number> }>;
  buyers: Map<string, number>;
  buyerSpendByCurrency: Map<string, Map<string, number>>;
  salesByCountry: Map<string, { orders: number; revenueByCurrency: Map<string, number> }>;
}

function isMinorAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDateRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const inclusiveEnd = new Date(`${endDate}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(inclusiveEnd.getTime()) ||
    dateOnly(start) !== startDate ||
    dateOnly(inclusiveEnd) !== endDate ||
    inclusiveEnd < start
  ) {
    throw new HttpsError("invalid-argument", "Choose a valid date range.");
  }

  const days = Math.floor((inclusiveEnd.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > 366) {
    throw new HttpsError("invalid-argument", "Analytics date ranges cannot exceed 366 days.");
  }

  const endExclusive = new Date(inclusiveEnd.getTime() + 86_400_000);
  const previousEndExclusive = start;
  const previousStart = new Date(start.getTime() - days * 86_400_000);

  return {
    start,
    endExclusive,
    previousStart,
    previousEndExclusive,
    days,
  };
}

function createOrderMetrics(): OrderMetrics {
  return {
    orders: 0,
    completedOrders: 0,
    pendingOrders: 0,
    cancelledOrders: 0,
    paidOrders: 0,
    unverifiedOrders: 0,
    grossByCurrency: new Map(),
    netByCurrency: new Map(),
    refundsByCurrency: new Map(),
    discountsByCurrency: new Map(),
    paidOrderCountsByCurrency: new Map(),
    salesByDay: new Map(),
    salesByCategory: new Map(),
    salesByProduct: new Map(),
    salesByPaymentMethod: new Map(),
    couponUsage: new Map(),
    buyers: new Map(),
    buyerSpendByCurrency: new Map(),
    salesByCountry: new Map(),
  };
}

function addAmount(target: Map<string, number>, currency: string, amount: number): void {
  target.set(currency, (target.get(currency) ?? 0) + amount);
}

function moneyEntries(values: Map<string, number>): MoneyByCurrency[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountMinor]) => ({ currency, amountMinor }));
}

async function loadOrders(
  start: Date,
  endExclusive: Date,
  metrics: OrderMetrics,
): Promise<void> {
  const db = getFirestore();
  let page = db
    .collection("orders")
    .where("createdAt", ">=", Timestamp.fromDate(start))
    .where("createdAt", "<", Timestamp.fromDate(endExclusive))
    .orderBy("createdAt", "asc")
    .limit(pageSize);
  const seenPaymentIds = new Set<string>();

  for (;;) {
    const snapshot = await page.get();
    if (snapshot.empty) {
      return;
    }

    for (const order of snapshot.docs) {
      accumulateOrder(order, metrics, seenPaymentIds);
    }

    if (snapshot.size < pageSize) {
      return;
    }
    page = page.startAfter(snapshot.docs[snapshot.docs.length - 1]);
  }
}

function accumulateOrder(
  order: QueryDocumentSnapshot,
  metrics: OrderMetrics,
  seenPaymentIds: Set<string>,
): void {
  const data = order.data();
  const status = typeof data.status === "string" ? data.status.toLowerCase() : "";
  const currency =
    typeof data.currency === "string" && /^[A-Z]{3}$/.test(data.currency)
      ? data.currency
      : null;
  const paymentId =
    typeof data.paymentIntentId === "string" && data.paymentIntentId.length > 0
      ? data.paymentIntentId
      : order.id;

  if (seenPaymentIds.has(paymentId)) {
    return;
  }
  seenPaymentIds.add(paymentId);
  metrics.orders += 1;

  if (completedStatuses.has(status)) metrics.completedOrders += 1;
  if (pendingStatuses.has(status)) metrics.pendingOrders += 1;
  if (cancelledStatuses.has(status)) metrics.cancelledOrders += 1;
  if (cancelledStatuses.has(status)) return;

  const paymentStatus =
    typeof data.paymentStatus === "string" ? data.paymentStatus.toLowerCase() : "";
  const verifiedPaid =
    currency !== null &&
    paidPaymentStatuses.has(paymentStatus) &&
    isMinorAmount(data.totalMinor);

  if (!verifiedPaid) {
    metrics.unverifiedOrders += 1;
    return;
  }

  metrics.paidOrders += 1;
  addAmount(metrics.paidOrderCountsByCurrency, currency, 1);
  const totalMinor = data.totalMinor as number;
  const grossMinor = isMinorAmount(data.subtotalMinor) ? data.subtotalMinor : totalMinor;
  const refundMinor = isMinorAmount(data.refundAmountMinor) ? data.refundAmountMinor : 0;
  const netMinor = Math.max(0, totalMinor - refundMinor);
  addAmount(metrics.grossByCurrency, currency, grossMinor);
  addAmount(metrics.netByCurrency, currency, netMinor);
  addAmount(metrics.refundsByCurrency, currency, refundMinor);

  if (isMinorAmount(data.discountMinor)) {
    addAmount(metrics.discountsByCurrency, currency, data.discountMinor);
  }

  const createdAt = data.createdAt as Timestamp;
  const day = dateOnly(createdAt.toDate());
  const dayMetrics = metrics.salesByDay.get(day) ?? {
    orders: 0,
    revenueByCurrency: new Map<string, number>(),
    grossByCurrency: new Map<string, number>(),
    refundsByCurrency: new Map<string, number>(),
  };
  dayMetrics.orders += 1;
  addAmount(dayMetrics.revenueByCurrency, currency, netMinor);
  addAmount(dayMetrics.grossByCurrency, currency, grossMinor);
  addAmount(dayMetrics.refundsByCurrency, currency, refundMinor);
  metrics.salesByDay.set(day, dayMetrics);

  const userId = typeof data.userId === "string" ? data.userId : null;
  if (userId) {
    metrics.buyers.set(userId, (metrics.buyers.get(userId) ?? 0) + 1);
    const spend = metrics.buyerSpendByCurrency.get(userId) ?? new Map<string, number>();
    addAmount(spend, currency, netMinor);
    metrics.buyerSpendByCurrency.set(userId, spend);
  }

  const shippingAddress =
    data.shippingAddress && typeof data.shippingAddress === "object"
      ? data.shippingAddress as Record<string, unknown>
      : null;
  const countryCode =
    typeof shippingAddress?.countryCode === "string" && /^[A-Z]{2}$/.test(shippingAddress.countryCode)
      ? shippingAddress.countryCode
      : typeof data.countryCode === "string" && /^[A-Z]{2}$/.test(data.countryCode)
        ? data.countryCode
        : null;
  if (countryCode) {
    const country = metrics.salesByCountry.get(countryCode) ?? {
      orders: 0,
      revenueByCurrency: new Map<string, number>(),
    };
    country.orders += 1;
    addAmount(country.revenueByCurrency, currency, netMinor);
    metrics.salesByCountry.set(countryCode, country);
  }

  const items = Array.isArray(data.items) ? data.items : [];
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    const quantity = isMinorAmount(item.quantity) ? item.quantity : 0;
    const lineAmount = isMinorAmount(item.lineTotalMinor)
      ? item.lineTotalMinor
      : isMinorAmount(item.unitPriceMinor)
        ? item.unitPriceMinor * quantity
        : 0;
    if (quantity === 0 || !Number.isSafeInteger(lineAmount)) continue;

    const category =
      typeof item.categoryName === "string" && item.categoryName.trim()
        ? item.categoryName.trim()
        : "Uncategorized";
    const categoryMetrics = metrics.salesByCategory.get(category) ?? {
      units: 0,
      revenueByCurrency: new Map<string, number>(),
    };
    categoryMetrics.units += quantity;
    addAmount(categoryMetrics.revenueByCurrency, currency, lineAmount);
    metrics.salesByCategory.set(category, categoryMetrics);

    const productId = typeof item.productId === "string" ? item.productId : "unknown";
    const name =
      typeof item.productName === "string" && item.productName.trim()
        ? item.productName.trim()
        : productId;
    const productMetrics = metrics.salesByProduct.get(productId) ?? {
      name,
      units: 0,
      revenueByCurrency: new Map<string, number>(),
    };
    productMetrics.units += quantity;
    addAmount(productMetrics.revenueByCurrency, currency, lineAmount);
    metrics.salesByProduct.set(productId, productMetrics);
  }

  const paymentMethod =
    typeof data.paymentMethod === "string" && data.paymentMethod.trim()
      ? data.paymentMethod.trim()
      : "Unspecified";
  const methodMetrics = metrics.salesByPaymentMethod.get(paymentMethod) ?? {
    orders: 0,
    revenueByCurrency: new Map<string, number>(),
  };
  methodMetrics.orders += 1;
  addAmount(methodMetrics.revenueByCurrency, currency, netMinor);
  metrics.salesByPaymentMethod.set(paymentMethod, methodMetrics);

  const couponCode =
    typeof data.couponCode === "string" ? data.couponCode.trim().toUpperCase() : "";
  if (couponCode) {
    const couponMetrics = metrics.couponUsage.get(couponCode) ?? {
      orders: 0,
      discountByCurrency: new Map<string, number>(),
      revenueByCurrency: new Map<string, number>(),
    };
    couponMetrics.orders += 1;
    addAmount(couponMetrics.discountByCurrency, currency, isMinorAmount(data.discountMinor) ? data.discountMinor : 0);
    addAmount(couponMetrics.revenueByCurrency, currency, netMinor);
    metrics.couponUsage.set(couponCode, couponMetrics);
  }
}

async function loadInventory(salesByProduct: OrderMetrics["salesByProduct"]) {
  const db = getFirestore();
  let page = db.collection("products").orderBy("__name__").limit(pageSize);
  let totalProducts = 0;
  let totalVariants = 0;
  let availableStock = 0;
  let lowStockProducts = 0;
  let outOfStockProducts = 0;
  let invalidStockRecords = 0;
  const inventoryValueByCurrency = new Map<string, number>();
  const stockAlerts: Array<{ id: string; name: string; stock: number }> = [];
  const slowMovingCandidates: Array<{ id: string; name: string; stock: number; soldUnits: number }> = [];

  for (;;) {
    const snapshot = await page.get();
    for (const product of snapshot.docs) {
      const data = product.data();
      totalProducts += 1;
      if (!isMinorAmount(data.stock)) {
        invalidStockRecords += 1;
        continue;
      }
      const stock = data.stock;
      availableStock += stock;
      if (stock === 0) outOfStockProducts += 1;
      else if (stock <= 5) lowStockProducts += 1;
      if (stock <= 5 && stockAlerts.length < 20) {
        stockAlerts.push({
          id: product.id,
          name: typeof data.name === "string" ? data.name : product.id,
          stock,
        });
      }
      if (stock > 0 && data.status === "published") {
        slowMovingCandidates.push({
          id: product.id,
          name: typeof data.name === "string" ? data.name : product.id,
          stock,
          soldUnits: salesByProduct.get(product.id)?.units ?? 0,
        });
      }

      if (Array.isArray(data.variants)) totalVariants += data.variants.length;
      if (
        stock > 0 &&
        isMinorAmount(data.priceMinor) &&
        typeof data.currency === "string" &&
        /^[A-Z]{3}$/.test(data.currency)
      ) {
        const inventoryValue = stock * data.priceMinor;
        if (Number.isSafeInteger(inventoryValue)) {
          addAmount(inventoryValueByCurrency, data.currency, inventoryValue);
        }
      }
    }

    if (snapshot.size < pageSize) break;
    page = page.startAfter(snapshot.docs[snapshot.docs.length - 1]);
  }

  return {
    totalProducts,
    totalVariants,
    availableStock,
    lowStockProducts,
    outOfStockProducts,
    invalidStockRecords,
    stockAlerts,
    slowMovingProducts: slowMovingCandidates
      .sort((left, right) => left.soldUnits - right.soldUnits || left.name.localeCompare(right.name))
      .slice(0, 10),
    inventoryValueByCurrency: moneyEntries(inventoryValueByCurrency),
  };
}

async function loadCustomerCounts(
  start: Date,
  endExclusive: Date,
  previousStart: Date,
  previousEndExclusive: Date,
) {
  const users = getFirestore().collection("users");
  const [total, newCustomers, previousNewCustomers] = await Promise.all([
    users.count().get(),
    users
      .where("createdAt", ">=", Timestamp.fromDate(start))
      .where("createdAt", "<", Timestamp.fromDate(endExclusive))
      .count()
      .get(),
    users
      .where("createdAt", ">=", Timestamp.fromDate(previousStart))
      .where("createdAt", "<", Timestamp.fromDate(previousEndExclusive))
      .count()
      .get(),
  ]);
  return {
    totalCustomers: total.data().count,
    newCustomers: newCustomers.data().count,
    previousNewCustomers: previousNewCustomers.data().count,
  };
}

async function loadNewsletterCounts(start: Date, endExclusive: Date) {
  const subscribers = getFirestore()
    .collection("newsletterSubscribers")
    .where("status", "==", "subscribed");
  const [total, newSubscriptions] = await Promise.all([
    subscribers.count().get(),
    subscribers
      .where("createdAt", ">=", Timestamp.fromDate(start))
      .where("createdAt", "<", Timestamp.fromDate(endExclusive))
      .count()
      .get(),
  ]);
  return {
    totalSubscribers: total.data().count,
    newSubscriptions: newSubscriptions.data().count,
  };
}

interface Ga4MetricResponse {
  rows?: Array<{
    metricValues?: Array<{ value?: string | null } | null> | null;
  } | null> | null;
}

function gaMetricValue(response: Ga4MetricResponse, index: number): number {
  const parsed = Number(response.rows?.[0]?.metricValues?.[index]?.value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadGa4(startDate: string, endDate: string) {
  const configuredPropertyId = process.env.GA4_PROPERTY_ID?.trim();
  if (!configuredPropertyId) {
    return {
      configured: false,
      available: false,
      error: "Set GA4_PROPERTY_ID and grant the Functions service account Viewer access to the GA4 property.",
    };
  }

  const property = configuredPropertyId.startsWith("properties/")
    ? configuredPropertyId
    : `properties/${configuredPropertyId}`;

  try {
    const [overview, events, sources, devices, landingPages, products] = await Promise.all([
      ga4Client.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }, { name: "sessions" }],
      }),
      ga4Client.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        limit: 100,
      }),
      ga4Client.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      ga4Client.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      ga4Client.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "landingPagePlusQueryString" }],
        metrics: [{ name: "sessions" }, { name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      ga4Client.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "itemId" }, { name: "itemName" }],
        metrics: [
          { name: "itemsViewed" },
          { name: "itemsAddedToCart" },
          { name: "itemsPurchased" },
          { name: "itemRevenue" },
        ],
        limit: 50,
      }),
    ]);

    const eventCounts = new Map(
      (events[0].rows ?? []).map((row) => [
        row.dimensionValues?.[0]?.value ?? "unknown",
        Number(row.metricValues?.[0]?.value ?? 0),
      ]),
    );
    const rows = (result: typeof sources) => (result[0].rows ?? []).map((row) => ({
      name: row.dimensionValues?.[0]?.value ?? "(not set)",
      sessions: Number(row.metricValues?.[0]?.value ?? 0),
      secondary: Number(row.metricValues?.[1]?.value ?? 0),
    }));

    return {
      configured: true,
      available: true,
      overview: {
        pageViews: gaMetricValue(overview[0], 0),
        uniqueVisitors: gaMetricValue(overview[0], 1),
        sessions: gaMetricValue(overview[0], 2),
      },
      funnelEvents: {
        productViews: eventCounts.get("view_item") ?? 0,
        addToCart: eventCounts.get("add_to_cart") ?? 0,
        checkoutInitiated: eventCounts.get("begin_checkout") ?? 0,
        purchases: eventCounts.get("purchase") ?? 0,
        searches: eventCounts.get("search") ?? 0,
      },
      sources: rows(sources).map(({ name, sessions, secondary }) => ({
        source: name,
        sessions,
        users: secondary,
      })),
      devices: rows(devices).map(({ name, sessions, secondary }) => ({
        category: name,
        sessions,
        users: secondary,
      })),
      landingPages: rows(landingPages).map(({ name, sessions, secondary }) => ({
        page: name,
        sessions,
        pageViews: secondary,
      })),
      products: (products[0].rows ?? []).map((row) => ({
        id: row.dimensionValues?.[0]?.value ?? "",
        name: row.dimensionValues?.[1]?.value ?? "(not set)",
        views: Number(row.metricValues?.[0]?.value ?? 0),
        addedToCart: Number(row.metricValues?.[1]?.value ?? 0),
        purchases: Number(row.metricValues?.[2]?.value ?? 0),
        revenue: Number(row.metricValues?.[3]?.value ?? 0),
      })),
      note: "GA4 event counts describe website activity and are not confirmed sales records.",
    };
  } catch (error) {
    return {
      configured: true,
      available: false,
      error: error instanceof Error ? error.message : "The GA4 Data API request failed.",
    };
  }
}

function serializeOrderMetrics(metrics: OrderMetrics) {
  const buyersWithMultipleOrders = [...metrics.buyers.values()].filter((count) => count > 1).length;
  const buyerCountByCurrency = new Map<string, number>();
  const buyerSpendByCurrency = new Map<string, number>();
  for (const spend of metrics.buyerSpendByCurrency.values()) {
    for (const [currency, amount] of spend.entries()) {
      addAmount(buyerSpendByCurrency, currency, amount);
      addAmount(buyerCountByCurrency, currency, 1);
    }
  }
  return {
    orders: metrics.orders,
    completedOrders: metrics.completedOrders,
    pendingOrders: metrics.pendingOrders,
    cancelledOrders: metrics.cancelledOrders,
    paidOrders: metrics.paidOrders,
    unverifiedOrders: metrics.unverifiedOrders,
    grossByCurrency: moneyEntries(metrics.grossByCurrency),
    netByCurrency: moneyEntries(metrics.netByCurrency),
    refundsByCurrency: moneyEntries(metrics.refundsByCurrency),
    discountsByCurrency: moneyEntries(metrics.discountsByCurrency),
    paidOrderCountsByCurrency: [...metrics.paidOrderCountsByCurrency.entries()].map(
      ([currency, count]) => ({ currency, count }),
    ),
    repeatBuyersInPeriod: buyersWithMultipleOrders,
    averageCustomerSpendByCurrency: [...buyerSpendByCurrency.entries()].map(([currency, total]) => ({
      currency,
      customers: buyerCountByCurrency.get(currency) ?? 0,
      amountMinor: Math.round(total / (buyerCountByCurrency.get(currency) ?? 1)),
    })),
    salesByDay: [...metrics.salesByDay.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => ({
        date,
        orders: value.orders,
        revenueByCurrency: moneyEntries(value.revenueByCurrency),
        grossByCurrency: moneyEntries(value.grossByCurrency),
        refundsByCurrency: moneyEntries(value.refundsByCurrency),
      })),
    salesByCategory: [...metrics.salesByCategory.entries()].map(([name, value]) => ({
      name,
      units: value.units,
      revenueByCurrency: moneyEntries(value.revenueByCurrency),
    })),
    salesByProduct: [...metrics.salesByProduct.entries()].map(([id, value]) => ({
      id,
      name: value.name,
      units: value.units,
      revenueByCurrency: moneyEntries(value.revenueByCurrency),
    })),
    salesByPaymentMethod: [...metrics.salesByPaymentMethod.entries()].map(([name, value]) => ({
      name,
      orders: value.orders,
      revenueByCurrency: moneyEntries(value.revenueByCurrency),
    })),
    couponUsage: [...metrics.couponUsage.entries()].map(([code, value]) => ({
      code,
      orders: value.orders,
      discountsByCurrency: moneyEntries(value.discountByCurrency),
      revenueByCurrency: moneyEntries(value.revenueByCurrency),
    })),
    salesByCountry: [...metrics.salesByCountry.entries()]
      .sort(([, left], [, right]) => right.orders - left.orders)
      .map(([countryCode, value]) => ({
        countryCode,
        orders: value.orders,
        revenueByCurrency: moneyEntries(value.revenueByCurrency),
      })),
  };
}

export const getAnalyticsReport = onCall(
  {
    enforceAppCheck: true,
    maxInstances: 5,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    const claims = request.auth?.token;
    const canViewAnalytics =
      claims?.admin === true ||
      (claims?.staff === true && Array.isArray(claims.perms) && claims.perms.includes("analytics"));
    if (!canViewAnalytics) {
      throw new HttpsError("permission-denied", "Administrator access is required.");
    }

    const parsed = requestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", "Choose a valid analytics date range.");
    }

    const range = parseDateRange(parsed.data.startDate, parsed.data.endDate);
    const current = createOrderMetrics();
    const previous = createOrderMetrics();
    const [customers, newsletter, ga4] = await Promise.all([
      loadCustomerCounts(
        range.start,
        range.endExclusive,
        range.previousStart,
        range.previousEndExclusive,
      ),
      loadNewsletterCounts(range.start, range.endExclusive),
      loadGa4(parsed.data.startDate, parsed.data.endDate),
    ]);
    await Promise.all([
      loadOrders(range.start, range.endExclusive, current),
      loadOrders(range.previousStart, range.previousEndExclusive, previous),
    ]);
    const inventory = await loadInventory(current.salesByProduct);

    return {
      period: { startDate: parsed.data.startDate, endDate: parsed.data.endDate, days: range.days },
      previousPeriod: {
        startDate: dateOnly(range.previousStart),
        endDate: dateOnly(new Date(range.previousEndExclusive.getTime() - 1)),
      },
      current: serializeOrderMetrics(current),
      previous: serializeOrderMetrics(previous),
      customers: {
        ...customers,
        repeatBuyersInPeriod: [...current.buyers.values()].filter((count) => count > 1).length,
      },
      marketing: newsletter,
      inventory,
      dataSources: {
        business: "firestore",
        traffic: "ga4",
      },
      ga4,
    };
  },
);
