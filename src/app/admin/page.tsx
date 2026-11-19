"use client";

import { FirebaseError } from "firebase/app";
import {
  getCountFromServer,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type DocumentData,
} from "firebase/firestore";
import {
  onAuthStateChanged,
  getIdTokenResult,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

import { getFirebaseAppCheck } from "@/lib/firebase/app-check";
import { getFirebaseServices } from "@/lib/firebase/client";
import { activateSuperAdmin } from "@/lib/firebase/functions";
import {
  accessFromClaims,
  can,
  isSuperAdmin,
  SUPER_ADMIN_EMAIL,
  type AdminAccess,
} from "@/lib/permissions";

type AccessState = "loading" | "signed-out" | "checking-claim" | "not-admin" | "admin";

interface DashboardStats {
  products: number;
  orders: number;
  customers: number;
  pendingOrders: number;
}

interface RecentOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalMinor: number;
  currency: string;
}

function getAuthErrorMessage(error: unknown): string {
  if (!(error instanceof FirebaseError)) {
    return error instanceof Error ? error.message : "The request could not be completed.";
  }

  if (error.code === "auth/invalid-credential") {
    return "The email or password is incorrect.";
  }
  if (error.code === "auth/too-many-requests") {
    return "Too many attempts. Please wait and try again.";
  }
  if (error.code === "auth/unauthorized-domain") {
    const hostname = typeof window === "undefined" ? "localhost" : window.location.hostname;
    return `This domain (${hostname}) is not authorized for Firebase sign-in. In Firebase Console → Authentication → Settings → Authorized domains, add ${hostname} without the port, or use a hostname that is already authorized.`;
  }
  if (error.code === "auth/network-request-failed") {
    return "Network error. Check your connection and try again.";
  }

  return error.message;
}

