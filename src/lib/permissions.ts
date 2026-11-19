// Shared permission model for the admin dashboard.
// Keep PERMISSION_KEYS in sync with functions/src/permissions.ts and firestore.rules.

export const SUPER_ADMIN_EMAIL = "aqib2k1@gmail.com";

export const PERMISSIONS = [
  { key: "catalog", label: "Products & catalog", description: "Products, categories, collections, stock" },
  { key: "orders", label: "Orders", description: "View and manage customer orders" },
  { key: "customers", label: "Customers", description: "View customer profiles and carts" },
  { key: "coupons", label: "Coupons & discounts", description: "Create and manage coupons" },
  { key: "reviews", label: "Reviews", description: "Moderate customer reviews" },
  { key: "newsletter", label: "Newsletter", description: "View and manage subscribers" },
  { key: "cms", label: "Homepage & content", description: "Banners, testimonials, editorial content" },
  { key: "settings", label: "Site settings", description: "Store-wide settings" },
  { key: "analytics", label: "Analytics", description: "Sales, traffic and conversion reports" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export const PERMISSION_KEYS = PERMISSIONS.map((item) => item.key) as PermissionKey[];

export type AdminRole = "super_admin" | "staff";

export interface AdminAccess {
  role: AdminRole;
  permissions: PermissionKey[];
}

/** Reads the trusted custom claims from a Firebase ID token. */
export function accessFromClaims(claims: Record<string, unknown>): AdminAccess | null {
  if (claims.admin === true) {
    return { role: "super_admin", permissions: [...PERMISSION_KEYS] };
  }
  if (claims.staff === true && Array.isArray(claims.perms)) {
    const permissions = claims.perms.filter((value): value is PermissionKey =>
      PERMISSION_KEYS.includes(value as PermissionKey),
    );
    return { role: "staff", permissions };
  }
  return null;
}

export function can(access: AdminAccess | null, permission: PermissionKey): boolean {
  return Boolean(access && access.permissions.includes(permission));
}

export function isSuperAdmin(access: AdminAccess | null): boolean {
  return access?.role === "super_admin";
}
