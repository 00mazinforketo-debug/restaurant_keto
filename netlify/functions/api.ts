import crypto from "node:crypto";
import type { Handler, HandlerEvent, HandlerResponse } from "@netlify/functions";
import { connectLambda, getStore } from "@netlify/blobs";
import {
  createCategorySchema,
  createMenuItemSchema,
  createOrderSchema,
  createUserSchema,
  defaultLocale,
  findFixedLoginAccountByPin,
  fixedLoginAccounts,
  ketoCatalogCategories,
  ketoCatalogMenuItems,
  loginPinSchema,
  updateOrderStatusSchema,
  type CategoryDto,
  type CreateOrderInput,
  type Locale,
  type MenuItemDto,
  type OrderDto
} from "@ros/shared";
import type { AdminSummary, RevenueRangeSummary, SessionPayload, TableRefDto } from "../../apps/web/src/lib/api-types.js";

const appStoreName = "ros-system-delivery";
const stateBlobKey = "state/app-state.json";
const authCookies = { access: "ros_access", refresh: "ros_refresh", csrf: "ros_csrf" } as const;
const accessCookieMaxAgeMs = 1000 * 60 * 15;
const refreshCookieMaxAgeMs = 1000 * 60 * 60 * 24 * 7;
const sessionIdleTimeoutMs = 1000 * 60 * 30;
const allowedStaticPaths = ["/healthz", "/readyz"];

type DemoUser = SessionPayload["user"] & {
  pin: string;
  isActive: boolean;
  createdAt: string;
};

type PersistedSession = {
  token: string;
  userId: string;
  csrfToken: string;
  lastActiveAt: number;
  rememberMe: boolean;
  createdAt: string;
};

type PersistedState = {
  users: DemoUser[];
  categories: CategoryDto[];
  menuItems: MenuItemDto[];
  tables: TableRefDto[];
  orders: OrderDto[];
  activity: AdminSummary["recentActivity"];
  sessions: PersistedSession[];
};

type PersistedStore = {
  get: (key: string, options?: { type?: "json" }) => Promise<unknown | null>;
  setJSON: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

type BlobFallbackRuntime = {
  store: Map<string, unknown>;
  warned: boolean;
};

type LambdaCompatibilityEvent = Parameters<typeof connectLambda>[0];

type AuthContext = {
  state: PersistedState;
  user: DemoUser;
  session: PersistedSession;
  store: PersistedStore;
};

class ApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();
const clone = <T>(value: T): T => structuredClone(value);
const createOrderCode = () => {
  const date = new Date();
  return `ORD-${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${Math.floor(Math.random() * 9000 + 1000)}`;
};

const parseCookies = (header?: string | null) =>
  Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const [name, ...rest] = segment.split("=");
        return [name, decodeURIComponent(rest.join("="))];
      })
  );

