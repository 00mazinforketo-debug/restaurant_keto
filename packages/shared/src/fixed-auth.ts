import { defaultLocale, type Locale, type UserRole } from "./enums.js";

export type FixedLoginAccount = {
  id: string;
  displayName: string;
  role: UserRole;
  preferredLocale: Locale;
  pin: string;
};

export const fixedLoginAccounts: FixedLoginAccount[] = [
  { id: "admin-1", displayName: "کاپتن یوسف", role: "ADMIN", preferredLocale: defaultLocale, pin: "9900" },
  { id: "customer-bahra", displayName: "بەهرە", role: "CUSTOMER", preferredLocale: defaultLocale, pin: "2000" },
  { id: "customer-razhan", displayName: "ڕاژان", role: "CUSTOMER", preferredLocale: defaultLocale, pin: "9889" }
];

export const adminSettingsPin = "2030";

export const fixedLoginPins = fixedLoginAccounts.map((account) => account.pin);

export const findFixedLoginAccountByPin = (pin: string) =>
  fixedLoginAccounts.find((account) => account.pin === pin) ?? null;
