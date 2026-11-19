"use client";

import { getIdTokenResult, onAuthStateChanged } from "firebase/auth";
import { ArrowLeft, Plus, ShieldCheck, Trash2, UserX, UserCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { getFirebaseServices } from "@/lib/firebase/client";
import {
  createStaffMember,
  fetchStaff,
  removeStaffMember,
  updateStaffMember,
  type StaffMember,
} from "@/lib/firebase/functions";
import { accessFromClaims, isSuperAdmin, PERMISSIONS } from "@/lib/permissions";

type Access = "loading" | "signed-out" | "denied" | "super";

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.replace(/^.*?:\s*/, "");
  }
  return "Something went wrong. Please try again.";
}

function PermissionPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((item) => item !== key) : [...value, key]);

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PERMISSIONS.map((permission) => {
        const checked = value.includes(permission.key);
        return (
          <label
            key={permission.key}
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition ${
              checked ? "border-[#17243b] bg-white" : "border-[#e5dacd] bg-[#fbf8f5]"
            } ${disabled ? "opacity-60" : ""}`}
          >
            <input
              type="checkbox"
              className="mt-1 accent-[#17243b]"
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(permission.key)}
            />
            <span>
              <span className="block font-medium">{permission.label}</span>
              <span className="block text-xs text-[#746d68]">{permission.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function MemberCard({ member, onChanged }: { member: StaffMember; onChanged: () => void }) {
  const [permissions, setPermissions] = useState(member.permissions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed =
    permissions.length !== member.permissions.length ||
    permissions.some((item) => !member.permissions.includes(item));

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await task();
      setSaved(true);
      onChanged();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-2xl border border-[#e5dacd] bg-[#fbf8f5] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-2xl">{member.displayName || member.email}</h3>
          <p className="text-sm text-[#746d68]">{member.email}</p>
          {member.disabled ? (
            <span className="mt-2 inline-block rounded-full bg-[#fde8e4] px-3 py-1 text-xs text-[#8e3223]">
              Access disabled
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => updateStaffMember({ uid: member.uid, disabled: !member.disabled }))}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[#d8c9b9] px-4 text-sm disabled:opacity-50"
          >
            {member.disabled ? <UserCheck size={15} /> : <UserX size={15} />}
            {member.disabled ? "Enable" : "Disable"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Remove ${member.email} from the team?`)) {
                void run(() => removeStaffMember(member.uid));
              }
            }}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[#e3b5a8] px-4 text-sm text-[#8e3223] disabled:opacity-50"
          >
            <Trash2 size={15} />
            Remove
          </button>
        </div>
      </div>

      <div className="mt-4">
        <PermissionPicker value={permissions} onChange={setPermissions} disabled={busy} />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !changed || permissions.length === 0}
          onClick={() => run(() => updateStaffMember({ uid: member.uid, permissions }))}
          className="inline-flex h-10 items-center rounded-full bg-[#17243b] px-5 text-sm text-white disabled:opacity-40"
        >
          Save permissions
        </button>
        {saved && !changed ? <span className="text-sm text-[#2f6b4f]">Saved. Applies at their next sign-in.</span> : null}
        {error ? <span role="alert" className="text-sm text-[#a33f2f]">{error}</span> : null}
      </div>
    </article>
  );
}

