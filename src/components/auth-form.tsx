"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  authErrorMessage,
  loginCustomer,
  registerCustomer,
  requestPasswordReset,
} from "@/lib/firebase/customer-auth";

type Mode = "login" | "register";

const inputClass =
  "w-full rounded-full border border-[#e3d8cd] bg-white/60 px-5 py-3 text-sm outline-none transition focus:border-[#17243b]";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isRegister = mode === "register";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (isRegister && name.trim().length < 2) {
      setError("Enter your full name.");
      return;
    }
    if (isRegister && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      if (isRegister) {
        await registerCustomer({ name, email, password });
      } else {
        await loginCustomer(email, password);
      }
      router.push("/account");
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onForgotPassword() {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Enter your email above first.");
      return;
    }
    try {
      await requestPasswordReset(email);
    } catch {
      // Same message either way so account existence is not revealed.
    }
    setNotice("If an account exists for this email, a reset link has been sent.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-[24px] border border-[#e7ddd3] bg-[#f6f2ee] p-8 shadow-[0_10px_30px_rgba(22,22,22,0.05)]">
        <Link href="/" className="font-display text-3xl tracking-[0.2em] text-[#17243b]">
          ÉLANO
        </Link>
        <h1 className="font-display mt-6 text-4xl text-[#17243b]">
          {isRegister ? "Create account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-[#746d68]">
          {isRegister ? "Join ÉLANO to save favourites and track orders." : "Sign in to your account."}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3" noValidate>
          {isRegister ? (
            <input className={inputClass} placeholder="Full name" autoComplete="name"
              value={name} onChange={(e) => setName(e.target.value)} aria-label="Full name" />
          ) : null}
          <input className={inputClass} type="email" placeholder="Email" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          <input className={inputClass} type="password" placeholder="Password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />

          {error ? <p role="alert" className="text-sm text-[#a33a2f]">{error}</p> : null}
          {notice ? <p role="status" className="text-sm text-[#2f6b4f]">{notice}</p> : null}

          <button type="submit" disabled={busy}
            className="w-full rounded-full bg-[#17243b] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#101a2b] disabled:opacity-60">
            {busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
          </button>
        </form>

        {!isRegister ? (
          <button type="button" onClick={onForgotPassword}
            className="mt-3 text-sm text-[#746d68] underline underline-offset-4">
            Forgot password?
          </button>
        ) : null}

        <p className="mt-6 text-sm text-[#746d68]">
          {isRegister ? "Already have an account? " : "New to ÉLANO? "}
          <Link href={isRegister ? "/login" : "/register"} className="text-[#17243b] underline underline-offset-4">
            {isRegister ? "Sign in" : "Create account"}
          </Link>
        </p>
      </div>
    </main>
  );
}
