const localHosts = new Set(["127.0.0.1", "localhost"]);
const privateIpPattern = /^(10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})$/;
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim() || undefined;
const ignoredConfiguredApiWarningKey = "__rosIgnoredConfiguredApiUrlWarned__";

export const isLocalDevHost = (hostname: string) => localHosts.has(hostname) || privateIpPattern.test(hostname);
export const isNetlifyHost = (hostname: string) => hostname.endsWith(".netlify.app");

const warnIgnoredConfiguredApiUrl = (value: string) => {
  if (typeof window === "undefined") {
    return;
  }

  const runtime = window as typeof window & {
    [ignoredConfiguredApiWarningKey]?: boolean;
  };

  if (runtime[ignoredConfiguredApiWarningKey]) {
    return;
  }

  runtime[ignoredConfiguredApiWarningKey] = true;
  console.warn(`[runtime-mode] Ignoring local VITE_API_URL on hosted site: ${value}`);
};

export const getConfiguredApiUrl = (currentHostname?: string) => {
  if (!configuredApiUrl) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(configuredApiUrl);
    if (currentHostname && !isLocalDevHost(currentHostname) && isLocalDevHost(parsedUrl.hostname)) {
      warnIgnoredConfiguredApiUrl(configuredApiUrl);
      return undefined;
    }

    return parsedUrl.toString().replace(/\/$/, "");
  } catch {
    return configuredApiUrl;
  }
};

export const shouldUseHostedApiProxy = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return !getConfiguredApiUrl(window.location.hostname) && !isLocalDevHost(window.location.hostname);
};
