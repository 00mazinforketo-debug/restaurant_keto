export const locales = ["ku", "ar", "fa", "en", "tr"];
export const userRoles = ["CUSTOMER", "ADMIN"];
export const orderStatuses = [
    "PENDING",
    "PREPARING",
    "READY",
    "DELIVERED",
    "CANCELLED"
];
export const socketEvents = {
    connected: "system:connected",
    orderCreated: "order:created",
    orderUpdated: "order:updated",
    orderDeleted: "order:deleted",
    notification: "notification:push",
    dashboardMetrics: "dashboard:metrics"
};
export const defaultLocale = "ku";
export const supportedThemes = ["light", "dark", "system"];
