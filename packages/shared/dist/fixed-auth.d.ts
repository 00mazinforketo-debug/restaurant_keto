import { type Locale, type UserRole } from "./enums.js";
export type FixedLoginAccount = {
    id: string;
    displayName: string;
    role: UserRole;
    preferredLocale: Locale;
    pin: string;
};
export declare const fixedLoginAccounts: FixedLoginAccount[];
export declare const adminSettingsPin = "2030";
export declare const fixedLoginPins: string[];
export declare const findFixedLoginAccountByPin: (pin: string) => FixedLoginAccount | null;
