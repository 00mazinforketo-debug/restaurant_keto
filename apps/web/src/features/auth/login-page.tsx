import { useState, startTransition, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../../providers/auth-provider";
import { LanguageSwitcher } from "../../components/language-switcher";
import { ThemeToggle } from "../../components/theme-toggle";
import { isPersistentStorageOutageError } from "../../lib/api";

export const LoginPage = () => {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pin, setPin] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setIsSubmitting(true);
      const user = await login({ pin, rememberMe });
      const nextPath = (location.state as { from?: string } | undefined)?.from;
      startTransition(() => {
        navigate(nextPath || (user.role === "ADMIN" ? "/admin" : "/app"), { replace: true });
      });
      toast.success(`${user.displayName}`);
    } catch (error) {
      if (isPersistentStorageOutageError(error)) {
        setIsMaintenanceMode(true);
      }
      toast.error(error instanceof Error ? error.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-shell relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.22),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.2),_transparent_32%)]" />
      <div className="app-stage relative flex flex-col gap-3 sm:gap-5">
        <header className="app-panel-strong px-3 py-3 sm:px-5">
          <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-end">
            <div className="w-full min-[420px]:w-auto">
              <LanguageSwitcher />
            </div>
            <div className="self-end min-[420px]:self-auto">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-3 sm:min-h-[calc(100vh-8.5rem)] sm:gap-5 min-[1700px]:grid min-[1700px]:grid-cols-[minmax(0,1fr)_minmax(19rem,28rem)]">
          <section className="app-panel flex min-w-0 flex-1 items-center shadow-glow sm:p-7 min-[1700px]:p-10">
            <div className="max-w-2xl">
              <h1 className="font-display text-[clamp(1.75rem,7vw,4rem)] font-extrabold leading-[1.08] text-white break-words">
                {t("app.name")}
              </h1>
            </div>
          </section>

          <section className="app-panel-strong w-full min-w-0 max-w-none bg-slate-950/70 sm:p-7 min-[1700px]:p-8">
            <div className="mb-6 sm:mb-7">
              <p className="text-[0.72rem] uppercase tracking-[0.24em] text-sky-200/80 sm:text-sm sm:tracking-[0.35em]">{t("nav.customer")} / {t("nav.admin")}</p>
              <h2 className="mt-3 font-display text-[clamp(1.45rem,5vw,2.7rem)] font-bold leading-tight">{t("auth.title")}</h2>
              <p className="mt-2.5 text-[0.92rem] leading-6 text-slate-300">{t("auth.subtitle")}</p>
            </div>

            {isMaintenanceMode ? (
              <div className="mb-5 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4 text-[0.92rem] text-amber-100">
                <p className="font-display text-lg font-bold text-white">سیستەمەکە کاتێکی کورت وەستاوە</p>
                <p className="mt-2 leading-6">
                  هەڵگرتنی زانیارییەکان لە production بەردەست نییە. تکایە دووبارە هەوڵ بدەوە دوای چرکەیەک، یان دوای نوێکردنەوەی site.
                </p>
              </div>
            ) : null}

            <form className="space-y-4 sm:space-y-5" onSubmit={onSubmit}>
              <label className="block">
                <span className="mb-2 block text-[0.92rem] font-semibold text-slate-200">{t("auth.pin")}</span>
                <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" pattern="[0-9]*" maxLength={4} className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-center font-display text-[clamp(1.45rem,8vw,2.5rem)] tracking-[0.28em] text-white outline-none transition focus:border-amber-300/60 focus:bg-white/10 min-[420px]:px-4 min-[420px]:py-3.5 sm:tracking-[0.5em]" placeholder="0000" />
              </label>
              <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[0.9rem] text-slate-200"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-white/20 bg-transparent" /> <span className="break-words">{t("auth.rememberMe")}</span></label>
              <button type="submit" disabled={pin.length !== 4 || isSubmitting} className="compact-primary-button w-full py-3.5 text-[1rem] font-extrabold">{isSubmitting ? t("common.loading") : t("auth.loginAction")}</button>
            </form>

            <div className="mt-5 rounded-2xl border border-sky-300/20 bg-sky-500/10 p-4 text-[0.9rem] text-sky-100">
              <p className="font-semibold leading-6">بۆ دروست کردنی سیستەم یان ئەپڵیکەیشن یان هەر بیرۆکەیێکت هەیە بیسپێرە بە من کلیک لە زانیاری زیاتر بکە</p>
              <a
                href="https://98ramyar.netlify.app/"
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-sky-200/30 bg-white/10 px-4 py-2.5 font-display text-[0.85rem] font-bold text-white transition hover:bg-white/20 min-[420px]:w-auto"
              >
                زانیاری زیاتر
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
