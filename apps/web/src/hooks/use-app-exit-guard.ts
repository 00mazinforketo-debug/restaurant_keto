import { useEffect } from "react";

export const useAppExitGuard = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const currentState = (window.history.state as Record<string, unknown> | null) ?? {};
    if (!currentState.__rosExitGuardPage && !currentState.__rosExitGuardSentinel) {
      window.history.replaceState({ ...currentState, __rosExitGuardPage: true }, "", window.location.href);
      window.history.pushState({ __rosExitGuardSentinel: true }, "", window.location.href);
    }

    const handlePopState = () => {
      const nextState = (window.history.state as Record<string, unknown> | null) ?? {};
      if (nextState.__rosExitGuardPage) {
        window.history.pushState({ __rosExitGuardSentinel: true }, "", window.location.href);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [enabled]);
};
