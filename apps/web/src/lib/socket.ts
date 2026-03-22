import { io, type Socket } from "socket.io-client";
import { isBrowserDemoModeActive } from "./demo-api";
import { getConfiguredApiUrl, isLocalDevHost, shouldUseHostedApiProxy } from "./runtime-mode";

const resolveSocketUrl = (configuredUrl?: string) => {
  if (typeof window === "undefined") {
    return configuredUrl ?? "http://localhost:4000";
  }

  const currentHostname = window.location.hostname;
  if (!isLocalDevHost(currentHostname)) {
    return configuredUrl ?? "http://localhost:4000";
  }

  const localDevUrl = `${window.location.protocol}//${currentHostname}:4001`;
  if (!configuredUrl) {
    return localDevUrl;
  }

  try {
    const parsedUrl = new URL(configuredUrl);
    if (isLocalDevHost(parsedUrl.hostname)) {
      parsedUrl.hostname = currentHostname;
      return parsedUrl.toString().replace(/\/$/, "");
    }
  } catch {
    return configuredUrl;
  }

  return configuredUrl;
};

const API_URL = resolveSocketUrl(
  typeof window === "undefined"
    ? getConfiguredApiUrl()
    : getConfiguredApiUrl(window.location.hostname)
);

let socket: Socket | null = null;

export const isRealtimeEnabled = () => !shouldUseHostedApiProxy() && !isBrowserDemoModeActive();

export const getSocket = () => {
  if (!socket) {
    socket = io(API_URL, {
      transports: ["websocket", "polling"],
      withCredentials: true,
      autoConnect: false
    });
  }

  return socket;
};
