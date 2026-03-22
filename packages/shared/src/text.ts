import { defaultLocale, locales, type Locale } from "./enums.js";

const arabicScriptPattern = /^[\u0600-\u06FF0-9\s.,!?؟،\-()/%]+$/u;

const normalizationMap: Record<string, string> = {
  "ي": "ی",
  "ى": "ی",
  "ك": "ک",
  "ة": "ە",
  "ۀ": "ە",
  "ؤ": "ۆ",
  "إ": "ئ",
  "أ": "ئ",
  "آ": "ئا",
  "ة‌": "ە",
  "ـ": ""
};

export const normalizeKurdishText = (value: string) =>
  Object.entries(normalizationMap).reduce((result, [source, target]) => result.split(source).join(target), value.trim());

export const normalizePhoneNumber = (value: string) => value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "").trim();

export const isKurdishScript = (value: string) => {
  if (!value.trim()) return false;
  const normalized = normalizeKurdishText(value);
  return arabicScriptPattern.test(normalized);
};

export const isPhoneNumber = (value: string) => /^(?:\+?\d{9,15}|0\d{9,12})$/.test(normalizePhoneNumber(value));

export type LocalizedString = Partial<Record<Locale, string>> & { ku: string };

export const resolveLocalizedText = (value: LocalizedString, locale: Locale | undefined) => {
  const safeLocale = locale && locales.includes(locale) ? locale : defaultLocale;
  return value[safeLocale] || value.ku;
};
