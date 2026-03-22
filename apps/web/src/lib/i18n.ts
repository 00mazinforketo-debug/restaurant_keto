import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import { defaultLocale, locales, type Locale } from "@ros/shared";
import { resources } from "../locales/resources";
import { extraResources } from "../locales/extra-resources";

const mergeResourceTree = (target: Record<string, unknown>, source: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const current = (target[key] as Record<string, unknown> | undefined) ?? {};
      target[key] = current;
      mergeResourceTree(current, value as Record<string, unknown>);
      continue;
    }

    target[key] = value;
  }
};

const mergedResources = structuredClone(resources) as Resource;
mergeResourceTree(mergedResources as Record<string, unknown>, extraResources as Record<string, unknown>);

const storedLocale = window.localStorage.getItem("ros-locale") as Locale | null;
const initialLocale = storedLocale && locales.includes(storedLocale) ? storedLocale : defaultLocale;

void i18n.use(initReactI18next).init({
  resources: mergedResources,
  lng: initialLocale,
  fallbackLng: defaultLocale,
  interpolation: { escapeValue: false }
});

const rtlLocales = new Set<Locale>(["ku", "ar", "fa"]);

export const syncDocumentLanguage = (locale: Locale) => {
  document.documentElement.lang = locale;
  document.documentElement.dir = rtlLocales.has(locale) ? "rtl" : "ltr";
  window.localStorage.setItem("ros-locale", locale);
};

syncDocumentLanguage(initialLocale);

i18n.on("languageChanged", (language) => {
  syncDocumentLanguage(language as Locale);
});

export default i18n;
