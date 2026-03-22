import { defaultLocale } from "./enums.js";
export const fixedLoginAccounts = [
    { id: "admin-1", displayName: "کاپتن یوسف", role: "ADMIN", preferredLocale: defaultLocale, pin: "9900" },
    { id: "customer-bahra", displayName: "بەهرە", role: "CUSTOMER", preferredLocale: defaultLocale, pin: "2000" },
    { id: "customer-razhan", displayName: "ڕاژان", role: "CUSTOMER", preferredLocale: defaultLocale, pin: "9889" }
];
export const adminSettingsPin = "2030";
export const fixedLoginPins = fixedLoginAccounts.map((account) => account.pin);
export const findFixedLoginAccountByPin = (pin) => fixedLoginAccounts.find((account) => account.pin === pin) ?? null;