const serializeCookie = (name: string, value: string, options: { maxAgeMs: number; httpOnly?: boolean; secure?: boolean }) => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(options.maxAgeMs / 1000)}`
  ];

  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");

  return parts.join("; ");
};

const clearCookie = (name: string, secure: boolean) =>
  [`${name}=`, "Path=/", "SameSite=Lax", "Expires=Thu, 01 Jan 1970 00:00:00 GMT", secure ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");

const jsonResponse = (statusCode: number, data: unknown, message?: string, cookies: string[] = []): HandlerResponse => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8" },
  multiValueHeaders: cookies.length ? { "set-cookie": cookies } : undefined,
  body: JSON.stringify({ success: statusCode < 400, message, data })
});

const fileResponse = (filename: string, body: string, contentType: string): HandlerResponse => ({
  statusCode: 200,
  headers: {
    "content-type": contentType,
    "content-disposition": `attachment; filename="${filename}"`
  },
  body
});

const getProtocolSecure = (event: HandlerEvent) => {
  const forwardedProto = event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"];
  if (forwardedProto) return forwardedProto.includes("https");

  try {
    return new URL(event.rawUrl).protocol === "https:";
  } catch {
    return true;
  }
};

const normalizePath = (pathname: string) => {
  for (const prefix of ["/api", "/.netlify/functions/api"]) {
    if (pathname === prefix) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }

  return pathname || "/";
};

const createFixedUsers = (): DemoUser[] =>
  fixedLoginAccounts.map((account) => ({
    ...account,
    isActive: true,
    createdAt: nowIso()
  }));

const buildInitialState = (): PersistedState => {
  const categories: CategoryDto[] = ketoCatalogCategories.map((category) => ({
    id: category.id,
    slug: category.slug,
    names: category.names,
    icon: category.icon,
    sortOrder: category.sortOrder
  }));

  const categoryNamesById = new Map(categories.map((category) => [category.id, clone(category.names)]));

  const menuItems: MenuItemDto[] = ketoCatalogMenuItems.map((item) => ({
    id: item.id,
    slug: item.slug,
    categoryId: item.categoryId,
    categoryNames: categoryNamesById.get(item.categoryId) ?? { ku: "پۆل" },
    basePrice: item.basePrice,
    imageUrl: item.imageUrl,
    imagePublicId: null,
    isAvailable: item.isAvailable,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt || nowIso(),
    translations: item.translations
  }));

  const tables: TableRefDto[] = [
    { id: "table-1", label: "T1", qrToken: "table-t1", isActive: true, createdAt: nowIso(), updatedAt: nowIso() },
    { id: "table-2", label: "T2", qrToken: "table-t2", isActive: true, createdAt: nowIso(), updatedAt: nowIso() }
  ];

  return {
    users: createFixedUsers(),
    categories,
    menuItems,
    tables,
    orders: [],
    activity: [],
    sessions: []
  };
};

const syncFixedUsers = (state: PersistedState) => {
  let didChange = false;

  for (const account of fixedLoginAccounts) {
    const existingUser = state.users.find((entry) => entry.id === account.id || entry.pin === account.pin);

    if (!existingUser) {
      state.users.push({
        ...account,
        isActive: true,
        createdAt: nowIso()
      });
      didChange = true;
      continue;
    }

    if (
      existingUser.displayName !== account.displayName ||
      existingUser.role !== account.role ||
      existingUser.preferredLocale !== account.preferredLocale ||
      existingUser.pin !== account.pin ||
      !existingUser.isActive
    ) {
      existingUser.displayName = account.displayName;
      existingUser.role = account.role;
      existingUser.preferredLocale = account.preferredLocale;
      existingUser.pin = account.pin;
      existingUser.isActive = true;
      didChange = true;
    }
  }

  return didChange;
};

const purgeExpiredSessions = (state: PersistedState) => {
  const now = Date.now();
  const nextSessions = state.sessions.filter((session) => now - session.lastActiveAt < sessionIdleTimeoutMs);
  const didChange = nextSessions.length !== state.sessions.length;
  state.sessions = nextSessions;
  return didChange;
};

const getBlobFallbackRuntime = () => {
  const globalState = globalThis as typeof globalThis & {
    __rosBlobFallbackRuntime__?: BlobFallbackRuntime;
  };

  if (!globalState.__rosBlobFallbackRuntime__) {
    globalState.__rosBlobFallbackRuntime__ = {
      store: new Map<string, unknown>(),
      warned: false
    };
  }

  return globalState.__rosBlobFallbackRuntime__;
};

const warnBlobFallbackOnce = (message: string, error: unknown) => {
  const runtime = getBlobFallbackRuntime();
  if (runtime.warned) {
    return;
  }

  runtime.warned = true;
  console.warn(message, error);
};

const getFallbackStore = (): PersistedStore => {
  const runtime = getBlobFallbackRuntime();
  const cache = runtime.store;

  return {
    get: async (key) => (cache.has(key) ? clone(cache.get(key)) : null),
    setJSON: async (key, value) => {
      cache.set(key, clone(value));
    },
    delete: async (key) => {
      cache.delete(key);
    }
  };
};

const createResilientStore = (blobStore: ReturnType<typeof getStore>): PersistedStore => {
  const fallbackStore = getFallbackStore();
  let prefersFallback = false;

  const runWithFallback = async <T>(operation: () => Promise<T>, fallbackOperation: () => Promise<T>) => {
    if (prefersFallback) {
      return fallbackOperation();
    }

    try {
      return await operation();
    } catch (error) {
      prefersFallback = true;
      warnBlobFallbackOnce("[netlify-api] blob storage unavailable, using fallback store", error);
      return fallbackOperation();
    }
  };

  return {
    get: (key, options) =>
      runWithFallback(
        () => blobStore.get(key, options as { type?: "json" }),
        () => fallbackStore.get(key, options)
      ),
    setJSON: async (key, value) => {
      await runWithFallback(
        async () => {
          await blobStore.setJSON(key, value);
        },
        () => fallbackStore.setJSON(key, value)
      );
    },
    delete: async (key) => {
      await runWithFallback(
        async () => {
          await blobStore.delete(key);
        },
        () => fallbackStore.delete(key)
      );
    }
  };
};

const isHostedNetlifyEvent = (event: HandlerEvent) =>
  Boolean(
    event.headers["x-nf-request-id"] ||
      event.headers["X-Nf-Request-Id"] ||
      event.headers["x-nf-site-id"] ||
      event.headers["X-Nf-Site-Id"]
  );

const createBlobLambdaEvent = (event: HandlerEvent, blobsContext: string): LambdaCompatibilityEvent => ({
  blobs: blobsContext,
  headers: Object.fromEntries(
    Object.entries(event.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  )
});

const getBlobStore = (event: HandlerEvent): PersistedStore => {
  const lambdaEvent = event as HandlerEvent & { blobs?: string };
  const blobsContext = typeof lambdaEvent.blobs === "string" && lambdaEvent.blobs.length > 0 ? lambdaEvent.blobs : null;

  if (blobsContext) {
    connectLambda(createBlobLambdaEvent(event, blobsContext));
  }

  try {
    return createResilientStore(getStore(appStoreName));
  } catch (error) {
    if (isHostedNetlifyEvent(event)) {
      console.error("[netlify-api] unable to initialize blob store in hosted Netlify environment", error);
      throw new ApiError("Persistent storage is unavailable.", 500);
    }

    warnBlobFallbackOnce("[netlify-api] unable to initialize blob store, using fallback store", error);
    return getFallbackStore();
  }
};

const saveState = async (store: PersistedStore, state: PersistedState) => {
  await store.setJSON(stateBlobKey, state);
  return state;
};

const loadState = async (store: PersistedStore) => {
  const stored = (await store.get(stateBlobKey, { type: "json" })) as PersistedState | null;
  if (!stored) {
    const initialState = buildInitialState();
    await saveState(store, initialState);
    return initialState;
  }

  const didSyncUsers = syncFixedUsers(stored);
  const didPurgeSessions = purgeExpiredSessions(stored);
  if (didSyncUsers || didPurgeSessions) {
    await saveState(store, stored);
  }

  return stored;
};

const pushActivity = (
  state: PersistedState,
  actorName: string,
  actorRole: SessionPayload["user"]["role"],
  action: string,
  entityType: string
) => {
  state.activity.unshift({
    id: createId(),
    actorName,
    actorRole,
    action,
    entityType,
    createdAt: nowIso()
  });
  state.activity = state.activity.slice(0, 100);
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
const startOfWeek = (date: Date) => {
  const value = startOfDay(date);
  value.setDate(value.getDate() - value.getDay());
  return value;
};
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);

const isWithinRange = (value: string, startAt: Date, endAt: Date) => {
  const timestamp = new Date(value).getTime();
  return timestamp >= startAt.getTime() && timestamp <= endAt.getTime();
};

const getRevenueRangeSummary = (state: PersistedState, startAt: Date, endAt: Date): RevenueRangeSummary => {
  const deliveredOrders = state.orders.filter((order) => order.status === "DELIVERED" && isWithinRange(order.placedAt, startAt, endAt));
  const revenue = deliveredOrders.reduce((sum, order) => sum + order.totalPrice, 0);

  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    deliveredOrders: deliveredOrders.length,
    revenue,
    averageOrderValue: deliveredOrders.length ? revenue / deliveredOrders.length : 0
  };
};

const getSummary = (state: PersistedState): AdminSummary => {
  const now = new Date();
  const activeOrders = state.orders.filter((order) => ["PENDING", "PREPARING", "READY"].includes(order.status)).length;
  const deliveredOrders = state.orders.filter((order) => order.status === "DELIVERED").length;

  return {
    summary: {
      totalOrders: state.orders.length,
      activeOrders,
      deliveredOrders,
      revenueToday: getRevenueRangeSummary(state, startOfDay(now), now).revenue,
      revenueWeek: getRevenueRangeSummary(state, startOfWeek(now), now).revenue,
      revenueMonth: getRevenueRangeSummary(state, startOfMonth(now), now).revenue
    },
    recentActivity: state.activity.slice(0, 20)
  };
};

const validateBody = <T>(schema: { parse: (input: unknown) => T }, payload: unknown) => {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      const firstIssue = (error as { issues?: Array<{ message?: string }> }).issues?.[0];
      throw new ApiError(firstIssue?.message || "Invalid request body.", 400);
    }
    throw error;
  }
};

const getFilteredMenuItems = (state: PersistedState, params: { categoryId?: string | null; q?: string | null }) => {
  const query = params.q?.trim().toLowerCase() ?? "";

  return state.menuItems
    .filter((item) => !params.categoryId || item.categoryId === params.categoryId)
    .filter((item) => {
      if (!query) {
        return true;
      }

      return item.translations.some((translation) =>
        `${translation.name} ${translation.description}`.toLowerCase().includes(query)
      );
    });
};

const parseJsonBody = (event: HandlerEvent) => {
  if (!event.body) {
    return {};
  }

  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
    return JSON.parse(body) as unknown;
  } catch {
    throw new ApiError("Invalid JSON body.", 400);
  }
};

const touchSession = (session: PersistedSession) => {
  session.lastActiveAt = Date.now();
};

const requireAuth = async (event: HandlerEvent, store: PersistedStore): Promise<AuthContext> => {
  const state = await loadState(store);
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
  const token = cookies[authCookies.access];

  if (!token) {
    throw new ApiError("Unauthorized", 401);
  }

  const session = state.sessions.find((entry) => entry.token === token);
  if (!session) {
    throw new ApiError("Unauthorized", 401);
  }

  if (Date.now() - session.lastActiveAt >= sessionIdleTimeoutMs) {
    state.sessions = state.sessions.filter((entry) => entry.token !== token);
    await saveState(store, state);
    throw new ApiError("Session expired due to inactivity.", 401);
  }

  const user = state.users.find((entry) => entry.id === session.userId && entry.isActive);
  if (!user) {
    state.sessions = state.sessions.filter((entry) => entry.token !== token);
    await saveState(store, state);
    throw new ApiError("Unauthorized", 401);
  }

  // Do not persist session heartbeats on read requests. The admin dashboard polls
  // aggressively, and rewriting the whole shared state blob on every GET causes
  // stale reads to clobber newly created orders.
  touchSession(session);

  return { state, user, session, store };
};

const requireRole = (auth: AuthContext, role: SessionPayload["user"]["role"]) => {
  if (auth.user.role !== role) {
    throw new ApiError("Forbidden", 403);
  }

  return auth;
};

const setAuthCookies = (token: string, csrfToken: string, secure: boolean) => [
  serializeCookie(authCookies.access, token, { maxAgeMs: accessCookieMaxAgeMs, httpOnly: true, secure }),
  serializeCookie(authCookies.refresh, token, { maxAgeMs: refreshCookieMaxAgeMs, httpOnly: true, secure }),
  serializeCookie(authCookies.csrf, csrfToken, { maxAgeMs: refreshCookieMaxAgeMs, secure })
];

const clearAuthCookies = (secure: boolean) => [
  clearCookie(authCookies.access, secure),
  clearCookie(authCookies.refresh, secure),
  clearCookie(authCookies.csrf, secure)
];

const findOrder = (state: PersistedState, orderId: string) => {
  const order = state.orders.find((entry) => entry.id === orderId);
  if (!order) {
    throw new ApiError("Order not found.", 404);
  }

  return order;
};

const updateCategoryNames = (state: PersistedState, categoryId: string) => {
  const category = state.categories.find((entry) => entry.id === categoryId);
  if (!category) {
    return;
  }

  for (const menuItem of state.menuItems) {
    if (menuItem.categoryId === categoryId) {
      menuItem.categoryNames = clone(category.names);
    }
  }
};

const getEmployeeFolderKey = (order: OrderDto) => {
  if (order.submittedByUserId) {
    return order.submittedByUserId;
  }

  if (order.submittedByName) {
    return encodeURIComponent(order.submittedByName);
  }

  return "unknown";
};

const persistOrderSnapshot = async (store: PersistedStore, order: OrderDto) => {
  const employeeFolder = getEmployeeFolderKey(order);
  await Promise.all([
    store.setJSON(`orders/all/${order.id}.json`, order),
    store.setJSON(`orders/by-employee/${employeeFolder}/${order.id}.json`, order)
  ]);
};

const removeOrderSnapshot = async (store: PersistedStore, order: OrderDto) => {
  const employeeFolder = getEmployeeFolderKey(order);
  await Promise.all([
    store.delete(`orders/all/${order.id}.json`),
    store.delete(`orders/by-employee/${employeeFolder}/${order.id}.json`)
  ]);
};

const persistOrderDeletionAudit = async (
  store: PersistedStore,
  order: OrderDto,
  deletedBy: string,
  reason: string
) => {
  await store.setJSON(`orders/archive/${order.id}.json`, {
    ...order,
    auditDeletedAt: nowIso(),
    auditDeletedBy: deletedBy,
    auditReason: reason
  });
};

const createOrderSnapshot = (state: PersistedState, payload: CreateOrderInput, user: DemoUser): OrderDto => {
  const items = payload.items.map((line) => {
    const menuItem = state.menuItems.find((entry) => entry.id === line.menuItemId);
    if (!menuItem) {
      throw new ApiError("Menu item not found.", 404);
    }
    if (!menuItem.isAvailable) {
      throw new ApiError("Menu item is not available.", 400);
    }

    const category = state.categories.find((entry) => entry.id === menuItem.categoryId);
    const kuTranslation = menuItem.translations.find((entry) => entry.locale === "ku") ?? menuItem.translations[0];

    return {
      menuItemId: menuItem.id,
      quantity: line.quantity,
      unitPrice: menuItem.basePrice,
      totalPrice: menuItem.basePrice * line.quantity,
      nameKu: kuTranslation?.name ?? menuItem.slug,
      categoryNameKu: category?.names.ku ?? "پۆل"
    };
  });

  const timestamp = nowIso();
  const totalPrice = items.reduce((sum, entry) => sum + entry.totalPrice, 0);

  return {
    id: createId(),
    orderCode: createOrderCode(),
    customerNameKu: payload.customerNameKu,
    customerPhone: payload.customerPhone,
    customerAddressKu: payload.customerAddressKu,
    notesKu: payload.notesKu || null,
    tableLabel: payload.tableLabel || null,
    submittedByName: user.displayName,
    submittedByUserId: user.id,
    status: "PENDING",
    totalPrice,
    placedAt: timestamp,
    updatedAt: timestamp,
    items,
    statusHistory: [
      {
        status: "PENDING",
        changedAt: timestamp,
        changedBy: user.displayName,
        note: "Order received"
      }
    ]
  };
};

const getOrdersExport = (
  orders: OrderDto[],
  format: "xlsx" | "pdf"
): { filename: string; body: string; contentType: string } => {
  if (format === "pdf") {
    const body = orders
      .map((order) =>
        [
          `Order: ${order.orderCode}`,
          `Customer: ${order.customerNameKu}`,
          `Phone: ${order.customerPhone}`,
          `Employee: ${order.submittedByName ?? "-"}`,
          `Status: ${order.status}`,
          `Total: ${order.totalPrice}`,
          `Placed At: ${order.placedAt}`,
          `Items: ${order.items.map((item) => `${item.nameKu} x${item.quantity}`).join(", ") || "-"}`,
          ""
        ].join("\n")
      )
      .join("\n");

    return {
      filename: "orders-report.pdf",
      body,
      contentType: "application/pdf"
    };
  }

  const header = ["Order Code", "Customer Name", "Phone", "Employee", "Status", "Total", "Placed At", "Items"];
  const rows = orders.map((order) =>
    [
      order.orderCode,
      order.customerNameKu,
      order.customerPhone,
      order.submittedByName ?? "",
      order.status,
      String(order.totalPrice),
      order.placedAt,
      order.items.map((item) => `${item.nameKu} x${item.quantity}`).join(" | ")
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(",")
  );

  return {
    filename: "orders-report.xlsx",
    body: [header.join(","), ...rows].join("\n"),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
};

export const handler: Handler = async (event) => {
  const secure = getProtocolSecure(event);
  const store = getBlobStore(event);
  const pathname = normalizePath(new URL(event.rawUrl).pathname);
  const method = (event.httpMethod || "GET").toUpperCase();

  try {
    if (method === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "access-control-allow-origin": event.headers.origin || "*",
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "content-type, x-csrf-token"
        }
      };
    }

    if (method === "GET" && allowedStaticPaths.includes(pathname)) {
      const status = pathname === "/healthz" ? "ok" : "ready";
      return jsonResponse(200, { status, mode: "netlify" });
    }

    if (pathname === "/auth/login-pin" && method === "POST") {
      const payload = validateBody(loginPinSchema, parseJsonBody(event));
      const fixedAccount = findFixedLoginAccountByPin(payload.pin);
      if (!fixedAccount) {
        throw new ApiError("Invalid PIN.", 401);
      }

      const state = await loadState(store);
      let user = state.users.find((entry) => entry.id === fixedAccount.id || entry.pin === fixedAccount.pin);
      if (!user) {
        user = {
          ...fixedAccount,
          isActive: true,
          createdAt: nowIso()
        };
        state.users.push(user);
      } else {
        user.displayName = fixedAccount.displayName;
        user.role = fixedAccount.role;
        user.preferredLocale = fixedAccount.preferredLocale;
        user.pin = fixedAccount.pin;
        user.isActive = true;
      }

      state.sessions = state.sessions.filter((session) => session.userId !== user.id);
      const token = createId();
      const csrfToken = createId();
      state.sessions.push({
        token,
        userId: user.id,
        csrfToken,
        lastActiveAt: Date.now(),
        rememberMe: payload.rememberMe,
        createdAt: nowIso()
      });
      pushActivity(state, user.displayName, user.role, "AUTH_LOGIN", "Session");
      await saveState(store, state);

      return jsonResponse(
        200,
        {
          user: {
            id: user.id,
            displayName: user.displayName,
            role: user.role,
            preferredLocale: user.preferredLocale
          },
          csrfToken,
          accessExpiresIn: Math.floor(accessCookieMaxAgeMs / 1000)
        },
        undefined,
        setAuthCookies(token, csrfToken, secure)
      );
    }

    if (pathname === "/auth/refresh" && method === "POST") {
      const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
      const refreshToken = cookies[authCookies.refresh];
      const state = await loadState(store);
      const session = refreshToken ? state.sessions.find((entry) => entry.token === refreshToken) : null;

      if (!session) {
        return jsonResponse(401, null, "Unauthorized", clearAuthCookies(secure));
      }

      if (Date.now() - session.lastActiveAt >= sessionIdleTimeoutMs) {
        state.sessions = state.sessions.filter((entry) => entry.token !== session.token);
        await saveState(store, state);
        return jsonResponse(401, null, "Session expired due to inactivity.", clearAuthCookies(secure));
      }

      const user = state.users.find((entry) => entry.id === session.userId && entry.isActive);
      if (!user) {
        state.sessions = state.sessions.filter((entry) => entry.token !== session.token);
        await saveState(store, state);
        return jsonResponse(401, null, "Unauthorized", clearAuthCookies(secure));
      }

      touchSession(session);
      await saveState(store, state);

      return jsonResponse(
        200,
        {
          user: {
            id: user.id,
            displayName: user.displayName,
            role: user.role,
            preferredLocale: user.preferredLocale
          },
          csrfToken: session.csrfToken,
          accessExpiresIn: Math.floor(accessCookieMaxAgeMs / 1000)
        },
        undefined,
        setAuthCookies(session.token, session.csrfToken, secure)
      );
    }

    if (pathname === "/auth/me" && method === "GET") {
      const auth = await requireAuth(event, store);
      return jsonResponse(200, {
        user: {
          id: auth.user.id,
          displayName: auth.user.displayName,
          role: auth.user.role,
          preferredLocale: auth.user.preferredLocale
        }
      });
    }

    if (pathname === "/auth/logout" && method === "POST") {
      const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
      const accessToken = cookies[authCookies.access];
      const refreshToken = cookies[authCookies.refresh];
      const state = await loadState(store);
      const nextSessions = state.sessions.filter((session) => session.token !== accessToken && session.token !== refreshToken);
      if (nextSessions.length !== state.sessions.length) {
        state.sessions = nextSessions;
        await saveState(store, state);
      }

      return jsonResponse(200, { loggedOut: true }, "Logged out.", clearAuthCookies(secure));
    }

    if (pathname === "/menu" && method === "GET") {
      const state = await loadState(store);
      const locale = (new URL(event.rawUrl).searchParams.get("locale") as Locale | null) ?? defaultLocale;
      const searchParams = new URL(event.rawUrl).searchParams;
      const items = getFilteredMenuItems(state, {
        categoryId: searchParams.get("categoryId"),
        q: searchParams.get("q")
      });
      return jsonResponse(200, {
        locale,
        categories: clone(state.categories),
        items: clone(items)
      });
    }

    if (pathname === "/menu/categories" && method === "GET") {
      const state = await loadState(store);
      return jsonResponse(200, clone(state.categories));
    }

    if (pathname === "/orders" && method === "POST") {
      const auth = requireRole(await requireAuth(event, store), "CUSTOMER");
      const payload = validateBody(createOrderSchema, parseJsonBody(event));
      const order = createOrderSnapshot(auth.state, payload, auth.user);
      auth.state.orders.unshift(order);
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "ORDER_CREATED", "Order");
      await saveState(auth.store, auth.state);
      await persistOrderSnapshot(auth.store, order);
      return jsonResponse(201, clone(order), "Order placed successfully.");
    }

    if (pathname === "/orders/current" && method === "GET") {
      const auth = requireRole(await requireAuth(event, store), "CUSTOMER");
      const orders = auth.state.orders.filter(
        (order) => order.submittedByUserId === auth.user.id && ["PENDING", "PREPARING", "READY"].includes(order.status)
      );
      return jsonResponse(200, clone(orders));
    }

    if (pathname === "/orders/history" && method === "GET") {
      const auth = requireRole(await requireAuth(event, store), "CUSTOMER");
      const orders = auth.state.orders.filter(
        (order) => order.submittedByUserId === auth.user.id || order.submittedByName === auth.user.displayName
      );
      return jsonResponse(200, clone(orders));
    }

    const customerCancelMatch = pathname.match(/^\/orders\/([^/]+)\/cancel$/);
    if (customerCancelMatch && method === "POST") {
      const auth = requireRole(await requireAuth(event, store), "CUSTOMER");
      const order = findOrder(auth.state, customerCancelMatch[1]!);
      if (order.submittedByUserId !== auth.user.id) {
        throw new ApiError("Order not found.", 404);
      }
      if (order.status !== "PENDING") {
        throw new ApiError("Only pending orders can be cancelled by the customer.", 400);
      }

      order.status = "CANCELLED";
      order.updatedAt = nowIso();
      order.statusHistory.push({
        status: "CANCELLED",
        changedAt: nowIso(),
        changedBy: auth.user.displayName,
        note: "Cancelled by customer"
      });
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "ORDER_CANCELLED", "Order");
      await saveState(auth.store, auth.state);
      await persistOrderSnapshot(auth.store, order);
      return jsonResponse(200, clone(order));
    }

    const customerDeleteMatch = pathname.match(/^\/orders\/([^/]+)$/);
    if (customerDeleteMatch && method === "DELETE") {
      const auth = requireRole(await requireAuth(event, store), "CUSTOMER");
      const order = findOrder(auth.state, customerDeleteMatch[1]!);
      if (order.submittedByUserId !== auth.user.id) {
        throw new ApiError("Order not found.", 404);
      }
      if (!["PENDING", "CANCELLED"].includes(order.status)) {
        throw new ApiError("Only pending or cancelled orders can be deleted.", 400);
      }

      auth.state.orders = auth.state.orders.filter((entry) => entry.id !== order.id);
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "ORDER_DELETED", "Order");
      await saveState(auth.store, auth.state);
      await removeOrderSnapshot(auth.store, order);
      await persistOrderDeletionAudit(auth.store, order, auth.user.displayName, "Deleted by customer");
      return jsonResponse(200, { deleted: true, orderId: order.id });
    }

    if (pathname === "/admin/reports/summary" && method === "GET") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      return jsonResponse(200, clone(getSummary(auth.state)));
    }

    if (pathname === "/admin/reports/revenue-range" && method === "GET") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const searchParams = new URL(event.rawUrl).searchParams;
      const start = searchParams.get("start");
      const end = searchParams.get("end");
      const startAt = start ? new Date(start) : null;
      const endAt = end ? new Date(end) : null;
      if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        throw new ApiError("Invalid revenue range.", 400);
      }
      if (endAt.getTime() < startAt.getTime()) {
        throw new ApiError("End date must be on or after start date.", 400);
      }

      return jsonResponse(200, clone(getRevenueRangeSummary(auth.state, startAt, endAt)));
    }

    if (pathname === "/admin/reports/export" && method === "GET") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const searchParams = new URL(event.rawUrl).searchParams;
      const format = searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
      const status = searchParams.get("status");
      const query = searchParams.get("q")?.trim().toLowerCase() ?? "";
      const orders = auth.state.orders.filter((order) => {
        const matchesStatus = !status || order.status === status;
        const haystack = `${order.orderCode} ${order.customerNameKu} ${order.customerPhone} ${order.customerAddressKu} ${order.submittedByName ?? ""}`.toLowerCase();
        const matchesQuery = !query || haystack.includes(query);
        return matchesStatus && matchesQuery;
      });
      const exportFile = getOrdersExport(orders, format);
      return fileResponse(exportFile.filename, exportFile.body, exportFile.contentType);
    }

    if (pathname === "/admin/activity" && method === "GET") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      return jsonResponse(200, clone(auth.state.activity));
    }

    if (pathname === "/admin/orders" && method === "GET") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const searchParams = new URL(event.rawUrl).searchParams;
      const status = searchParams.get("status");
      const query = searchParams.get("q")?.trim().toLowerCase() ?? "";
      const orders = auth.state.orders.filter((order) => {
        const matchesStatus = !status || order.status === status;
        const haystack = `${order.orderCode} ${order.customerNameKu} ${order.customerPhone} ${order.customerAddressKu} ${order.submittedByName ?? ""}`.toLowerCase();
        const matchesQuery = !query || haystack.includes(query);
        return matchesStatus && matchesQuery;
      });
      return jsonResponse(200, clone(orders));
    }

    const adminStatusMatch = pathname.match(/^\/admin\/orders\/([^/]+)\/status$/);
    if (adminStatusMatch && method === "PATCH") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const payload = validateBody(updateOrderStatusSchema, parseJsonBody(event));
      const order = findOrder(auth.state, adminStatusMatch[1]!);
      if (["DELIVERED", "CANCELLED"].includes(order.status)) {
        throw new ApiError("Order is already completed.", 400);
      }

      order.status = payload.status;
      order.updatedAt = nowIso();
      order.statusHistory.push({
        status: payload.status,
        changedAt: nowIso(),
        changedBy: auth.user.displayName,
        note: payload.note ?? null
      });
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "ORDER_STATUS_UPDATED", "Order");
      await saveState(auth.store, auth.state);
      await persistOrderSnapshot(auth.store, order);
      return jsonResponse(200, clone(order));
    }

    const adminCancelMatch = pathname.match(/^\/admin\/orders\/([^/]+)\/cancel$/);
    if (adminCancelMatch && method === "POST") {
      throw new ApiError("Admin order cancellation is disabled. Use the next status action only.", 400);
    }

    const adminDeleteMatch = pathname.match(/^\/admin\/orders\/([^/]+)$/);
    if (adminDeleteMatch && method === "DELETE") {
      throw new ApiError("Admin order deletion is disabled. Use the next status action only.", 400);
    }

    if (pathname === "/admin/menu-items" && method === "GET") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      return jsonResponse(200, clone(auth.state.menuItems));
    }

    if (pathname === "/admin/menu-items" && method === "POST") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const payload = validateBody(createMenuItemSchema, parseJsonBody(event));
      const category = auth.state.categories.find((entry) => entry.id === payload.categoryId);
      if (!category) {
        throw new ApiError("Category not found.", 404);
      }

      const menuItem: MenuItemDto = {
        id: createId(),
        slug: payload.slug,
        categoryId: payload.categoryId,
        categoryNames: clone(category.names),
        basePrice: Number(payload.basePrice),
        imageUrl: payload.imageUrl ?? null,
        imagePublicId: payload.imagePublicId ?? null,
        isAvailable: Boolean(payload.isAvailable ?? true),
        sortOrder: Number(payload.sortOrder ?? 0),
        createdAt: nowIso(),
        translations: clone(payload.translations)
      };

      auth.state.menuItems.unshift(menuItem);
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "MENU_ITEM_CREATED", "MenuItem");
      await saveState(auth.store, auth.state);
      return jsonResponse(201, clone(menuItem));
    }

    const adminMenuItemMatch = pathname.match(/^\/admin\/menu-items\/([^/]+)$/);
    if (adminMenuItemMatch && method === "PATCH") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const menuItem = auth.state.menuItems.find((entry) => entry.id === adminMenuItemMatch[1]!);
      if (!menuItem) {
        throw new ApiError("Menu item not found.", 404);
      }

      const payload = parseJsonBody(event) as Partial<ReturnType<typeof createMenuItemSchema.parse>>;
      if (payload.slug !== undefined) {
        menuItem.slug = String(payload.slug).trim();
      }
      if (payload.categoryId !== undefined) {
        const category = auth.state.categories.find((entry) => entry.id === payload.categoryId);
        if (!category) {
          throw new ApiError("Category not found.", 404);
        }
        menuItem.categoryId = payload.categoryId;
        menuItem.categoryNames = clone(category.names);
      }
      if (payload.basePrice !== undefined) {
        menuItem.basePrice = Number(payload.basePrice);
      }
      if (payload.imageUrl !== undefined) {
        menuItem.imageUrl = payload.imageUrl ?? null;
      }
      if (payload.imagePublicId !== undefined) {
        menuItem.imagePublicId = payload.imagePublicId ?? null;
      }
      if (payload.isAvailable !== undefined) {
        menuItem.isAvailable = Boolean(payload.isAvailable);
      }
      if (payload.sortOrder !== undefined) {
        menuItem.sortOrder = Number(payload.sortOrder) || 0;
      }
      if (payload.translations !== undefined) {
        const parsedTranslations = validateBody(
          createMenuItemSchema.pick({ translations: true }),
          { translations: payload.translations }
        );
        menuItem.translations = clone(parsedTranslations.translations);
      }

      pushActivity(auth.state, auth.user.displayName, auth.user.role, "MENU_ITEM_UPDATED", "MenuItem");
      await saveState(auth.store, auth.state);
      return jsonResponse(200, clone(menuItem));
    }

    if (adminMenuItemMatch && method === "DELETE") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const existing = auth.state.menuItems.find((entry) => entry.id === adminMenuItemMatch[1]!);
      if (!existing) {
        throw new ApiError("Menu item not found.", 404);
      }
      auth.state.menuItems = auth.state.menuItems.filter((entry) => entry.id !== existing.id);
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "MENU_ITEM_DELETED", "MenuItem");
      await saveState(auth.store, auth.state);
      return jsonResponse(200, { deleted: true });
    }

    if (pathname === "/admin/categories" && method === "GET") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      return jsonResponse(200, clone(auth.state.categories));
    }

    if (pathname === "/admin/categories" && method === "POST") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const payload = validateBody(createCategorySchema, parseJsonBody(event));
      const category: CategoryDto = {
        id: createId(),
        slug: payload.slug,
        names: clone(payload.names),
        icon: payload.icon ?? null,
        sortOrder: Number(payload.sortOrder ?? 0)
      };
      auth.state.categories.unshift(category);
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "CATEGORY_CREATED", "Category");
      await saveState(auth.store, auth.state);
      return jsonResponse(201, clone(category));
    }

    const adminCategoryMatch = pathname.match(/^\/admin\/categories\/([^/]+)$/);
    if (adminCategoryMatch && method === "PATCH") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const category = auth.state.categories.find((entry) => entry.id === adminCategoryMatch[1]!);
      if (!category) {
        throw new ApiError("Category not found.", 404);
      }

      const payload = parseJsonBody(event) as Partial<ReturnType<typeof createCategorySchema.parse>>;
      if (payload.slug !== undefined) {
        category.slug = String(payload.slug).trim();
      }
      if (payload.names !== undefined) {
        const parsedNames = validateBody(createCategorySchema.pick({ names: true }), { names: payload.names });
        category.names = { ...category.names, ...parsedNames.names };
      }
      if (payload.icon !== undefined) {
        category.icon = payload.icon ?? null;
      }
      if (payload.sortOrder !== undefined) {
        category.sortOrder = Number(payload.sortOrder) || 0;
      }

      updateCategoryNames(auth.state, category.id);
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "CATEGORY_UPDATED", "Category");
      await saveState(auth.store, auth.state);
      return jsonResponse(200, clone(category));
    }

    if (adminCategoryMatch && method === "DELETE") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      if (auth.state.menuItems.some((entry) => entry.categoryId === adminCategoryMatch[1]!)) {
        throw new ApiError("Delete menu items in this category first.", 400);
      }
      auth.state.categories = auth.state.categories.filter((entry) => entry.id !== adminCategoryMatch[1]!);
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "CATEGORY_DELETED", "Category");
      await saveState(auth.store, auth.state);
      return jsonResponse(200, { deleted: true });
    }

    if (pathname === "/admin/users" && method === "GET") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      return jsonResponse(
        200,
        auth.state.users.map(({ pin, ...user }) => ({ ...user }))
      );
    }

    if (pathname === "/admin/users" && method === "POST") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const payload = validateBody(createUserSchema, parseJsonBody(event));
      if (auth.state.users.some((entry) => entry.pin === payload.pin)) {
        throw new ApiError("PIN already exists.", 400);
      }

      const user: DemoUser = {
        id: createId(),
        displayName: payload.displayName,
        pin: payload.pin,
        role: payload.role,
        preferredLocale: payload.preferredLocale,
        isActive: true,
        createdAt: nowIso()
      };
      auth.state.users.unshift(user);
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "USER_CREATED", "User");
      await saveState(auth.store, auth.state);
      return jsonResponse(201, {
        id: user.id,
        displayName: user.displayName,
        role: user.role,
        preferredLocale: user.preferredLocale
      });
    }

    const adminUserMatch = pathname.match(/^\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && method === "DELETE") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const user = auth.state.users.find((entry) => entry.id === adminUserMatch[1]!);
      if (!user) {
        throw new ApiError("User not found.", 404);
      }
      user.isActive = false;
      auth.state.sessions = auth.state.sessions.filter((session) => session.userId !== user.id);
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "USER_DEACTIVATED", "User");
      await saveState(auth.store, auth.state);
      return jsonResponse(200, { deleted: true });
    }

    if (pathname === "/admin/tables" && method === "GET") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      return jsonResponse(200, clone(auth.state.tables));
    }

    if (pathname === "/admin/tables" && method === "POST") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      const payload = parseJsonBody(event) as { label?: string };
      const label = String(payload.label ?? "").trim();
      if (!label) {
        throw new ApiError("Table label is required.", 400);
      }

      const table: TableRefDto = {
        id: createId(),
        label,
        qrToken: createId(),
        isActive: true,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      auth.state.tables.unshift(table);
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "TABLE_CREATED", "Table");
      await saveState(auth.store, auth.state);
      return jsonResponse(201, clone(table));
    }

    const adminTableMatch = pathname.match(/^\/admin\/tables\/([^/]+)$/);
    if (adminTableMatch && method === "DELETE") {
      const auth = requireRole(await requireAuth(event, store), "ADMIN");
      auth.state.tables = auth.state.tables.filter((entry) => entry.id !== adminTableMatch[1]!);
      pushActivity(auth.state, auth.user.displayName, auth.user.role, "TABLE_DELETED", "Table");
      await saveState(auth.store, auth.state);
      return jsonResponse(200, { deleted: true });
    }

    if (pathname === "/admin/media/signature" && method === "GET") {
      requireRole(await requireAuth(event, store), "ADMIN");
      return jsonResponse(200, {
        timestamp: Date.now(),
        signature: "netlify-demo-signature",
        apiKey: "netlify-demo-key",
        cloudName: "netlify-demo-cloud",
        folder: "system-delivery"
      });
    }

    return jsonResponse(404, null, `Endpoint not found: ${method} ${pathname}`);
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse(error.status, null, error.message, error.status === 401 ? clearAuthCookies(secure) : []);
    }

    console.error("[netlify-api] unexpected error", error);
    return jsonResponse(500, null, "Internal server error");
  }
};
