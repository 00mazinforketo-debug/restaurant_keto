import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ThemeMode } from "@ros/shared";

const storageKey = "ros-theme";
type ResolvedTheme = Exclude<ThemeMode, "system">;

const getResolvedTheme = (theme: ThemeMode): ResolvedTheme => (
  theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme
);

const ThemeContext = createContext<{
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
} | null>(null);

const applyTheme = (theme: ThemeMode) => {
  const effective = getResolvedTheme(theme);
  document.documentElement.dataset.theme = effective;
  return effective;
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => (window.localStorage.getItem(storageKey) as ThemeMode | null) ?? "system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => getResolvedTheme(theme));

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => {
      setResolvedTheme(applyTheme(theme));
      window.localStorage.setItem(storageKey, theme);
    };

    syncTheme();
    if (theme !== "system") return undefined;

    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, [theme]);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme: setThemeState }), [resolvedTheme, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
};
