import { MoonStar, SunMedium } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../providers/theme-provider";

export const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation();
  const isDark = resolvedTheme === "dark";
  const nextTheme = isDark ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme)}
      title={`${t("common.theme")}: ${t(`theme.${nextTheme}`)}`}
      aria-label={`${t("common.theme")}: ${t(`theme.${nextTheme}`)}`}
      className="inline-flex h-10 w-10 items-center justify-center rounded-[18px] border border-white/10 bg-white/5 text-slate-100 backdrop-blur transition hover:bg-white/10 hover:text-amber-200 sm:h-11 sm:w-11 sm:rounded-full"
    >
      {isDark ? <SunMedium className="h-4 w-4 sm:h-5 sm:w-5" /> : <MoonStar className="h-4 w-4 sm:h-5 sm:w-5" />}
    </button>
  );
};
