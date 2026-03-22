export declare const locales: readonly ["ku", "ar", "fa", "en", "tr"];
export type Locale = (typeof locales)[number];
export declare const userRoles: readonly ["CUSTOMER", "ADMIN"];
export type UserRole = (typeof userRoles)[number];
export declare const orderStatuses: readonly ["PENDING", "PREPARING", "READY", "DELIVERED", "CANCELLED"];
export type OrderStatus = (typeof orderStatuses)[number];
export declare const socketEvents: {
    readonly connected: "system:connected";
    readonly orderCreated: "order:created";
    readonly orderUpdated: "order:updated";
    readonly orderDeleted: "order:deleted";
    readonly notification: "notification:push";
    readonly dashboardMetrics: "dashboard:metrics";
};
export declare const defaultLocale: Locale;
export declare const supportedThemes: readonly ["light", "dark", "system"];
export type ThemeMode = (typeof supportedThemes)[number];
