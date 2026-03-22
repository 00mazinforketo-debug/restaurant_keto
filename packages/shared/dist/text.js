import { defaultLocale, locales } from "./enums.js";
const arabicScriptPattern = /^[\u0600-\u06FF0-9\s.,!?؟،\-()/%]+$/u;
const normalizationMap = {
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
export const normalizeKurdishText = (value) => Object.entries(normalizationMap).reduce((result, [source, target]) => result.split(source).join(target), value.trim());
export const normalizePhoneNumber = (value) => value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "").trim();
export const isKurdishScript = (value) => {
    if (!value.trim())
        return false;
    const normalized = normalizeKurdishText(value);
    return arabicScriptPattern.test(normalized);
};
export const isPhoneNumber = (value) => /^(?:\+?\d{9,15}|0\d{9,12})$/.test(normalizePhoneNumber(value));
export const resolveLocalizedText = (value, locale) => {
    const safeLocale = locale && locales.includes(locale) ? locale : defaultLocale;
    return value[safeLocale] || value.ku;
};