export default function TeamPage() {
  const [access, setAccess] = useState<Access>("loading");
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [permissions, setPermissions] = useState<string[]>(["orders"]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      setStaff(await fetchStaff());
    } catch (error) {
      setListError(messageOf(error));
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseServices();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAccess("signed-out");
        return;
      }
      try {
        const token = await getIdTokenResult(user, true);
        const found = accessFromClaims(token.claims);
        if (isSuperAdmin(found)) {
          setAccess("super");
          void load();
        } else {
          setAccess("denied");
        }
      } catch {
        setAccess("denied");
      }
    });
  }, [load]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFormNotice(null);
    if (permissions.length === 0) {
      setFormError("Select at least one permission.");
      return;
    }
    setCreating(true);
    try {
      await createStaffMember({
        name,
        email,
        password: password || undefined,
        permissions,
      });
      setFormNotice(`${email} added. Share the sign-in details with them privately.`);
      setName("");
      setEmail("");
      setPassword("");
      await load();
    } catch (error) {
      setFormError(messageOf(error));
    } finally {
      setCreating(false);
    }
  }

  if (access === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3efe8]">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#e3d8cd] border-t-[#17243b]" aria-label="Loading" />
      </main>
    );
  }

  if (access !== "super") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3efe8] px-4">
        <section className="max-w-md rounded-3xl border border-[#e5dacd] bg-[#fbf8f5] p-7">
          <ShieldCheck size={22} />
          <h1 className="mt-4 font-display text-3xl">Super Admin only</h1>
          <p className="mt-2 text-sm text-[#615b56]">
            {access === "signed-out" ? "Sign in from the admin page first." : "Your account cannot manage the team."}
          </p>
          <Link href="/admin" className="mt-5 inline-block rounded-full bg-[#17243b] px-5 py-2.5 text-sm text-white">
            Go to admin
          </Link>
        </section>
      </main>
    );
  }

  const inputClass =
    "h-11 w-full rounded-full border border-[#d8c9b9] bg-white/70 px-5 text-sm outline-none focus:border-[#17243b]";

  return (
    <main className="min-h-screen bg-[#f3efe8] px-4 py-8 text-[#171717] sm:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="border-b border-[#e5dacd] pb-6">
          <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-[#615b56]">
            <ArrowLeft size={15} /> Back to admin
          </Link>
          <p className="mt-4 text-xs uppercase tracking-[0.18em] text-[#746d68]">ÉLANO · Super Admin</p>
          <h1 className="mt-2 font-display text-5xl tracking-[-0.05em]">Team &amp; permissions</h1>
          <p className="mt-2 text-sm text-[#615b56]">
            Add employees and choose exactly what each person can manage.
          </p>
        </header>

        <section className="mt-8 rounded-3xl border border-[#e5dacd] bg-[#fbf8f5] p-6">
          <h2 className="font-display text-2xl">Add an employee</h2>
          <form onSubmit={onCreate} className="mt-4 space-y-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-3">
              <input className={inputClass} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Full name" />
              <input className={inputClass} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
              <input className={inputClass} type="text" placeholder="Temporary password (8+)" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Temporary password" autoComplete="off" />
            </div>
            <p className="text-xs text-[#746d68]">
              Password is needed only for new accounts. If the person already has a customer account, leave it empty.
            </p>
            <PermissionPicker value={permissions} onChange={setPermissions} disabled={creating} />
            {formError ? <p role="alert" className="text-sm text-[#a33f2f]">{formError}</p> : null}
            {formNotice ? <p role="status" className="text-sm text-[#2f6b4f]">{formNotice}</p> : null}
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#17243b] px-6 text-sm font-medium text-white disabled:opacity-60"
            >
              <Plus size={16} /> {creating ? "Adding…" : "Add employee"}
            </button>
          </form>
        </section>

        <section className="mt-8 space-y-4" aria-label="Employees">
          <h2 className="font-display text-2xl">Employees</h2>
          {loadingList && staff.length === 0 ? <p className="text-sm text-[#615b56]">Loading team…</p> : null}
          {listError ? <p role="alert" className="text-sm text-[#a33f2f]">{listError}</p> : null}
          {!loadingList && !listError && staff.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[#d8c9b9] p-6 text-sm text-[#615b56]">
              No employees yet. Add your first team member above.
            </p>
          ) : null}
          {staff.map((member) => (
            <MemberCard key={`${member.uid}-${member.permissions.join(",")}-${member.disabled}`} member={member} onChanged={load} />
          ))}
        </section>
      </div>
    </main>
  );
}
