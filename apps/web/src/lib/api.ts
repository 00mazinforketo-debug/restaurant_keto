import { resolveLocalizedText, type CategoryDto, type CreateCategoryInput, type CreateMenuItemInput, type CreateOrderInput, type CreateUserInput, type Locale, type LoginPinInput, type MenuItemDto, type OrderDto, type UpdateOrderStatusInput } from "@ros/shared";
import { demoDownload, demoRequest, isBrowserDemoModeActive, shouldUseBrowserDemoFallback } from "./demo-api";
import type { AdminSummary, RevenueRangeSummary, SessionPayload, TableRefDto } from "./api-types";
import { getConfiguredApiUrl, isLocalDevHost, isNetlifyHost } from "./runtime-mode";

const resolveApiUrl = (configuredUrl?: string) => {
  if (typeof window === "undefined") {
    return configuredUrl ?? "http://localhost:4000";
  }

  const currentHostname = window.location.hostname;
  if (!isLocalDevHost(currentHostname)) {
    // Netlify-hosted builds should bypass the /api rewrite entirely because
    // the direct function path is the most reliable production route.
    if (isNetlifyHost(currentHostname)) {
      return `${window.location.origin}/.netlify/functions/api`;
    }

    return configuredUrl ?? `${window.location.origin}/api`;
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

const configuredApiUrl =
  typeof window === "undefined"
    ? getConfiguredApiUrl()
    : getConfiguredApiUrl(window.location.hostname);
const API_URL = resolveApiUrl(configuredApiUrl);

const getNetlifyFunctionApiUrl = () => {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.origin}/.netlify/functions/api`;
};

const shouldRetryViaNetlifyFunction = (response: Response, apiBase: string) => {
  if (typeof window === "undefined") {
    return false;
  }

  if (isLocalDevHost(window.location.hostname) || apiBase.includes("/.netlify/functions/api")) {
    return false;
  }

  const contentType = response.headers.get("content-type") ?? "";
  return response.status === 404 || contentType.includes("text/html");
};

type ApiEnvelope<T> = { success: boolean; message?: string; data: T };
type RequestOptions = { skipAuthRefresh?: boolean };

const persistentStorageUnavailableMessage = "Persistent storage is unavailable.";

export class ApiClientError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const readCookie = (name: string) => {
  const segment = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return segment?.split("=").slice(1).join("=");
};

const responseBodyContainsPersistentStorageError = (body: string | null) =>
  typeof body === "string" && body.includes(persistentStorageUnavailableMessage);

const createApiError = <T>(response: Response, payload: ApiEnvelope<T> | null, rawBody: string | null) =>
  new ApiClientError(
    payload?.message || (responseBodyContainsPersistentStorageError(rawBody) ? persistentStorageUnavailableMessage : "Request failed"),
    response.status,
    payload ?? rawBody ?? null
  );

const shouldUseBrowserDemoApi = () => isBrowserDemoModeActive();

const sendWithBase = async <T>(apiBase: string, path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const method = (init?.method || "GET").toUpperCase();
  if (!headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCookie("ros_csrf");
    if (csrf) headers.set("x-csrf-token", csrf);
  }

  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    ...init,
    headers
  });

  const rawBody = await response.text().catch(() => "");
  let payload: ApiEnvelope<T> | null = null;

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody) as ApiEnvelope<T>;
    } catch {
      payload = null;
    }
  }

  return { response, payload, rawBody };
};

const send = async <T>(path: string, init?: RequestInit) => {
  const primary = await sendWithBase<T>(API_URL, path, init);
  if (!shouldRetryViaNetlifyFunction(primary.response, API_URL)) {
    return primary;
  }

  const fallbackApiUrl = getNetlifyFunctionApiUrl();
  if (!fallbackApiUrl) {
    return primary;
  }

  return sendWithBase<T>(fallbackApiUrl, path, init);
};

let refreshPromise: Promise<SessionPayload & { accessExpiresIn: number }> | null = null;

const refreshSession = async () => {
  if (!refreshPromise) {
    refreshPromise = request<SessionPayload & { accessExpiresIn: number }>(
      "/auth/refresh",
      { method: "POST" },
      { skipAuthRefresh: true }
    ).finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
};

const request = async <T>(path: string, init?: RequestInit, options?: RequestOptions): Promise<T> => {
  if (shouldUseBrowserDemoApi()) {
    return demoRequest<T>(path, init);
  }

  let response: Response;
  let payload: ApiEnvelope<T> | null;
  let rawBody: string | null = null;

  try {
    ({ response, payload, rawBody } = await send<T>(path, init));
  } catch (error) {
    if (shouldUseBrowserDemoFallback(error)) {
      return demoRequest<T>(path, init);
    }

    throw error;
  }

  if (response.status === 401 && !options?.skipAuthRefresh && path !== "/auth/login-pin" && path !== "/auth/refresh") {
    await refreshSession();

    const retry = await send<T>(path, init);
    if (!retry.response.ok || !retry.payload?.success) {
      throw createApiError(retry.response, retry.payload, retry.rawBody);
    }

    return retry.payload.data;
  }

  if (!response.ok || !payload?.success) {
    throw createApiError(response, payload, rawBody);
  }

  return payload.data;
};

const download = async (path: string, filename: string) => {
  if (shouldUseBrowserDemoApi()) {
    await demoDownload(path, filename);
    return;
  }

  const sendDownload = () =>
    fetch(`${API_URL}${path}`, {
      credentials: "include",
      headers: {
        "x-csrf-token": readCookie("ros_csrf") ?? ""
      }
    });

  let response: Response;

  try {
    response = await sendDownload();
  } catch (error) {
    if (shouldUseBrowserDemoFallback(error)) {
      await demoDownload(path, filename);
      return;
    }

    throw error;
  }

  if (response.status === 401) {
    await refreshSession();
    response = await sendDownload();
  }

  if (!response.ok) {
    throw new Error("Download failed");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export type { AdminSummary, RevenueRangeSummary, SessionPayload, TableRefDto } from "./api-types";
export type AdminUser = SessionPayload["user"] & { isActive: boolean; createdAt: string };
export const isPersistentStorageOutageError = (error: unknown) =>
  error instanceof ApiClientError &&
  (error.message.includes(persistentStorageUnavailableMessage) ||
    (typeof error.details === "string" && error.details.includes(persistentStorageUnavailableMessage)));

export const api = {
  login: (payload: LoginPinInput) => request<SessionPayload & { accessExpiresIn: number }>("/auth/login-pin", { method: "POST", body: JSON.stringify(payload) }),
  me: () => request<SessionPayload>("/auth/me"),
  refresh: () => request<SessionPayload & { accessExpiresIn: number }>("/auth/refresh", { method: "POST" }),
  logout: () => request<{ loggedOut: boolean }>("/auth/logout", { method: "POST" }),
  getMenu: (params?: { locale?: Locale; q?: string; categoryId?: string }) => {
    const query = new URLSearchParams();
    if (params?.locale) query.set("locale", params.locale);
    if (params?.q) query.set("q", params.q);
    if (params?.categoryId) query.set("categoryId", params.categoryId);
    return request<{ locale?: Locale; categories: CategoryDto[]; items: MenuItemDto[] }>(`/menu${query.size ? `?${query.toString()}` : ""}`);
  },
  getCategories: () => request<CategoryDto[]>("/menu/categories"),
  createOrder: (payload: CreateOrderInput) => request<OrderDto>("/orders", { method: "POST", body: JSON.stringify(payload) }),
  cancelOrder: (id: string, note?: string) => request<OrderDto>(`/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ note }) }),
  deleteOrder: (id: string) => request<{ deleted: boolean; orderId: string }>(`/orders/${id}`, { method: "DELETE" }),
  getCurrentOrders: () => request<OrderDto[]>("/orders/current"),
  getOrderHistory: () => request<OrderDto[]>("/orders/history"),
  admin: {
    getOrders: (filters?: { status?: string; q?: string }) => {
      const query = new URLSearchParams();
      if (filters?.status) query.set("status", filters.status);
      if (filters?.q) query.set("q", filters.q);
      return request<OrderDto[]>(`/admin/orders${query.size ? `?${query.toString()}` : ""}`);
    },
    updateOrderStatus: (id: string, payload: UpdateOrderStatusInput) => request<OrderDto>(`/admin/orders/${id}/status`, { method: "PATCH", body: JSON.stringify(payload) }),
    cancelOrder: (id: string, note?: string) => request<OrderDto>(`/admin/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ note }) }),
    deleteOrder: (id: string) => request<{ deleted: boolean }>(`/admin/orders/${id}`, { method: "DELETE" }),
    getSummary: () => request<AdminSummary>("/admin/reports/summary"),
    getRevenueRange: (params: { startAt: string; endAt: string }) => {
      const query = new URLSearchParams({ start: params.startAt, end: params.endAt });
      return request<RevenueRangeSummary>(`/admin/reports/revenue-range?${query.toString()}`);
    },
    downloadOrdersReport: (format: "xlsx" | "pdf", status?: string, q?: string) => {
      const query = new URLSearchParams({ format });
      if (status) query.set("status", status);
      if (q) query.set("q", q);
      return download(`/admin/reports/export?${query.toString()}`, `orders-report.${format}`);
    },
    getMenuItems: () => request<MenuItemDto[]>("/admin/menu-items"),
    createMenuItem: (payload: CreateMenuItemInput) => request<MenuItemDto>("/admin/menu-items", { method: "POST", body: JSON.stringify(payload) }),
    updateMenuItem: (id: string, payload: Partial<CreateMenuItemInput>) => request<MenuItemDto>(`/admin/menu-items/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    deleteMenuItem: (id: string) => request<{ deleted: boolean }>(`/admin/menu-items/${id}`, { method: "DELETE" }),
    getAdminCategories: () => request<CategoryDto[]>("/admin/categories"),
    createCategory: (payload: CreateCategoryInput) => request<CategoryDto>("/admin/categories", { method: "POST", body: JSON.stringify(payload) }),
    updateCategory: (id: string, payload: Partial<CreateCategoryInput>) => request<CategoryDto>(`/admin/categories/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    deleteCategory: (id: string) => request<{ deleted: boolean }>(`/admin/categories/${id}`, { method: "DELETE" }),
    getUsers: () => request<AdminUser[]>("/admin/users"),
    createUser: (payload: CreateUserInput) => request<SessionPayload["user"]>("/admin/users", { method: "POST", body: JSON.stringify(payload) }),
    deleteUser: (id: string) => request<{ deleted: boolean }>(`/admin/users/${id}`, { method: "DELETE" }),
    getActivity: () => request<AdminSummary["recentActivity"]>("/admin/activity"),
    getTables: () => request<TableRefDto[]>("/admin/tables"),
    createTable: (label: string) => request<TableRefDto>("/admin/tables", { method: "POST", body: JSON.stringify({ label }) }),
    deleteTable: (id: string) => request<{ deleted: boolean }>(`/admin/tables/${id}`, { method: "DELETE" }),
    getMediaSignature: () => request<{ timestamp: number; signature: string; apiKey: string; cloudName: string; folder: string }>("/admin/media/signature")
  }
};

export const getLocalizedMenuItem = (item: MenuItemDto, locale: Locale) => {
  const translation = item.translations.find((entry) => entry.locale === locale) || item.translations.find((entry) => entry.locale === "ku") || item.translations[0];
  return {
    name: translation?.name ?? item.slug,
    description: translation?.description ?? ""
  };
};

export const getLocalizedCategoryName = (category: CategoryDto, locale: Locale) => resolveLocalizedText(category.names, locale);
