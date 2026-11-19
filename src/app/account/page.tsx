"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { logoutCustomer } from "@/lib/firebase/customer-auth";
import { useCustomer } from "@/lib/firebase/use-customer";

export default function AccountPage() {
  const router = useRouter();
  const { user, loading } = useCustomer();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  async function onLogout() {
    setSigningOut(true);
    await logoutCustomer();
    router.replace("/");
  }

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#e3d8cd] border-t-[#17243b]" aria-label="Loading" />
      </main>
    );
  }

  const initial = (user.displayName ?? user.email ?? "É").charAt(0).toUpperCase();

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10">
      <Link href="/" className="font-display text-3xl tracking-[0.2em] text-[#17243b]">ÉLANO</Link>

      <section className="mt-8 rounded-[24px] border border-[#e7ddd3] bg-[#f6f2ee] p-8 shadow-[0_10px_30px_rgba(22,22,22,0.05)]">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#17243b] text-2xl text-white">{initial}</div>
          <div>
            <h1 className="font-display text-3xl text-[#17243b]">{user.displayName ?? "Welcome"}</h1>
            <p className="text-sm text-[#746d68]">{user.email}</p>
          </div>
        </div>

        {!user.emailVerified ? (
          <p className="mt-6 rounded-2xl bg-[#fff6df] px-4 py-3 text-sm text-[#7a5b12]">
            Please verify your email. We sent a link to {user.email}.
          </p>
        ) : null}

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[#e3d8cd] bg-white/60 p-5">
            <h2 className="font-display text-xl text-[#17243b]">Orders</h2>
            <p className="mt-1 text-sm text-[#746d68]">Order history arrives with checkout (next versions).</p>
          </div>
          <div className="rounded-2xl border border-[#e3d8cd] bg-white/60 p-5">
            <h2 className="font-display text-xl text-[#17243b]">Addresses</h2>
            <p className="mt-1 text-sm text-[#746d68]">Saved addresses arrive in a later version.</p>
          </div>
        </div>

        <button type="button" onClick={onLogout} disabled={signingOut}
          className="mt-8 rounded-full border border-[#17243b] px-6 py-2.5 text-sm font-semibold text-[#17243b] transition hover:bg-[#17243b] hover:text-white disabled:opacity-60">
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </section>
    </main>
  );
}
