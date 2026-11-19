export const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL ?? "aqib2k1@gmail.com").toLowerCase();

export const PERMISSION_KEYS = [
  "catalog",
  "orders",
  "customers",
  "coupons",
  "reviews",
  "newsletter",
  "cms",
  "settings",
  "analytics",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
