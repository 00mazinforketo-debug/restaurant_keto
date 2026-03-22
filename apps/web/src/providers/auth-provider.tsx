import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoginPinInput } from "@ros/shared";
import { api, ApiClientError, type SessionPayload } from "../lib/api";

type AuthContextValue = {
  user: SessionPayload["user"] | null;
  isLoading: boolean;
  login: (payload: LoginPinInput) => Promise<SessionPayload["user"]>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const sessionActivityStorageKey = "ros-session-last-activity-at";
const sessionLogoutEventStorageKey = "ros-session-logout-event";
const sessionIdleTimeoutMs = 1000 * 60 * 30;
const clientActivityThrottleMs = 1000 * 5;
const serverTouchIntervalMs = 1000 * 60 * 5;
const sessionActivityEvents = ["pointerdown", "keydown", "touchstart", "scroll", "mousemove"] as const;

const hasSessionHintCookie = () =>
  document.cookie.split("; ").some((segment) => segment.startsWith("ros_csrf="));

const readStoredActivityAt = () => {
  const raw = window.localStorage.getItem(sessionActivityStorageKey);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionPayload["user"] | null>(null);
  const [hasSessionHint, setHasSessionHint] = useState(() => hasSessionHintCookie());
  const idleTimerRef = useRef<number | null>(null);
  const lastActivityRef = useRef(Date.now());
  const lastServerTouchRef = useRef(0);

  const authQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: api.me,
    enabled: hasSessionHint,
    retry: false,
    staleTime: 1000 * 60 * 5
  });

  const clearIdleTimer = () => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  const clearSessionState = (broadcast = false, resetCache = true) => {
    clearIdleTimer();
    lastActivityRef.current = Date.now();
    lastServerTouchRef.current = 0;
    setUser(null);
    setHasSessionHint(false);
    if (resetCache) {
      queryClient.clear();
    } else {
      queryClient.removeQueries({ queryKey: ["orders"] });
      queryClient.removeQueries({ queryKey: ["admin"] });
    }
    window.localStorage.removeItem(sessionActivityStorageKey);
    if (broadcast) {
      window.localStorage.setItem(sessionLogoutEventStorageKey, String(Date.now()));
    }
  };

  const scheduleIdleLogout = (activityAt: number) => {
    clearIdleTimer();
    const remainingMs = Math.max(activityAt + sessionIdleTimeoutMs - Date.now(), 0);
    idleTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          await api.logout();
        } catch {
          // The browser session can still be cleared locally if the access token already expired.
        } finally {
          clearSessionState(true);
        }
      })();
    }, remainingMs);
  };

  const syncSession = (session: SessionPayload, activityAt = Date.now()) => {
    setUser(session.user);
    setHasSessionHint(true);
    queryClient.setQueryData(["auth", "me"], session);
    lastActivityRef.current = activityAt;
    lastServerTouchRef.current = activityAt;
    window.localStorage.setItem(sessionActivityStorageKey, String(activityAt));
    scheduleIdleLogout(activityAt);
  };

  const refreshSession = async () => {
    const session = await api.refresh();
    syncSession(session);
    return session;
  };

  const touchServerSession = (activityAt: number) => {
    if (!user || activityAt - lastServerTouchRef.current < serverTouchIntervalMs) {
      return;
    }

    lastServerTouchRef.current = activityAt;
    void refreshSession().catch((error) => {
      if (error instanceof ApiClientError && error.status === 401) {
        clearSessionState(true);
        return;
      }

      lastServerTouchRef.current = activityAt - serverTouchIntervalMs;
    });
  };

  const recordActivity = (syncWithServer: boolean) => {
    if (!user) {
      return;
    }

    const activityAt = Date.now();
    if (activityAt - lastActivityRef.current < clientActivityThrottleMs) {
      return;
    }

    lastActivityRef.current = activityAt;
    window.localStorage.setItem(sessionActivityStorageKey, String(activityAt));
    scheduleIdleLogout(activityAt);

    if (syncWithServer) {
      touchServerSession(activityAt);
    }
  };

  useEffect(() => {
    if (authQuery.data?.user) {
      syncSession(authQuery.data);
      return;
    }

    if (authQuery.error instanceof ApiClientError && authQuery.error.status === 401) {
      clearSessionState(false, false);
    }
  }, [authQuery.data, authQuery.error]);

  useEffect(() => {
    if (!user) {
      clearIdleTimer();
      return;
    }

    const initialActivityAt = readStoredActivityAt() ?? Date.now();
    lastActivityRef.current = initialActivityAt;
    if (!readStoredActivityAt()) {
      window.localStorage.setItem(sessionActivityStorageKey, String(initialActivityAt));
    }
    scheduleIdleLogout(initialActivityAt);

    const onActivity = () => {
      recordActivity(true);
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        recordActivity(true);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === sessionActivityStorageKey && event.newValue) {
        const nextActivityAt = Number(event.newValue);
        if (Number.isFinite(nextActivityAt) && nextActivityAt > 0) {
          lastActivityRef.current = nextActivityAt;
          scheduleIdleLogout(nextActivityAt);
        }
      }

      if (event.key === sessionLogoutEventStorageKey && event.newValue) {
        clearSessionState(false);
      }
    };

    for (const eventName of sessionActivityEvents) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("storage", onStorage);

    return () => {
      for (const eventName of sessionActivityEvents) {
        window.removeEventListener(eventName, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("storage", onStorage);
      clearIdleTimer();
    };
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading: authQuery.isLoading && !user,
      login: async (payload) => {
        const session = await api.login(payload);
        syncSession(session);
        return session.user;
      },
      logout: async () => {
        try {
          await api.logout();
        } catch {
          // The local session should still be cleared if the server-side access token expired.
        } finally {
          clearSessionState(true);
        }
      },
      refresh: async () => {
        await refreshSession();
      }
    }),
    [authQuery.isLoading, queryClient, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
