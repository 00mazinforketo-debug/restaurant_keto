import { clsx } from "clsx";
import { resolveLocalizedText, type CategoryDto, type Locale, type MenuItemDto, type OrderStatus } from "@ros/shared";

export const cn = (...values: Array<string | false | null | undefined>) => clsx(values);

const localizedDigitsMap: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9"
};

const localizedDigitsPattern = /[٠-٩۰-۹]/g;

export const toEnglishDigits = (value: string | number) =>
  String(value).replace(localizedDigitsPattern, (digit) => localizedDigitsMap[digit] ?? digit);

export const formatCurrency = (value: number, currency = "IQD", locale = "ar-IQ") =>
  toEnglishDigits(new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0, numberingSystem: "latn" }).format(value));

export const formatNumber = (value: number, locale = "en-US", options: Intl.NumberFormatOptions = {}) =>
  toEnglishDigits(new Intl.NumberFormat(locale, { maximumFractionDigits: 0, numberingSystem: "latn", ...options }).format(value));

export const formatDateTime = (value: string | number | Date, locale?: string | string[], options?: Intl.DateTimeFormatOptions) =>
  toEnglishDigits(new Intl.DateTimeFormat(locale, { numberingSystem: "latn", ...(options ?? { dateStyle: "medium", timeStyle: "short" }) }).format(new Date(value)));

export const getCategoryName = (category: CategoryDto, locale: Locale) => resolveLocalizedText(category.names, locale);
export const getMenuText = (item: MenuItemDto, locale: Locale) => {
  const translation = item.translations.find((entry) => entry.locale === locale) || item.translations.find((entry) => entry.locale === "ku") || item.translations[0];
  return {
    name: translation?.name ?? item.slug,
    description: translation?.description ?? ""
  };
};
export const statusToneMap: Record<OrderStatus, string> = {
  PENDING: "bg-amber-400/20 text-amber-200 border-amber-300/30",
  PREPARING: "bg-sky-400/20 text-sky-200 border-sky-300/30",
  READY: "bg-emerald-400/20 text-emerald-200 border-emerald-300/30",
  DELIVERED: "bg-violet-400/20 text-violet-200 border-violet-300/30",
  CANCELLED: "bg-rose-400/20 text-rose-200 border-rose-300/30"
};
export const copyText = async (text: string) => navigator.clipboard.writeText(text);