function formatCurrency(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

function toRecentOrder(id: string, data: DocumentData): RecentOrder {
  return {
    id,
    orderNumber: typeof data.orderNumber === "string" ? data.orderNumber : id,
    status: typeof data.status === "string" ? data.status : "pending",
    totalMinor: typeof data.totalMinor === "number" ? data.totalMinor : 0,
    currency: typeof data.currency === "string" ? data.currency : "USD",
  };
}

export default function AdminPage() {
  const [access, setAccess] = useState<AccessState>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [adminAccess, setAdminAccess] = useState<AdminAccess | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const { auth } = getFirebaseServices();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!active) {
        return;
      }

      setUser(currentUser);
      setAuthError(null);
      setNotice(null);

      if (!currentUser) {
        setAccess("signed-out");
        return;
      }

      setAccess("checking-claim");
      try {
        const token = await getIdTokenResult(currentUser, true);
        if (active) {
          const found = accessFromClaims(token.claims);
          setAdminAccess(found);
          setAccess(found ? "admin" : "not-admin");
        }
      } catch (error) {
        if (active) {
          setAuthError(getAuthErrorMessage(error));
          setAccess("signed-out");
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (access !== "admin") {
      return;
    }

    let active = true;
    const loadDashboard = async () => {
      setIsRefreshing(true);
      setDashboardError(null);

      try {
        getFirebaseAppCheck();
        const { db } = getFirebaseServices();
        const safe = async <T,>(task: () => Promise<T>, fallback: T): Promise<T> => {
          try {
            return await task();
          } catch {
            return fallback; // no permission for this section
          }
        };
        const countOf = (task: () => Promise<{ data: () => { count: number } }>) =>
          safe(async () => (await task()).data().count, 0);

        const [productCount, orderCount, customerCount, pendingOrderCount, ordersSnapshot] =
          await Promise.all([
            countOf(() => getCountFromServer(collection(db, "products"))),
            countOf(() => getCountFromServer(collection(db, "orders"))),
            countOf(() => getCountFromServer(collection(db, "users"))),
            countOf(() =>
              getCountFromServer(query(collection(db, "orders"), where("status", "==", "pending"))),
            ),
            safe<Awaited<ReturnType<typeof getDocs>> | null>(
              () => getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(6))),
              null,
            ),
          ]);

        if (!active) {
          return;
        }

        setStats({
          products: productCount,
          orders: orderCount,
          customers: customerCount,
          pendingOrders: pendingOrderCount,
        });
        setRecentOrders(
          (ordersSnapshot?.docs ?? []).map((snapshot) =>
            toRecentOrder(snapshot.id, snapshot.data()),
          ),
        );
      } catch (error) {
        if (active) {
          setDashboardError(getAuthErrorMessage(error));
        }
      } finally {
        if (active) {
          setIsRefreshing(false);
        }
      }
    };

    void loadDashboard();
    return () => {
      active = false;
    };
  }, [access]);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setAuthError(null);
    setNotice(null);

    try {
      const { auth } = getFirebaseServices();
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword("");
    } catch (error) {
      setAuthError(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email.trim()) {
      setAuthError("Enter your admin email address first.");
      return;
    }

    setAuthError(null);
    setNotice(null);
    try {
      const { auth } = getFirebaseServices();
      await sendPasswordResetEmail(auth, email.trim());
      setNotice("If the account exists, a password reset email has been sent.");
    } catch (error) {
      setAuthError(getAuthErrorMessage(error));
    }
  };

  const handleGoogleSignIn = async () => {
    setIsSubmitting(true);
    setAuthError(null);
    setNotice(null);

    try {
      const { auth } = getFirebaseServices();
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      setAuthError(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActivate = async () => {
    setIsActivating(true);
    setAuthError(null);
    try {
      await activateSuperAdmin();
      window.location.reload();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not activate Super Admin.");
    } finally {
      setIsActivating(false);
    }
  };

  const handleSignOut = async () => {
    setAuthError(null);
    try {
      const { auth } = getFirebaseServices();
      await signOut(auth);
    } catch (error) {
      setAuthError(getAuthErrorMessage(error));
    }
  };

  if (access === "loading" || access === "checking-claim") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3efe8] px-4">
        <p className="text-sm uppercase tracking-[0.16em] text-[#615b56]">
          {access === "loading" ? "Loading secure admin access…" : "Verifying admin role…"}
        </p>
      </main>
    );
  }

  if (access === "signed-out") {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#eee8df] px-4 py-8 sm:px-8 lg:py-12">
        <div className="pointer-events-none absolute -left-32 top-[-7rem] h-96 w-96 rounded-full border border-[#d8ccbd]/60" />
        <div className="pointer-events-none absolute -bottom-48 right-[-8rem] h-[32rem] w-[32rem] rounded-full border border-[#d8ccbd]/60" />

        <section className="relative grid w-full max-w-[1080px] overflow-hidden rounded-[28px] border border-[#e3d9ce] bg-[#fcfaf7] shadow-[0_28px_90px_rgba(37,31,24,0.12)] lg:min-h-[650px] lg:grid-cols-[0.92fr_1.08fr]">
          <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#17243b] p-10 text-white lg:flex xl:p-14">
            <div className="pointer-events-none absolute -right-36 top-24 h-[26rem] w-[26rem] rounded-full border border-white/10" />
            <div className="pointer-events-none absolute -right-20 top-40 h-[19rem] w-[19rem] rounded-full border border-white/10" />
            <div className="relative">
              <p className="font-display text-3xl tracking-[0.14em]">ÉLANO</p>
              <p className="mt-2 text-[0.62rem] uppercase tracking-[0.28em] text-white/55">
                The fashion house
              </p>
            </div>

            <div className="relative max-w-sm">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-2 text-[0.65rem] uppercase tracking-[0.17em] text-white/75">
                <LockKeyhole size={13} />
                Secure admin portal
              </div>
              <h1 className="font-display text-[4.3rem] leading-[0.88] tracking-[-0.055em] xl:text-[5rem]">
                Thoughtfully
                <span className="mt-2 block text-[#c7b18d]">curated.</span>
                <span className="mt-2 block">Confidently</span>
                <span className="block">managed.</span>
              </h1>
              <p className="mt-7 max-w-xs text-sm leading-6 text-white/65">
                Your private space to shape the ÉLANO experience, one detail at a time.
              </p>
            </div>

            <p className="relative text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
              Private access · Authorized team only
            </p>
          </aside>

          <div className="flex items-center px-6 py-10 sm:px-12 lg:px-14 xl:px-20">
            <div className="mx-auto w-full max-w-[410px]">
              <div className="mb-10 flex items-center justify-between lg:hidden">
                <span className="font-display text-2xl tracking-[0.14em]">ÉLANO</span>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#17243b] text-white">
                  <LockKeyhole size={17} />
                </span>
              </div>

              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[#9a8060]">
                Welcome to the atelier
              </p>
              <h2 className="mt-3 font-display text-[3.4rem] leading-none tracking-[-0.055em] text-[#1d2027] sm:text-[3.8rem]">
                Sign in<span className="text-[#b89b70]">.</span>
              </h2>
              <p className="mt-4 max-w-sm text-sm leading-6 text-[#77716b]">
                Access your store dashboard with your authorized administrator account.
              </p>

              <form onSubmit={handleSignIn} className="mt-9 space-y-5">
                <div>
                  <label htmlFor="admin-email" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#4c4945]">
                    Email address
                  </label>
                  <div>
                    <input
                      id="admin-email"
                      type="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@elanostore.com"
                      className="h-14 w-full rounded-xl border border-[#e2d9cf] bg-white px-4 text-sm text-[#202020] outline-none transition placeholder:text-[#b6afa6] hover:border-[#cfc2b3] focus:border-[#17243b] focus:ring-4 focus:ring-[#17243b]/[0.07]"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label htmlFor="admin-password" className="block text-xs font-semibold uppercase tracking-[0.12em] text-[#4c4945]">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      className="text-xs font-medium text-[#74614a] transition hover:text-[#17243b] hover:underline hover:underline-offset-4"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="admin-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter your password"
                      className="h-14 w-full rounded-xl border border-[#e2d9cf] bg-white px-4 pr-12 text-sm text-[#202020] outline-none transition placeholder:text-[#b6afa6] hover:border-[#cfc2b3] focus:border-[#17243b] focus:ring-4 focus:ring-[#17243b]/[0.07]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((isVisible) => !isVisible)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#817a72] transition hover:bg-[#f3efe8] hover:text-[#17243b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#17243b]"
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                {authError ? (
                  <p className="rounded-xl border border-[#eed2cb] bg-[#fff5f2] px-4 py-3 text-sm text-[#a33f2f]" role="alert">
                    {authError}
                  </p>
                ) : null}
                {notice ? (
                  <p className="rounded-xl border border-[#cfe0d3] bg-[#f2f8f3] px-4 py-3 text-sm text-[#315c41]" role="status">
                    {notice}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="group inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#17243b] px-5 text-sm font-semibold tracking-[0.02em] text-white shadow-[0_8px_20px_rgba(23,36,59,0.16)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#223653] hover:shadow-[0_12px_24px_rgba(23,36,59,0.2)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#17243b] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Signing in…" : "Sign in to dashboard"}
                  {!isSubmitting ? <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" /> : null}
                </button>
              </form>

              <div className="my-6 flex items-center gap-4 text-[0.65rem] font-medium uppercase tracking-[0.16em] text-[#a19a91]">
                <span className="h-px flex-1 bg-[#e8dfd6]" />
                or continue with
                <span className="h-px flex-1 bg-[#e8dfd6]" />
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting}
                className="inline-flex h-14 w-full items-center justify-center gap-3 rounded-xl border border-[#e2d9cf] bg-white px-5 text-sm font-medium text-[#34312e] transition hover:border-[#cfc2b3] hover:bg-[#fdfbf9] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#17243b] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48" className="block h-5 w-5 shrink-0">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 37.98 46.98 31.9 46.98 24.55Z" />
                  <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.75-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.54 2.56 10.78l7.97-6.19Z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.89 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
                </svg>
                Continue with Google
              </button>

              <p className="mt-8 text-center text-xs leading-5 text-[#999188]">
                This secure area is restricted to authorized ÉLANO administrators.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (access === "not-admin") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3efe8] px-4 py-10">
        <section className="w-full max-w-lg rounded-3xl border border-[#e5dacd] bg-[#fbf8f5] p-7">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-[#17243b] text-white">
            <ShieldCheck size={20} />
          </div>
          <h1 className="font-display text-4xl tracking-[-0.04em]">Admin access required</h1>
          <p className="mt-3 text-sm leading-6 text-[#615b56]">
            {user?.email ?? "This account"} is signed in, but it has no admin or employee access.
            Ask the Super Admin to add you from the Team page, then sign out and back in.
          </p>
          {user ? (
            <p className="mt-3 break-all rounded-xl bg-[#f3efe8] p-3 font-mono text-xs text-[#615b56]">
              Firebase UID: {user.uid}
            </p>
          ) : null}
          {authError ? (
            <p className="mt-4 text-sm text-[#a33f2f]" role="alert">{authError}</p>
          ) : null}
          {user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL ? (
            <div className="mt-5 rounded-2xl bg-[#f3efe8] p-4">
              <p className="text-sm text-[#615b56]">
                This is the store owner account. {user.emailVerified
                  ? "Activate Super Admin access now."
                  : "Verify your email first (check your inbox), then reload this page."}
              </p>
              <button
                type="button"
                onClick={handleActivate}
                disabled={isActivating || !user.emailVerified}
                className="mt-3 inline-flex h-11 items-center rounded-full bg-[#17243b] px-5 text-sm font-medium text-white disabled:opacity-50"
              >
                {isActivating ? "Activating…" : "Activate Super Admin"}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-full border border-[#d8c9b9] px-5 text-sm font-medium"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f3efe8] px-4 py-8 text-[#171717] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 border-b border-[#e5dacd] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#746d68]">ÉLANO · {isSuperAdmin(adminAccess) ? "Super Admin" : "Team member"}</p>
            <h1 className="mt-2 font-display text-5xl tracking-[-0.05em]">Store overview</h1>
            <p className="mt-2 text-sm text-[#615b56]">Signed in as {user?.email}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {can(adminAccess, "analytics") ? (
              <Link
                href="/admin/analytics"
                className="inline-flex h-11 items-center gap-2 rounded-full border border-[#d8c9b9] px-5 text-sm font-medium"
              >
                Analytics
              </Link>
            ) : null}
            {can(adminAccess, "catalog") ? (
              <Link
                href="/admin/products"
                className="inline-flex h-11 items-center gap-2 rounded-full border border-[#d8c9b9] px-5 text-sm font-medium"
              >
                Manage products
              </Link>
            ) : null}
            {isSuperAdmin(adminAccess) ? (
              <Link
                href="/admin/team"
                className="inline-flex h-11 items-center gap-2 rounded-full border border-[#d8c9b9] px-5 text-sm font-medium"
              >
                Team &amp; permissions
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-[#d8c9b9] px-5 text-sm font-medium"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#17243b] px-5 text-sm font-medium text-white"
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </header>

        {dashboardError ? (
          <div className="mt-6 rounded-2xl border border-[#e3b5a8] bg-[#fff4f0] p-4 text-sm text-[#8e3223]" role="alert">
            {dashboardError}
          </div>
        ) : null}

        {isRefreshing && !stats ? (
          <p className="mt-8 text-sm text-[#615b56]" role="status">Loading store data…</p>
        ) : null}

        {stats ? (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Store statistics">
              {[
                { label: "Products", value: stats.products, perm: "catalog" as const },
                { label: "Orders", value: stats.orders, perm: "orders" as const },
                { label: "Customers", value: stats.customers, perm: "customers" as const },
                { label: "Pending orders", value: stats.pendingOrders, perm: "orders" as const },
              ].filter((stat) => can(adminAccess, stat.perm)).map((stat) => (
                <article key={stat.label} className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#746d68]">{stat.label}</p>
                  <p className="mt-3 font-display text-4xl">{stat.value}</p>
                </article>
              ))}
            </section>

            <section className="mt-8 overflow-hidden rounded-2xl border border-[#e5dacd] bg-[#fbf8f5]">
              <div className="border-b border-[#e5dacd] px-5 py-4">
                <h2 className="font-display text-2xl">Recent orders</h2>
              </div>
              {recentOrders.length === 0 ? (
                <p className="px-5 py-8 text-sm text-[#615b56]">No orders have been placed yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="bg-[#f3efe8] text-xs uppercase tracking-[0.12em] text-[#746d68]">
                      <tr>
                        <th className="px-5 py-3 font-medium">Order</th>
                        <th className="px-5 py-3 font-medium">Status</th>
                        <th className="px-5 py-3 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentOrders.map((order) => (
                        <tr key={order.id} className="border-t border-[#eee5db]">
                          <td className="px-5 py-4 font-medium">{order.orderNumber}</td>
                          <td className="px-5 py-4 capitalize">{order.status}</td>
                          <td className="px-5 py-4 text-right">
                            {formatCurrency(order.totalMinor, order.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
