import { type Locale } from "./enums.js";
export declare const normalizeKurdishText: (value: string) => string;
export declare const normalizePhoneNumber: (value: string) => string;
export declare const isKurdishScript: (value: string) => boolean;
export declare const isPhoneNumber: (value: string) => boolean;
export type LocalizedString = Partial<Record<Locale, string>> & {
    ku: string;
};
export declare const resolveLocalizedText: (value: LocalizedString, locale: Locale | undefined) => string;
