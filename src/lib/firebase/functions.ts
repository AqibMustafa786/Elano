"use client";

import { getFunctions, httpsCallable } from "firebase/functions";

import { getFirebaseAppCheck } from "./app-check";
import { getFirebaseServices } from "./client";

interface NewsletterRequest {
  email: string;
}

interface NewsletterResponse {
  success: boolean;
}

export interface AnalyticsRangeRequest {
  startDate: string;
  endDate: string;
}

export interface AnalyticsMoney {
  currency: string;
  amountMinor: number;
}

export interface AnalyticsOrders {
  orders: number;
  completedOrders: number;
  pendingOrders: number;
  cancelledOrders: number;
  paidOrders: number;
  unverifiedOrders: number;
  grossByCurrency: AnalyticsMoney[];
  netByCurrency: AnalyticsMoney[];
  refundsByCurrency: AnalyticsMoney[];
  discountsByCurrency: AnalyticsMoney[];
  paidOrderCountsByCurrency: Array<{ currency: string; count: number }>;
  repeatBuyersInPeriod: number;
  averageCustomerSpendByCurrency: Array<{
    currency: string;
    customers: number;
    amountMinor: number;
  }>;
  salesByDay: Array<{
    date: string;
    orders: number;
    revenueByCurrency: AnalyticsMoney[];
    grossByCurrency: AnalyticsMoney[];
    refundsByCurrency: AnalyticsMoney[];
  }>;
  salesByCategory: Array<{
    name: string;
    units: number;
    revenueByCurrency: AnalyticsMoney[];
  }>;
  salesByProduct: Array<{
    id: string;
    name: string;
    units: number;
    revenueByCurrency: AnalyticsMoney[];
  }>;
  salesByPaymentMethod: Array<{
    name: string;
    orders: number;
    revenueByCurrency: AnalyticsMoney[];
  }>;
  couponUsage: Array<{
    code: string;
    orders: number;
    discountsByCurrency: AnalyticsMoney[];
    revenueByCurrency: AnalyticsMoney[];
  }>;
  salesByCountry: Array<{
    countryCode: string;
    orders: number;
    revenueByCurrency: AnalyticsMoney[];
  }>;
}

export interface AnalyticsReport {
  period: { startDate: string; endDate: string; days: number };
  previousPeriod: { startDate: string; endDate: string };
  current: AnalyticsOrders;
  previous: AnalyticsOrders;
  customers: {
    totalCustomers: number;
    newCustomers: number;
    previousNewCustomers: number;
    repeatBuyersInPeriod: number;
  };
  marketing: {
    totalSubscribers: number;
    newSubscriptions: number;
  };
  inventory: {
    totalProducts: number;
    totalVariants: number;
    availableStock: number;
    lowStockProducts: number;
    outOfStockProducts: number;
    invalidStockRecords: number;
    stockAlerts: Array<{ id: string; name: string; stock: number }>;
    slowMovingProducts: Array<{ id: string; name: string; stock: number; soldUnits: number }>;
    inventoryValueByCurrency: AnalyticsMoney[];
  };
  dataSources: {
    business: "firestore";
    traffic: "ga4";
  };
  ga4: {
    configured: boolean;
    available: boolean;
    error?: string;
    overview?: {
      pageViews: number;
      uniqueVisitors: number;
      sessions: number;
    };
    funnelEvents?: {
      productViews: number;
      addToCart: number;
      checkoutInitiated: number;
      purchases: number;
      searches: number;
    };
    sources?: Array<{ source: string; sessions: number; users: number }>;
    devices?: Array<{ category: string; sessions: number; users: number }>;
    landingPages?: Array<{ page: string; sessions: number; pageViews: number }>;
    products?: Array<{
      id: string;
      name: string;
      views: number;
      addedToCart: number;
      purchases: number;
      revenue: number;
    }>;
    note?: string;
  };
}

export async function subscribeToNewsletter(email: string): Promise<void> {
  getFirebaseAppCheck();

  const { app } = getFirebaseServices();
  const functions = getFunctions(app, "asia-south1");
  const subscribe = httpsCallable<NewsletterRequest, NewsletterResponse>(
    functions,
    "subscribeToNewsletter",
  );
  const response = await subscribe({ email });

  if (!response.data.success) {
    throw new Error("Newsletter subscription was not completed.");
  }
}

export async function fetchAnalyticsReport(
  range: AnalyticsRangeRequest,
): Promise<AnalyticsReport> {
  getFirebaseAppCheck();

  const { app } = getFirebaseServices();
  const functions = getFunctions(app, "asia-south1");
  const getReport = httpsCallable<AnalyticsRangeRequest, AnalyticsReport>(
    functions,
    "getAnalyticsReport",
  );
  const response = await getReport(range);
  return response.data;
}

/* ---------- Team / roles (Super Admin only, enforced on the server) ---------- */

export interface StaffMember {
  uid: string;
  email: string;
  displayName: string;
  permissions: string[];
  disabled: boolean;
  createdAt: string | null;
}

function callable<Request, Response>(name: string) {
  const { app } = getFirebaseServices();
  return httpsCallable<Request, Response>(getFunctions(app, "asia-south1"), name);
}

export async function activateSuperAdmin(): Promise<void> {
  await callable<Record<string, never>, { success: boolean }>("claimSuperAdmin")({});
}

export async function fetchStaff(): Promise<StaffMember[]> {
  const response = await callable<Record<string, never>, { staff: StaffMember[] }>("listStaff")({});
  return response.data.staff;
}

export async function createStaffMember(input: {
  name: string;
  email: string;
  password?: string;
  permissions: string[];
}): Promise<void> {
  await callable<typeof input, { success: boolean }>("createStaff")(input);
}

export async function updateStaffMember(input: {
  uid: string;
  permissions?: string[];
  disabled?: boolean;
}): Promise<void> {
  await callable<typeof input, { success: boolean }>("updateStaff")(input);
}

export async function removeStaffMember(uid: string): Promise<void> {
  await callable<{ uid: string }, { success: boolean }>("removeStaff")({ uid });
}
