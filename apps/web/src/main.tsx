import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { App } from "./App";
import "./lib/i18n";
import "./styles/index.css";
import { AuthProvider } from "./providers/auth-provider";
import { CartProvider } from "./providers/cart-provider";
import { RealtimeBridge } from "./providers/realtime-bridge";
import { ThemeProvider } from "./providers/theme-provider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

const localDevServiceWorkerResetKey = "ros-local-sw-reset";
const localHosts = new Set(["127.0.0.1", "localhost"]);
const privateIpPattern = /^(10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/;

const isLocalDevHost = (hostname: string) => localHosts.has(hostname) || privateIpPattern.test(hostname);

const clearLocalDevCaches = async () => {
  if (typeof window === "undefined") return;
  if (!isLocalDevHost(window.location.hostname)) return;
  if (!("serviceWorker" in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  const hasController = Boolean(navigator.serviceWorker.controller);

  if (registrations.length) {
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  if ("caches" in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(
      cacheKeys
        .filter((key) => key.startsWith("workbox") || key === "menu-data")
        .map((key) => caches.delete(key))
    );
  }

  if ((registrations.length || hasController) && !window.sessionStorage.getItem(localDevServiceWorkerResetKey)) {
    window.sessionStorage.setItem(localDevServiceWorkerResetKey, "1");
    window.location.reload();
    throw new Error("Reloading after clearing localhost PWA cache");
  }

  if (!registrations.length) {
    window.sessionStorage.removeItem(localDevServiceWorkerResetKey);
  }
};

const renderApp = () => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <CartProvider>
              <BrowserRouter>
                <RealtimeBridge />
                <App />
                <Toaster position="top-center" toastOptions={{ duration: 2500, style: { background: "#0f172a", color: "#f8fafc", border: "1px solid rgba(255,255,255,0.08)" } }} />
              </BrowserRouter>
            </CartProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  );
};

void clearLocalDevCaches()
  .catch((error) => {
    if (error instanceof Error && error.message === "Reloading after clearing localhost PWA cache") {
      return;
    }
    console.warn("Failed to clear localhost service worker cache.", error);
  })
  .finally(() => {
    if (typeof document !== "undefined" && document.getElementById("root")?.childElementCount === 0) {
      renderApp();
    }
  });
