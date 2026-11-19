"use client";

import { FirebaseError } from "firebase/app";
import {
  getIdTokenResult,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Download,
  Package,
  RefreshCw,
  ShoppingBag,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getFirebaseServices } from "@/lib/firebase/client";
import {
  fetchAnalyticsReport,
  type AnalyticsMoney,
  type AnalyticsOrders,
  type AnalyticsReport,
} from "@/lib/firebase/functions";
import { accessFromClaims, can } from "@/lib/permissions";

type Access = "checking" | "signed-out" | "not-admin" | "admin";
type Preset =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "90d"
  | "this-month"
  | "previous-month"
  | "this-year"
  | "custom";
type SalesGrouping = "daily" | "weekly" | "monthly" | "yearly";
type SalesMetric = "net" | "gross" | "refunds";

const chartColors = ["#17243b", "#9a8060", "#637d78", "#bf8e67", "#8c7188", "#9ca36b"];

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function getRangeForPreset(preset: Exclude<Preset, "custom">): { startDate: string; endDate: string } {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (preset === "today") return { startDate: isoDate(todayUtc), endDate: isoDate(todayUtc) };
  if (preset === "yesterday") {
    const yesterday = shiftDays(todayUtc, -1);
    return { startDate: isoDate(yesterday), endDate: isoDate(yesterday) };
  }
  if (preset === "this-month") {
    const start = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 1));
    return { startDate: isoDate(start), endDate: isoDate(todayUtc) };
  }
  if (preset === "previous-month") {
    const start = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 0));
    return { startDate: isoDate(start), endDate: isoDate(end) };
  }
  if (preset === "this-year") {
    const start = new Date(Date.UTC(todayUtc.getUTCFullYear(), 0, 1));
    return { startDate: isoDate(start), endDate: isoDate(todayUtc) };
  }
  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  return { startDate: isoDate(shiftDays(todayUtc, -(days - 1))), endDate: isoDate(todayUtc) };
}

function amountForCurrency(values: AnalyticsMoney[], currency: string): number {
  return values.find((value) => value.currency === currency)?.amountMinor ?? 0;
}

function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

function formatKnownMoney(amountMinor: number, currency: string, known: boolean): string {
  return known ? formatMoney(amountMinor, currency) : "—";
}

function errorText(error: unknown): string {
  if (error instanceof FirebaseError && error.code === "functions/permission-denied") {
    return "This account does not have analytics administrator access.";
  }
  return error instanceof Error ? error.message : "The analytics report could not be loaded.";
}

function countChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function percentLabel(value: number | null): string {
  if (value === null) return "No previous-period baseline";
  if (value === 0) return "No change";
  return `${Math.abs(value).toFixed(1)}% vs previous period`;
}

function currencyCount(values: Array<{ currency: string; count: number }>, currency: string): number {
  return values.find((value) => value.currency === currency)?.count ?? 0;
}

function getSalesChartData(
  orders: AnalyticsOrders,
  currency: string,
  grouping: SalesGrouping,
  metric: SalesMetric,
  startDate: string,
  endDate: string,
) {
  const grouped = new Map<string, { revenue: number; orders: number }>();
  const dailyMetrics = new Map(orders.salesByDay.map((day) => [day.date, day]));
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const dateKey = isoDate(date);
    const day = dailyMetrics.get(dateKey);
    let label = dateKey;
    if (grouping === "weekly") {
      const weekStart = new Date(date);
      weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
      label = `Week of ${isoDate(weekStart)}`;
    } else if (grouping === "monthly") {
      label = dateKey.slice(0, 7);
    } else if (grouping === "yearly") {
      label = dateKey.slice(0, 4);
    }

    const aggregate = grouped.get(label) ?? { revenue: 0, orders: 0 };
    if (day) {
      const values =
        metric === "gross"
          ? day.grossByCurrency
          : metric === "refunds"
            ? day.refundsByCurrency
            : day.revenueByCurrency;
      aggregate.revenue += amountForCurrency(values, currency) / 100;
      aggregate.orders += day.orders;
    }
    grouped.set(label, aggregate);
  }
  return [...grouped.entries()].map(([date, value]) => ({ date, ...value }));
}

function safeCsvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export default function AdminAnalyticsPage() {
  const [access, setAccess] = useState<Access>("checking");
  const [user, setUser] = useState<User | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const initialRange = useRef<{ startDate: string; endDate: string } | null>(null);
  const [preset, setPreset] = useState<Preset>("30d");
  const [salesGrouping, setSalesGrouping] = useState<SalesGrouping>("daily");
  const [salesMetric, setSalesMetric] = useState<SalesMetric>("net");
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState("USD");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const range = getRangeForPreset("30d");
    initialRange.current = range;
    queueMicrotask(() => {
      setStartDate(range.startDate);
      setEndDate(range.endDate);
    });
  }, []);

  const loadReport = useCallback(async (range: { startDate: string; endDate: string }) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchAnalyticsReport(range);
      setReport(data);
      setLastUpdated(new Date());
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseServices();
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setAccess("signed-out");
        return;
      }

      setAccess("checking");
      try {
        const token = await getIdTokenResult(currentUser, true);
        const isAdmin = can(accessFromClaims(token.claims), "analytics");
        setAccess(isAdmin ? "admin" : "not-admin");
        if (isAdmin) {
          void loadReport(initialRange.current ?? getRangeForPreset("30d"));
        }
      } catch (authError) {
        setError(errorText(authError));
        setAccess("signed-out");
      }
    });

    return unsubscribe;
  }, [loadReport]);

  const currencies = report
    ? [...new Set([
        ...report.current.grossByCurrency.map((value) => value.currency),
        ...report.current.netByCurrency.map((value) => value.currency),
        ...report.inventory.inventoryValueByCurrency.map((value) => value.currency),
      ])].sort()
    : [];
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0] ?? "";
  const currencyKnown = currencies.includes(currency);

  const revenueChart = report
    ? getSalesChartData(
        report.current,
        currency,
        salesGrouping,
        salesMetric,
        report.period.startDate,
        report.period.endDate,
      )
    : [];
  const categoryChart = report?.current.salesByCategory
      .map((item) => ({
        name: item.name,
        units: item.units,
        revenue: amountForCurrency(item.revenueByCurrency, currency) / 100,
      }))
      .filter((item) => item.units > 0) ?? [];
  const productRows = report?.current.salesByProduct
      .map((item) => ({
        ...item,
        revenueMinor: amountForCurrency(item.revenueByCurrency, currency),
      }))
      .sort((left, right) => right.revenueMinor - left.revenueMinor) ?? [];

  const applyPreset = (nextPreset: Preset) => {
    setPreset(nextPreset);
    if (nextPreset === "custom") return;
    const range = getRangeForPreset(nextPreset);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    if (access === "admin") void loadReport(range);
  };

  const exportCsv = () => {
    if (!report) return;
    const rows = [
      ["date", "orders", `net_revenue_${currency}`],
      ...report.current.salesByDay.map((day) => [
        day.date,
        day.orders,
        (amountForCurrency(day.revenueByCurrency, currency) / 100).toFixed(2),
      ]),
    ];
    const csv = rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `elano-analytics-${startDate}-to-${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (access === "checking") {
    return <main className="flex min-h-screen items-center justify-center bg-[#f3efe8] text-sm text-[#615b56]">Checking administrator access…</main>;
  }

  if (access !== "admin") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3efe8] px-4">
        <section className="max-w-md rounded-3xl border border-[#e5dacd] bg-[#fbf8f5] p-8">
          <h1 className="font-display text-3xl">Administrator access required</h1>
          <p className="mt-3 text-sm leading-6 text-[#615b56]">
            {access === "signed-out" ? "Sign in with an authorized admin account to view store analytics." : `${user?.email ?? "This account"} does not have the Super Admin claim.`}
          </p>
          <Link href="/admin" className="mt-5 inline-flex rounded-full bg-[#17243b] px-5 py-3 text-sm text-white">Go to admin sign in</Link>
        </section>
      </main>
    );
  }

  const gross = amountForCurrency(report?.current.grossByCurrency ?? [], currency);
  const net = amountForCurrency(report?.current.netByCurrency ?? [], currency);
  const refunds = amountForCurrency(report?.current.refundsByCurrency ?? [], currency);
  const previousGross = amountForCurrency(report?.previous.grossByCurrency ?? [], currency);
  const previousNet = amountForCurrency(report?.previous.netByCurrency ?? [], currency);
  const currentPaidCount = currencyCount(report?.current.paidOrderCountsByCurrency ?? [], currency);
  const previousPaidCount = currencyCount(report?.previous.paidOrderCountsByCurrency ?? [], currency);
  const averageOrderValue = currentPaidCount ? net / currentPaidCount : 0;
  const previousAverageOrderValue = previousPaidCount ? previousNet / previousPaidCount : 0;
  const averageCustomerSpend =
    report?.current.averageCustomerSpendByCurrency.find((value) => value.currency === currency)?.amountMinor ?? 0;
  const purchaseEventRate =
    report?.ga4.available && report.ga4.overview?.sessions
      ? ((report.ga4.funnelEvents?.purchases ?? 0) / report.ga4.overview.sessions) * 100
      : null;

  const kpis = [
    { label: "Gross revenue", value: formatKnownMoney(gross, currency, currencyKnown), change: countChange(gross, previousGross), icon: Activity },
    { label: "Net revenue", value: formatKnownMoney(net, currency, currencyKnown), change: countChange(net, previousNet), icon: ArrowDownRight },
    { label: "Orders", value: (report?.current.orders ?? 0).toLocaleString(), change: countChange(report?.current.orders ?? 0, report?.previous.orders ?? 0), icon: ShoppingBag },
    { label: "Completed", value: (report?.current.completedOrders ?? 0).toLocaleString(), change: countChange(report?.current.completedOrders ?? 0, report?.previous.completedOrders ?? 0), icon: ArrowUpRight },
    { label: "Pending", value: (report?.current.pendingOrders ?? 0).toLocaleString(), change: countChange(report?.current.pendingOrders ?? 0, report?.previous.pendingOrders ?? 0), icon: RefreshCw },
    { label: "Cancelled", value: (report?.current.cancelledOrders ?? 0).toLocaleString(), change: countChange(report?.current.cancelledOrders ?? 0, report?.previous.cancelledOrders ?? 0), icon: Package },
    { label: "Customers", value: (report?.customers.totalCustomers ?? 0).toLocaleString(), change: null, icon: Users },
    { label: "New customers", value: (report?.customers.newCustomers ?? 0).toLocaleString(), change: countChange(report?.customers.newCustomers ?? 0, report?.customers.previousNewCustomers ?? 0), icon: Users },
    { label: "Repeat buyers", value: (report?.customers.repeatBuyersInPeriod ?? 0).toLocaleString(), change: countChange(report?.customers.repeatBuyersInPeriod ?? 0, report?.previous.repeatBuyersInPeriod ?? 0), icon: Users, note: "2+ paid orders within period" },
    { label: "Newsletter subscribers", value: (report?.marketing.totalSubscribers ?? 0).toLocaleString(), change: null, icon: Users, note: `${(report?.marketing.newSubscriptions ?? 0).toLocaleString()} new in period` },
    { label: "Average order value", value: formatKnownMoney(averageOrderValue, currency, currencyKnown), change: countChange(averageOrderValue, previousAverageOrderValue), icon: Activity },
    { label: "Avg. customer spend", value: formatKnownMoney(averageCustomerSpend, currency, currencyKnown), change: null, icon: Users, note: "Paid buyers in selected period" },
    { label: "GA4 purchase event rate", value: purchaseEventRate === null ? "Unavailable" : `${purchaseEventRate.toFixed(2)}%`, change: null, icon: Activity, note: "GA4 purchase events ÷ sessions" },
    { label: "Refunds", value: formatKnownMoney(refunds, currency, currencyKnown), change: countChange(refunds, amountForCurrency(report?.previous.refundsByCurrency ?? [], currency)), icon: RefreshCw },
  ];

  return (
    <main className="min-h-screen bg-[#f3efe8] px-4 py-8 text-[#171717] sm:px-8 print:bg-white print:px-0 print:py-0">
      <div className="mx-auto max-w-[1440px]">
        <header className="flex flex-col gap-5 border-b border-[#e5dacd] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/admin" className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[#615b56] hover:text-[#17243b]">
              <ArrowLeft size={15} /> Store overview
            </Link>
            <p className="mt-5 text-xs uppercase tracking-[0.18em] text-[#9a8060]">ÉLANO · Store intelligence</p>
            <h1 className="mt-2 font-display text-5xl tracking-[-0.05em]">Analytics</h1>
            <p className="mt-2 text-sm text-[#615b56]">Signed in as {user?.email}</p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button type="button" onClick={exportCsv} disabled={!report} className="inline-flex h-11 items-center gap-2 rounded-full border border-[#d8c9b9] px-4 text-sm disabled:opacity-50"><Download size={15} /> Export CSV</button>
            <button type="button" onClick={() => window.print()} className="h-11 rounded-full border border-[#d8c9b9] px-4 text-sm">Print</button>
            <button type="button" onClick={() => void loadReport({ startDate, endDate })} disabled={isLoading} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#17243b] px-5 text-sm text-white disabled:opacity-60">
              <RefreshCw size={15} className={isLoading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </header>

        <section className="mt-6 flex flex-col gap-4 rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-4 sm:flex-row sm:items-end sm:justify-between print:hidden">
          <div className="flex flex-wrap gap-2">
            {([
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["7d", "Last 7 days"],
              ["30d", "Last 30 days"],
              ["90d", "Last 90 days"],
              ["this-month", "This month"],
              ["previous-month", "Previous month"],
              ["this-year", "This year"],
              ["custom", "Custom"],
            ] as Array<[Preset, string]>).map(([value, label]) => (
              <button key={value} type="button" onClick={() => applyPreset(value)} className={`rounded-full px-3 py-2 text-xs font-medium transition ${preset === value ? "bg-[#17243b] text-white" : "border border-[#e5dacd] bg-white text-[#615b56] hover:border-[#c5b29f]"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium uppercase tracking-[0.1em] text-[#746d68]">
              From
              <input type="date" value={startDate} max={endDate} onChange={(event) => { setPreset("custom"); setStartDate(event.target.value); }} className="mt-1 block h-10 rounded-lg border border-[#d8c9b9] bg-white px-3 text-sm normal-case tracking-normal text-[#171717]" />
            </label>
            <label className="text-xs font-medium uppercase tracking-[0.1em] text-[#746d68]">
              To
              <input type="date" value={endDate} min={startDate} onChange={(event) => { setPreset("custom"); setEndDate(event.target.value); }} className="mt-1 block h-10 rounded-lg border border-[#d8c9b9] bg-white px-3 text-sm normal-case tracking-normal text-[#171717]" />
            </label>
            {currencies.length > 1 ? (
              <label className="text-xs font-medium uppercase tracking-[0.1em] text-[#746d68]">
                Currency
                <select value={currency} onChange={(event) => setSelectedCurrency(event.target.value)} className="mt-1 block h-10 rounded-lg border border-[#d8c9b9] bg-white px-3 text-sm normal-case tracking-normal text-[#171717]">
                  {currencies.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            ) : null}
            {preset === "custom" ? <button type="button" onClick={() => void loadReport({ startDate, endDate })} className="h-10 rounded-lg bg-[#17243b] px-4 text-sm text-white">Apply</button> : null}
          </div>
        </section>

        {error ? <div className="mt-5 rounded-xl border border-[#eed2cb] bg-[#fff5f2] px-4 py-3 text-sm text-[#8e3223]" role="alert">{error}</div> : null}
        {report?.current.unverifiedOrders ? (
          <div className="mt-5 rounded-xl border border-[#ead9ae] bg-[#fff9e8] px-4 py-3 text-sm text-[#765b1f]">
            {report.current.unverifiedOrders} order(s) have no verified paid-payment status and are excluded from revenue.
          </div>
        ) : null}

        {isLoading && !report ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl border border-[#e5dacd] bg-[#fbf8f5]" />)}
          </div>
        ) : report ? (
          <>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#81776f]">
              <p>Business metrics are calculated from Firestore orders. Currency totals are never combined.</p>
              <p>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ""} · comparison: {report.previousPeriod.startDate} – {report.previousPeriod.endDate}</p>
            </div>
            <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {kpis.map(({ label, value, change, icon: Icon, note }) => (
                <article key={label} className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
                  <div className="flex items-center justify-between text-[#81776f]">
                    <span className="text-xs font-medium uppercase tracking-[0.13em]">{label}</span>
                    <Icon size={17} />
                  </div>
                  <p className="mt-5 font-display text-3xl tracking-[-0.04em]">{value}</p>
                  {note ? <p className="mt-1 text-xs text-[#81776f]">{note}</p> : null}
                  {change !== null ? (
                    <p className={`mt-2 text-xs ${change < 0 ? "text-[#a33f2f]" : "text-[#315c41]"}`}>{percentLabel(change)}</p>
                  ) : !note ? <p className="mt-2 text-xs text-[#81776f]">No comparison available</p> : null}
                </article>
              ))}
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
              <article className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display text-2xl">Net revenue trend</h2>
                      <p className="mt-1 text-xs text-[#81776f]">
                        {salesMetric === "net" ? "Verified paid orders, less recorded refunds" : salesMetric === "gross" ? "Paid order subtotal before recorded refunds" : "Recorded refund amounts on verified paid orders"}
                      </p>
                  </div>
                    <div className="flex items-center gap-3">
                      <select value={salesMetric} onChange={(event) => setSalesMetric(event.target.value as SalesMetric)} aria-label="Revenue chart metric" className="h-9 rounded-lg border border-[#d8c9b9] bg-white px-2 text-xs">
                        <option value="net">Net sales</option>
                        <option value="gross">Gross sales</option>
                        <option value="refunds">Refunds</option>
                      </select>
                      <select value={salesGrouping} onChange={(event) => setSalesGrouping(event.target.value as SalesGrouping)} aria-label="Sales chart grouping" className="h-9 rounded-lg border border-[#d8c9b9] bg-white px-2 text-xs">
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                      <span className="text-xs uppercase tracking-[0.12em] text-[#81776f]">{currency}</span>
                    </div>
                </div>
                {revenueChart.length ? (
                  <div className="mt-5 h-[290px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={revenueChart} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                        <defs><linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#17243b" stopOpacity={0.28} /><stop offset="95%" stopColor="#17243b" stopOpacity={0.02} /></linearGradient></defs>
                        <CartesianGrid stroke="#e9dfd5" strokeDasharray="4 4" vertical={false} />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#81776f" }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#81776f" }} />
                        <Tooltip formatter={(value) => formatMoney(Number(value) * 100, currency)} />
                        <Area type="monotone" dataKey="revenue" name={salesMetric === "net" ? "Net revenue" : salesMetric === "gross" ? "Gross revenue" : "Refunds"} stroke="#17243b" strokeWidth={2.5} fill="url(#revenueFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState text="No verified paid orders in this period." />}
              </article>

              <article className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
                <h2 className="font-display text-2xl">Inventory health</h2>
                <p className="mt-1 text-xs text-[#81776f]">Current catalog stock, not period-limited</p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {[
                    ["Products", report.inventory.totalProducts],
                    ["Variants", report.inventory.totalVariants],
                    ["Available stock", report.inventory.availableStock],
                    ["Low stock", report.inventory.lowStockProducts],
                    ["Out of stock", report.inventory.outOfStockProducts],
                    ["Inventory value", formatKnownMoney(amountForCurrency(report.inventory.inventoryValueByCurrency, currency), currency, currencyKnown)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-[#f3efe8] p-4">
                      <p className="text-xs uppercase tracking-[0.1em] text-[#81776f]">{label}</p>
                      <p className="mt-2 text-xl font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
                {report.inventory.invalidStockRecords ? (
                  <p className="mt-3 text-xs text-[#8e3223]" role="status">
                    {report.inventory.invalidStockRecords} product record(s) have invalid stock values and are excluded from stock totals.
                  </p>
                ) : null}
                <h3 className="mt-5 text-sm font-semibold">Low and out-of-stock items</h3>
                <DataTable
                  headers={["Product", "Units left"]}
                  rows={report.inventory.stockAlerts.map((item) => [item.name, item.stock])}
                />
              </article>
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-2">
              <article className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
                <h2 className="font-display text-2xl">Sales by category</h2>
                {categoryChart.length ? (
                  <div className="mt-4 h-[270px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={categoryChart} margin={{ left: 0, right: 10, top: 8, bottom: 0 }}>
                        <CartesianGrid stroke="#e9dfd5" strokeDasharray="4 4" vertical={false} />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#81776f" }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#81776f" }} />
                        <Tooltip formatter={(value) => formatMoney(Number(value) * 100, currency)} />
                        <Bar dataKey="revenue" name="Revenue" radius={[6, 6, 0, 0]}>{categoryChart.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}</Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState text="Category sales will appear when paid orders include item details." />}
              </article>

              <article className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
                <h2 className="font-display text-2xl">Order status</h2>
                {report.current.orders ? (
                  <div className="mt-4 grid min-h-[260px] grid-cols-2 items-center gap-2">
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={[
                          { name: "Completed", value: report.current.completedOrders },
                          { name: "Pending", value: report.current.pendingOrders },
                          { name: "Cancelled", value: report.current.cancelledOrders },
                          { name: "Other", value: Math.max(0, report.current.orders - report.current.completedOrders - report.current.pendingOrders - report.current.cancelledOrders) },
                        ].filter((item) => item.value > 0)} dataKey="value" nameKey="name" innerRadius={62} outerRadius={96} paddingAngle={3}>
                          {[0, 1, 2, 3].map((index) => <Cell key={index} fill={chartColors[index]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-3 text-sm">
                      {[
                        ["Completed", report.current.completedOrders, chartColors[0]],
                        ["Pending", report.current.pendingOrders, chartColors[1]],
                        ["Cancelled", report.current.cancelledOrders, chartColors[2]],
                      ].map(([label, value, color]) => (
                        <p key={label} className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: String(color) }} />
                          <span>{label}</span><strong className="ml-auto">{value}</strong>
                        </p>
                      ))}
                    </div>
                  </div>
                ) : <EmptyState text="No orders recorded in this period." />}
              </article>
            </section>

            <section className="mt-5 rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
              <h2 className="font-display text-2xl">Best-selling products</h2>
              {productRows.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="border-b border-[#e5dacd] text-xs uppercase tracking-[0.1em] text-[#81776f]">
                      <tr><th className="py-3 pr-4">Product</th><th className="py-3 pr-4">Units</th><th className="py-3 text-right">Revenue ({currency})</th></tr>
                    </thead>
                    <tbody>
                      {productRows.slice(0, 10).map((product) => (
                        <tr key={product.id} className="border-b border-[#eee7df] last:border-0">
                          <td className="py-3 pr-4 font-medium">{product.name}</td>
                          <td className="py-3 pr-4">{product.units}</td>
                          <td className="py-3 text-right">{formatMoney(product.revenueMinor, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState text="Product sales will appear when paid orders include item details." />}
            </section>

            <section className="mt-5 rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
              <div className="flex items-start gap-3">
                <Activity size={18} className="mt-1 shrink-0 text-[#9a8060]" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-2xl">Traffic & conversion</h2>
                  {report.ga4.available && report.ga4.overview && report.ga4.funnelEvents ? (
                    <>
                      <p className="mt-1 text-xs text-[#81776f]">GA4 website activity. These events are not verified Firestore orders.</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        {[
                          ["Page views", report.ga4.overview.pageViews],
                          ["Unique visitors", report.ga4.overview.uniqueVisitors],
                          ["Sessions", report.ga4.overview.sessions],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-xl bg-[#f3efe8] p-4">
                            <p className="text-xs uppercase tracking-[0.1em] text-[#81776f]">{label}</p>
                            <p className="mt-2 font-display text-3xl">{Number(value).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 grid gap-5 xl:grid-cols-2">
                        <div>
                          <h3 className="text-sm font-semibold">Event funnel</h3>
                          <p className="mt-1 text-xs leading-5 text-[#81776f]">Visitor count is unique users; remaining values are GA4 event counts.</p>
                          <div className="mt-3 h-[250px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={[
                                { name: "Visitors", value: report.ga4.overview.uniqueVisitors },
                                { name: "Product views", value: report.ga4.funnelEvents.productViews },
                                { name: "Add to cart", value: report.ga4.funnelEvents.addToCart },
                                { name: "Checkout", value: report.ga4.funnelEvents.checkoutInitiated },
                                { name: "Purchase events", value: report.ga4.funnelEvents.purchases },
                              ]} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                                <CartesianGrid stroke="#e9dfd5" strokeDasharray="4 4" vertical={false} />
                                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#81776f" }} />
                                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#81776f" }} />
                                <Tooltip />
                                <Bar dataKey="value" name="Count" fill="#17243b" radius={[6, 6, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold">Traffic sources</h3>
                          <div className="mt-3 overflow-x-auto">
                            <table className="w-full min-w-[360px] text-left text-sm">
                              <thead className="border-b border-[#e5dacd] text-xs uppercase tracking-[0.1em] text-[#81776f]">
                                <tr><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Sessions</th><th className="py-2 text-right">Users</th></tr>
                              </thead>
                              <tbody>
                                {(report.ga4.sources ?? []).map((source) => (
                                  <tr key={source.source} className="border-b border-[#eee7df] last:border-0">
                                    <td className="max-w-[200px] truncate py-2 pr-3">{source.source}</td>
                                    <td className="py-2 pr-3">{source.sessions}</td>
                                    <td className="py-2 text-right">{source.users}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <p className="mt-4 text-xs text-[#81776f]">
                            GA4 purchase events: {report.ga4.funnelEvents.purchases.toLocaleString()} · Firestore paid orders: {report.current.paidOrders.toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-5 xl:grid-cols-2">
                        <div>
                          <h3 className="text-sm font-semibold">Device categories</h3>
                          <DataTable
                            headers={["Device", "Sessions", "Users"]}
                            rows={(report.ga4.devices ?? []).map((device) => [device.category, device.sessions, device.users])}
                          />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold">Top landing pages</h3>
                          <DataTable
                            headers={["Landing page", "Sessions", "Views"]}
                            rows={(report.ga4.landingPages ?? []).map((page) => [page.page, page.sessions, page.pageViews])}
                          />
                        </div>
                      </div>
                      {report.ga4.products?.length ? (
                        <div className="mt-5">
                          <h3 className="text-sm font-semibold">Product engagement (GA4)</h3>
                          <p className="mt-1 text-xs text-[#81776f]">Product conversion is GA4 items purchased divided by items viewed; it is not the site-wide checkout conversion rate.</p>
                          <DataTable
                            headers={["Product", "Views", "Added", "Purchased", "View-to-purchase"]}
                            rows={report.ga4.products.slice(0, 10).map((product) => [
                              product.name,
                              product.views,
                              product.addedToCart,
                              product.purchases,
                              product.views ? `${((product.purchases / product.views) * 100).toFixed(1)}%` : "—",
                            ])}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-2 rounded-xl border border-[#ead9ae] bg-[#fff9e8] px-4 py-3 text-sm leading-6 text-[#765b1f]">
                      {report.ga4.error ?? "GA4 is not configured. Traffic metrics are unavailable; no values are estimated."}
                    </p>
                  )}
                  {report.ga4.available ? (
                    <p className="mt-3 text-xs text-[#81776f]">GA4 purchase events are reported separately and may differ from verified paid Firestore orders.</p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-2">
              <article className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
                <h2 className="font-display text-2xl">Slow-moving inventory</h2>
                <p className="mt-1 text-xs text-[#81776f]">Published, in-stock items with the fewest recorded paid units in this period.</p>
                <DataTable
                  headers={["Product", "Units sold", "Stock"]}
                  rows={report.inventory.slowMovingProducts.map((item) => [item.name, item.soldUnits, item.stock])}
                />
              </article>
              <article className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
                <h2 className="font-display text-2xl">Orders by country</h2>
                <p className="mt-1 text-xs text-[#81776f]">Aggregated ISO country codes only; no address details are returned.</p>
                <DataTable
                  headers={["Country", "Paid orders", `Net revenue (${currency})`]}
                  rows={report.current.salesByCountry.map((item) => [
                    item.countryCode,
                    item.orders,
                    formatMoney(amountForCurrency(item.revenueByCurrency, currency), currency),
                  ])}
                />
              </article>
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-2">
              <article className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
                <h2 className="font-display text-2xl">Payment methods</h2>
                <DataTable
                  headers={["Method", "Paid orders", `Net revenue (${currency})`]}
                  rows={report.current.salesByPaymentMethod.map((item) => [
                    item.name,
                    item.orders,
                    formatMoney(amountForCurrency(item.revenueByCurrency, currency), currency),
                  ])}
                />
              </article>
              <article className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
                <h2 className="font-display text-2xl">Coupon performance</h2>
                <DataTable
                  headers={["Code", "Orders", `Discount (${currency})`, `Net revenue (${currency})`]}
                  rows={report.current.couponUsage.map((coupon) => [
                    coupon.code,
                    coupon.orders,
                    formatMoney(amountForCurrency(coupon.discountsByCurrency, currency), currency),
                    formatMoney(amountForCurrency(coupon.revenueByCurrency, currency), currency),
                  ])}
                />
              </article>
            </section>
          </>
        ) : null}

        <footer className="mt-8 border-t border-[#e5dacd] pt-5 text-xs leading-5 text-[#81776f]">
          Definitions: revenue includes only orders with a recognized paid payment status and excludes cancellations. Gross uses subtotal when present, otherwise total. Net uses total less recorded refund amount. Returning buyers here means 2+ paid orders within the selected period, not lifetime repeat rate. Freshness: on-demand Firestore report; refresh to retrieve current records.
        </footer>
      </div>
    </main>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex min-h-[230px] items-center justify-center px-6 text-center text-sm text-[#81776f]">{text}</div>;
}

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  if (!rows.length) return <p className="mt-4 text-sm text-[#81776f]">No records available for this period.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[360px] text-left text-sm">
        <thead className="border-b border-[#e5dacd] text-xs uppercase tracking-[0.1em] text-[#81776f]">
          <tr>{headers.map((header) => <th key={header} className="py-2 pr-3 last:text-right">{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${String(row[0])}-${index}`} className="border-b border-[#eee7df] last:border-0">
              {row.map((cell, cellIndex) => <td key={cellIndex} className={`py-2 pr-3 ${cellIndex === row.length - 1 ? "text-right" : ""}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
