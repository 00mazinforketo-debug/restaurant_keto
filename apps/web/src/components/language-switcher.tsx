import { ChevronDown, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { defaultLocale, locales, type Locale } from "@ros/shared";

export const LanguageSwitcher = () => {
  const { t, i18n } = useTranslation();
  const currentLocale = locales.includes(i18n.language as Locale) ? (i18n.language as Locale) : defaultLocale;

  return (
    <label className="group relative inline-flex h-10 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-[18px] border border-white/10 bg-white/5 pl-3 pr-8 text-slate-100 backdrop-blur transition hover:bg-white/10 sm:h-11 sm:w-auto sm:min-w-[9.75rem] sm:rounded-full sm:pr-9">
      <Languages className="h-4 w-4 shrink-0 text-sky-200" />
      <span className="sr-only">{t("common.language")}</span>
      <select
        value={currentLocale}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
        className="w-full min-w-0 appearance-none bg-transparent pr-2 text-[0.85rem] font-semibold text-inherit outline-none sm:text-sm"
      >
        {locales.map((locale) => (
          <option key={locale} value={locale} className="bg-slate-950 text-white">
            {t(`languages.${locale}`)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-slate-400 transition group-focus-within:text-sky-200 sm:right-3" />
    </label>
  );
};
