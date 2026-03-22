export const locales = ["ku", "ar", "fa", "en", "tr"] as const;
export type Locale = (typeof locales)[number];

export const userRoles = ["CUSTOMER", "ADMIN"] as const;
export type UserRole = (typeof userRoles)[number];

export const orderStatuses = [
  "PENDING",
  "PREPARING",
  "READY",
  "DELIVERED",
  "CANCELLED"
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export const socketEvents = {
  connected: "system:connected",
  orderCreated: "order:created",
  orderUpdated: "order:updated",
  orderDeleted: "order:deleted",
  notification: "notification:push",
  dashboardMetrics: "dashboard:metrics"
} as const;

export const defaultLocale: Locale = "ku";

export const supportedThemes = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof supportedThemes)[number];
