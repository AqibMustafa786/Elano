import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";

import { PERMISSION_KEYS, SUPER_ADMIN_EMAIL } from "./permissions.js";

// These callables are protected by Firebase Auth + a trusted custom claim check,
// so they do not depend on App Check being configured.
const options = { maxInstances: 3 };

const permissionList = z.array(z.enum(PERMISSION_KEYS)).max(PERMISSION_KEYS.length);

function requireSuperAdmin(request: CallableRequest<unknown>): string {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Only the Super Admin can manage the team.");
  }
  return request.auth.uid;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

const staffRef = (uid: string) => getFirestore().collection("staff").doc(uid);

/** One-time activation: the verified owner email becomes Super Admin. */
export const claimSuperAdmin = onCall({ maxInstances: 2 }, async (request) => {
  const token = request.auth?.token;
  if (!request.auth || !token) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }

  const email = (token.email ?? "").toLowerCase();
  if (email !== SUPER_ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "This account is not the store owner.");
  }
  if (token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address first, then try again.");
  }

  const auth = getAuth();
  const user = await auth.getUser(request.auth.uid);
  await auth.setCustomUserClaims(request.auth.uid, {
    ...user.customClaims,
    admin: true,
    role: "super_admin",
  });
  return { success: true };
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128).optional(),
  permissions: permissionList.min(1, "Select at least one permission."),
});

export const createStaff = onCall(options, async (request) => {
  const actorUid = requireSuperAdmin(request);
  const parsed = createSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid employee details.");
  }

  const { name, permissions } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  const auth = getAuth();

  let uid: string;
  let existingClaims: Record<string, unknown> = {};

  try {
    const existing = await auth.getUserByEmail(email);
    if (existing.customClaims?.admin === true) {
      throw new HttpsError("failed-precondition", "That account is already a Super Admin.");
    }
    uid = existing.uid;
    existingClaims = existing.customClaims ?? {};
    await auth.updateUser(uid, { disabled: false, displayName: existing.displayName ?? name });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (errorCode(error) !== "auth/user-not-found") {
      throw new HttpsError("internal", "Could not look up this email.");
    }
    if (!parsed.data.password) {
      throw new HttpsError("invalid-argument", "Set a temporary password (8+ characters) for the new employee.");
    }
    const created = await auth.createUser({
      email,
      password: parsed.data.password,
      displayName: name,
      emailVerified: false,
    });
    uid = created.uid;
  }

  await auth.setCustomUserClaims(uid, { ...existingClaims, staff: true, role: "staff", perms: permissions });
  await staffRef(uid).set(
    {
      uid,
      email,
      displayName: name,
      permissions,
      disabled: false,
      createdBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { success: true, uid };
});

const updateSchema = z.object({
  uid: z.string().min(1).max(128),
  permissions: permissionList.optional(),
  disabled: z.boolean().optional(),
});

export const updateStaff = onCall(options, async (request) => {
  requireSuperAdmin(request);
  const parsed = updateSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Invalid update request.");
  }

  const { uid, permissions, disabled } = parsed.data;
  const snapshot = await staffRef(uid).get();
  if (!snapshot.exists) {
    throw new HttpsError("not-found", "Employee not found.");
  }

  const auth = getAuth();
  const user = await auth.getUser(uid);
  if (user.customClaims?.admin === true) {
    throw new HttpsError("failed-precondition", "The Super Admin cannot be edited here.");
  }

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

  if (permissions) {
    await auth.setCustomUserClaims(uid, { ...user.customClaims, staff: true, role: "staff", perms: permissions });
    update.permissions = permissions;
  }
  if (disabled !== undefined) {
    await auth.updateUser(uid, { disabled });
    update.disabled = disabled;
  }
  await auth.revokeRefreshTokens(uid);
  await staffRef(uid).update(update);

  return { success: true };
});

const removeSchema = z.object({ uid: z.string().min(1).max(128) });

/** Removes employee access. The customer account itself is kept. */
export const removeStaff = onCall(options, async (request) => {
  requireSuperAdmin(request);
  const parsed = removeSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Invalid request.");
  }

  const { uid } = parsed.data;
  const auth = getAuth();
  const user = await auth.getUser(uid);
  if (user.customClaims?.admin === true) {
    throw new HttpsError("failed-precondition", "The Super Admin cannot be removed.");
  }

  const { staff: _staff, role: _role, perms: _perms, ...remaining } = user.customClaims ?? {};
  void _staff;
  void _role;
  void _perms;
  await auth.setCustomUserClaims(uid, remaining);
  await auth.revokeRefreshTokens(uid);
  await staffRef(uid).delete();

  return { success: true };
});

export const listStaff = onCall(options, async (request) => {
  requireSuperAdmin(request);
  const snapshot = await getFirestore().collection("staff").orderBy("createdAt", "desc").limit(200).get();

  return {
    staff: snapshot.docs.map((doc) => {
      const data = doc.data();
      const createdAt = data.createdAt as Timestamp | undefined;
      return {
        uid: doc.id,
        email: String(data.email ?? ""),
        displayName: String(data.displayName ?? ""),
        permissions: Array.isArray(data.permissions) ? (data.permissions as string[]) : [],
        disabled: data.disabled === true,
        createdAt: createdAt?.toDate().toISOString() ?? null,
      };
    }),
  };
});
