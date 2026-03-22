import { defaultLocale, findFixedLoginAccountByPin, fixedLoginAccounts, ketoCatalogCategories, ketoCatalogMenuItems, orderStatuses, type CategoryDto, type CreateCategoryInput, type CreateMenuItemInput, type CreateOrderInput, type CreateUserInput, type Locale, type MenuItemDto, type OrderDto, type OrderStatus, type UpdateOrderStatusInput } from "@ros/shared";
import type { AdminSummary, RevenueRangeSummary, SessionPayload, TableRefDto } from "./api-types";

const demoStateStorageKey = "ros-browser-demo-state-v1";
const demoSessionStorageKey = "ros-browser-demo-session-v1";
const demoModeStorageKey = "ros-browser-demo-mode";
const demoCookieName = "ros_csrf";

type DemoUser = SessionPayload["user"] & {
  pin: string;
  isActive: boolean;
  createdAt: string;
};

type DemoSession = {
  token: string;
  userId: string;
  csrfToken: string;
  lastActiveAt: number;
  rememberMe: boolean;
};

type DemoState = {
  users: DemoUser[];
  categories: CategoryDto[];
  menuItems: MenuItemDto[];
  tables: TableRefDto[];
  orders: OrderDto[];
  activity: AdminSummary["recentActivity"];
};

export class DemoApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const hasBrowser = typeof window !== "undefined";

const localHostnames = new Set(["127.0.0.1", "localhost"]);

const isLocalHost = () => hasBrowser && localHostnames.has(window.location.hostname);

const nowIso = () => new Date().toISOString();

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createOrderCode = () => {
  const value = new Date();
  return `ORD-${String(value.getFullYear()).slice(-2)}${String(value.getMonth() + 1).padStart(2, "0")}${String(value.getDate()).padStart(2, "0")}-${Math.floor(Math.random() * 9000 + 1000)}`;
};

const clone = <T>(value: T): T => structuredClone(value);

const createFixedDemoUsers = (): DemoUser[] =>
  fixedLoginAccounts.map((account) => ({ ...account, isActive: true, createdAt: nowIso() }));

const buildInitialState = (): DemoState => {
  const categories: CategoryDto[] = ketoCatalogCategories.map((category) => ({
    id: category.id,
    slug: category.slug,
    names: category.names,
    icon: category.icon,
    sortOrder: category.sortOrder
  }));

  const users = createFixedDemoUsers();

  const categoryNames = (categoryId: string) => categories.find((entry) => entry.id === categoryId)?.names ?? { ku: "پۆل" };

  const menuItems: MenuItemDto[] = ketoCatalogMenuItems.map((item) => ({
    id: item.id,
    slug: item.slug,
    categoryId: item.categoryId,
    categoryNames: categoryNames(item.categoryId),
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
    users,
    categories,
    menuItems,
    tables,
    orders: [],
    activity: []
  };
};

const readStorage = <T>(key: string): T | null => {
  if (!hasBrowser) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: unknown) => {
  if (!hasBrowser) return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

const loadState = () => {
  const state = readStorage<DemoState>(demoStateStorageKey);
  if (state) {
    const baseUsers = createFixedDemoUsers();
    const migratedOrders = state.orders.map((order) => {
      const firstStatusEvent = order.statusHistory[0];
      const matchingUser = state.users.find((entry) => entry.displayName === firstStatusEvent?.changedBy);
      return {
        ...order,
        submittedByName: order.submittedByName ?? matchingUser?.displayName ?? firstStatusEvent?.changedBy ?? null,
        submittedByUserId: order.submittedByUserId ?? matchingUser?.id ?? null
      };
    });
    const migratedState: DemoState = { ...state, users: baseUsers, orders: migratedOrders };
    writeStorage(demoStateStorageKey, migratedState);
    return migratedState;
  }
  const initial = buildInitialState();
  writeStorage(demoStateStorageKey, initial);
  return initial;
};

const saveState = (state: DemoState) => {
  writeStorage(demoStateStorageKey, state);
  return state;
};

const loadSession = () => readStorage<DemoSession>(demoSessionStorageKey);

const setCookie = (value: string) => {
  if (!hasBrowser) return;
  document.cookie = `${demoCookieName}=${value}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
};

const clearCookie = () => {
  if (!hasBrowser) return;
  document.cookie = `${demoCookieName}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
};

const saveSession = (session: DemoSession | null) => {
  if (!hasBrowser) return;
  if (!session) {
    window.localStorage.removeItem(demoSessionStorageKey);
    window.localStorage.removeItem(demoModeStorageKey);
    clearCookie();
    return;
  }
  writeStorage(demoSessionStorageKey, session);
  window.localStorage.setItem(demoModeStorageKey, "true");
  setCookie(session.csrfToken);
};

const requireSession = () => {
  const session = loadSession();
  if (!session) throw new DemoApiError("Unauthorized", 401);

  const state = loadState();
  const user = state.users.find((entry) => entry.id === session.userId && entry.isActive);
  if (!user) {
    saveSession(null);
    throw new DemoApiError("Unauthorized", 401);
  }

  session.lastActiveAt = Date.now();
  saveSession(session);
  return { state, session, user };
};

const requireAdmin = () => {
  const auth = requireSession();
  if (auth.user.role !== "ADMIN") throw new DemoApiError("Forbidden", 403);
  return auth;
};

const pushActivity = (state: DemoState, actorName: string, actorRole: "CUSTOMER" | "ADMIN", action: string, entityType: string) => {
  state.activity.unshift({ id: createId(), actorName, actorRole, action, entityType, createdAt: nowIso() });
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

const getRevenueRangeSummary = (state: DemoState, startAt: Date, endAt: Date): RevenueRangeSummary => {
  const delivered = state.orders.filter((entry) => entry.status === "DELIVERED" && isWithinRange(entry.placedAt, startAt, endAt));
  const revenue = delivered.reduce((sum, entry) => sum + entry.totalPrice, 0);

  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    deliveredOrders: delivered.length,
    revenue,
    averageOrderValue: delivered.length ? revenue / delivered.length : 0
  };
};

const getSummary = (state: DemoState): AdminSummary => {
  const now = new Date();
  const delivered = state.orders.filter((entry) => entry.status === "DELIVERED");
  const active = state.orders.filter((entry) => ["PENDING", "PREPARING", "READY"].includes(entry.status));
  return {
    summary: {
      totalOrders: state.orders.length,
      activeOrders: active.length,
      deliveredOrders: delivered.length,
      revenueToday: getRevenueRangeSummary(state, startOfDay(now), now).revenue,
      revenueWeek: getRevenueRangeSummary(state, startOfWeek(now), now).revenue,
      revenueMonth: getRevenueRangeSummary(state, startOfMonth(now), now).revenue
    },
    recentActivity: state.activity.slice(0, 20)
  };
};

const parseJsonBody = <T>(init?: RequestInit) => {
  if (!init?.body || typeof init.body !== "string") return {} as T;
  return JSON.parse(init.body) as T;
};

const findOrder = (state: DemoState, id: string) => {
  const order = state.orders.find((entry) => entry.id === id);
  if (!order) throw new DemoApiError("Order not found.", 404);
  return order;
};

const updateCategoryNames = (state: DemoState, categoryId: string) => {
  const category = state.categories.find((entry) => entry.id === categoryId);
  if (!category) return;
  for (const item of state.menuItems) {
    if (item.categoryId === categoryId) {
      item.categoryNames = clone(category.names);
    }
  }
};

const createOrderSnapshot = (state: DemoState, payload: CreateOrderInput, user: DemoUser): OrderDto => {
  const items = payload.items.map((line) => {
    const menuItem = state.menuItems.find((entry) => entry.id === line.menuItemId);
    if (!menuItem) throw new DemoApiError("Menu item not found.", 404);
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

  const totalPrice = items.reduce((sum, entry) => sum + entry.totalPrice, 0);
  const timestamp = nowIso();

  return {
    id: createId(),
    orderCode: createOrderCode(),
    submittedByName: user.displayName,
    submittedByUserId: user.id,
    customerNameKu: payload.customerNameKu,
    customerPhone: payload.customerPhone,
    customerAddressKu: payload.customerAddressKu,
    notesKu: payload.notesKu || null,
    tableLabel: payload.tableLabel || null,
    status: "PENDING",
    totalPrice,
    placedAt: timestamp,
    updatedAt: timestamp,
    items,
    statusHistory: [{ status: "PENDING", changedAt: timestamp, changedBy: user.displayName, note: "Order received" }]
  };
};

const createOrderDownloadBlob = (state: DemoState) => {
  const content = JSON.stringify(state.orders, null, 2);
  return new Blob([content], { type: "application/json" });
};

const triggerDownload = (blob: Blob, filename: string) => {
  if (!hasBrowser) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const isBrowserDemoModeActive = () =>
  hasBrowser && isLocalHost() && window.localStorage.getItem(demoModeStorageKey) === "true";

export const shouldUseBrowserDemoFallback = (error: unknown) =>
  isLocalHost() &&
  (error instanceof TypeError ||
    (error instanceof Error &&
      /(Failed to fetch|NetworkError|ERR_CONNECTION_REFUSED|Load failed|fetch)/i.test(error.message)));

export const demoRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const url = new URL(path, "http://demo.local");
  const method = (init?.method || "GET").toUpperCase();
  const body = parseJsonBody<Record<string, unknown>>(init);

  if (url.pathname === "/auth/login-pin" && method === "POST") {
    const payload = body as unknown as { pin: string; rememberMe?: boolean };
    const state = loadState();
    const fixedAccount = findFixedLoginAccountByPin(payload.pin);
    if (!fixedAccount) throw new DemoApiError("Invalid PIN.", 401);
    let user = state.users.find((entry) => entry.pin === fixedAccount.pin && entry.isActive);
    if (!user) {
      user = { ...fixedAccount, isActive: true, createdAt: nowIso() };
      state.users = [...state.users, user];
    } else {
      user.displayName = fixedAccount.displayName;
      user.role = fixedAccount.role;
      user.preferredLocale = fixedAccount.preferredLocale;
      user.isActive = true;
    }
    const session: DemoSession = { token: createId(), userId: user.id, csrfToken: createId(), lastActiveAt: Date.now(), rememberMe: Boolean(payload.rememberMe) };
    saveSession(session);
    pushActivity(state, user.displayName, user.role, "AUTH_LOGIN", "Session");
    saveState(state);
    return { user: { id: user.id, displayName: user.displayName, role: user.role, preferredLocale: user.preferredLocale }, csrfToken: session.csrfToken, accessExpiresIn: 900 } as T;
  }

  if (url.pathname === "/auth/me" && method === "GET") {
    const { user } = requireSession();
    return { user: { id: user.id, displayName: user.displayName, role: user.role, preferredLocale: user.preferredLocale } } as T;
  }

  if (url.pathname === "/auth/refresh" && method === "POST") {
    const { session, user } = requireSession();
    session.lastActiveAt = Date.now();
    saveSession(session);
    return { user: { id: user.id, displayName: user.displayName, role: user.role, preferredLocale: user.preferredLocale }, csrfToken: session.csrfToken, accessExpiresIn: 900 } as T;
  }

  if (url.pathname === "/auth/logout" && method === "POST") {
    saveSession(null);
    return { loggedOut: true } as T;
  }

  if (url.pathname === "/menu" && method === "GET") {
    const state = loadState();
    const locale = (url.searchParams.get("locale") as Locale | null) ?? defaultLocale;
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const categoryId = url.searchParams.get("categoryId");
    const items = state.menuItems
      .filter((entry) => !categoryId || entry.categoryId === categoryId)
      .filter((entry) => {
        if (!q) return true;
        return entry.translations.some((translation) => `${translation.name} ${translation.description}`.toLowerCase().includes(q));
      });
    return { locale, categories: clone(state.categories), items: clone(items) } as T;
  }

  if (url.pathname === "/menu/categories" && method === "GET") {
    return clone(loadState().categories) as T;
  }

  if (url.pathname === "/orders" && method === "POST") {
    const { state, user } = requireSession();
    if (user.role !== "CUSTOMER") throw new DemoApiError("Forbidden", 403);
    const order = createOrderSnapshot(state, body as unknown as CreateOrderInput, user);
    state.orders.unshift(order);
    pushActivity(state, user.displayName, user.role, "ORDER_CREATED", "Order");
    saveState(state);
    return clone(order) as T;
  }

  if (url.pathname === "/orders/current" && method === "GET") {
    const { state, user } = requireSession();
    return clone(state.orders.filter((entry) => entry.submittedByUserId === user.id && entry.status !== "DELIVERED" && entry.status !== "CANCELLED")) as T;
  }

  if (url.pathname === "/orders/history" && method === "GET") {
    const { state, user } = requireSession();
    if (user.role !== "CUSTOMER") throw new DemoApiError("Forbidden", 403);
    return clone(state.orders.filter((entry) => entry.submittedByUserId === user.id || entry.submittedByName === user.displayName)) as T;
  }

  if (url.pathname.match(/^\/orders\/[^/]+\/cancel$/) && method === "POST") {
    const { state, user } = requireSession();
    if (user.role !== "CUSTOMER") throw new DemoApiError("Forbidden", 403);
    const id = url.pathname.split("/")[2] ?? "";
    const order = findOrder(state, id);
    if (order.status !== "PENDING") {
      throw new DemoApiError("Only pending orders can be cancelled by the customer.", 400);
    }
    order.status = "CANCELLED";
    order.updatedAt = nowIso();
    order.statusHistory.push({ status: "CANCELLED", changedAt: nowIso(), changedBy: user.displayName, note: "Cancelled by customer" });
    pushActivity(state, user.displayName, user.role, "ORDER_CANCELLED", "Order");
    saveState(state);
    return clone(order) as T;
  }

  if (url.pathname.match(/^\/orders\/[^/]+$/) && method === "DELETE") {
    const { state, user } = requireSession();
    if (user.role !== "CUSTOMER") throw new DemoApiError("Forbidden", 403);
    const id = url.pathname.split("/")[2] ?? "";
    const order = findOrder(state, id);
    if (!["PENDING", "CANCELLED"].includes(order.status)) {
      throw new DemoApiError("Only pending or cancelled orders can be deleted.", 400);
    }
    state.orders = state.orders.filter((entry) => entry.id !== id);
    pushActivity(state, user.displayName, user.role, "ORDER_DELETED", "Order");
    saveState(state);
    return { deleted: true, orderId: id } as T;
  }

  if (url.pathname === "/admin/reports/summary" && method === "GET") {
    const { state } = requireAdmin();
    return clone(getSummary(state)) as T;
  }

  if (url.pathname === "/admin/reports/revenue-range" && method === "GET") {
    const { state } = requireAdmin();
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const startAt = start ? new Date(start) : null;
    const endAt = end ? new Date(end) : null;
    if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new DemoApiError("Invalid revenue range.", 400);
    }
    if (endAt.getTime() < startAt.getTime()) {
      throw new DemoApiError("End date must be on or after start date.", 400);
    }
    return clone(getRevenueRangeSummary(state, startAt, endAt)) as T;
  }

  if (url.pathname === "/admin/activity" && method === "GET") {
    const { state } = requireAdmin();
    return clone(state.activity) as T;
  }

  if (url.pathname === "/admin/orders" && method === "GET") {
    const { state } = requireAdmin();
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q")?.toLowerCase() ?? "";
    const orders = state.orders.filter((entry) => {
      const matchesStatus = !status || entry.status === status;
      const haystack = `${entry.orderCode} ${entry.customerNameKu} ${entry.customerPhone} ${entry.customerAddressKu} ${entry.submittedByName ?? ""}`.toLowerCase();
      const matchesQuery = !q || haystack.includes(q);
      return matchesStatus && matchesQuery;
    });
    return clone(orders) as T;
  }

  if (url.pathname.match(/^\/admin\/orders\/[^/]+\/status$/) && method === "PATCH") {
    const { state, user } = requireAdmin();
    const id = url.pathname.split("/")[3] ?? "";
    const payload = body as unknown as UpdateOrderStatusInput;
    const order = findOrder(state, id);
    order.status = payload.status;
    order.updatedAt = nowIso();
    order.statusHistory.push({ status: payload.status, changedAt: nowIso(), changedBy: user.displayName, note: payload.note ?? null });
    pushActivity(state, user.displayName, user.role, "ORDER_STATUS_UPDATED", "Order");
    saveState(state);
    return clone(order) as T;
  }

  if (url.pathname.match(/^\/admin\/orders\/[^/]+\/cancel$/) && method === "POST") {
    const { state, user } = requireAdmin();
    const id = url.pathname.split("/")[3] ?? "";
    const order = findOrder(state, id);
    order.status = "CANCELLED";
    order.updatedAt = nowIso();
    order.statusHistory.push({ status: "CANCELLED", changedAt: nowIso(), changedBy: user.displayName, note: (body.note as string | undefined) ?? null });
    pushActivity(state, user.displayName, user.role, "ORDER_CANCELLED", "Order");
    saveState(state);
    return clone(order) as T;
  }

  if (url.pathname.match(/^\/admin\/orders\/[^/]+$/) && method === "DELETE") {
    const { state } = requireAdmin();
    const id = url.pathname.split("/")[3] ?? "";
    const index = state.orders.findIndex((entry) => entry.id === id);
    if (index === -1) throw new DemoApiError("Order not found.", 404);
    state.orders.splice(index, 1);
    saveState(state);
    return { deleted: true } as T;
  }

  if (url.pathname === "/admin/menu-items" && method === "GET") {
    const { state } = requireAdmin();
    return clone(state.menuItems) as T;
  }

  if (url.pathname === "/admin/menu-items" && method === "POST") {
    const { state } = requireAdmin();
    const payload = body as unknown as CreateMenuItemInput;
    const category = state.categories.find((entry) => entry.id === payload.categoryId);
    const item: MenuItemDto = {
      id: createId(),
      slug: payload.slug,
      categoryId: payload.categoryId,
      categoryNames: clone(category?.names ?? { ku: "پۆل" }),
      basePrice: Number(payload.basePrice),
      imageUrl: payload.imageUrl ?? null,
      imagePublicId: payload.imagePublicId ?? null,
      isAvailable: Boolean(payload.isAvailable ?? true),
      sortOrder: Number(payload.sortOrder ?? 0),
      createdAt: nowIso(),
      translations: clone(payload.translations)
    };
    state.menuItems.unshift(item);
    saveState(state);
    return clone(item) as T;
  }

  if (url.pathname.match(/^\/admin\/menu-items\/[^/]+$/) && method === "PATCH") {
    const { state } = requireAdmin();
    const id = url.pathname.split("/")[3] ?? "";
    const item = state.menuItems.find((entry) => entry.id === id);
    if (!item) throw new DemoApiError("Menu item not found.", 404);
    const payload = body as Partial<CreateMenuItemInput>;
    if (payload.slug !== undefined) item.slug = payload.slug;
    if (payload.categoryId !== undefined) {
      item.categoryId = payload.categoryId;
      item.categoryNames = clone(state.categories.find((entry) => entry.id === payload.categoryId)?.names ?? { ku: "پۆل" });
    }
    if (payload.basePrice !== undefined) item.basePrice = Number(payload.basePrice);
    if (payload.imageUrl !== undefined) item.imageUrl = payload.imageUrl ?? null;
    if (payload.imagePublicId !== undefined) item.imagePublicId = payload.imagePublicId ?? null;
    if (payload.isAvailable !== undefined) item.isAvailable = payload.isAvailable;
    if (payload.sortOrder !== undefined) item.sortOrder = Number(payload.sortOrder);
    if (payload.translations !== undefined) item.translations = clone(payload.translations);
    saveState(state);
    return clone(item) as T;
  }

  if (url.pathname.match(/^\/admin\/menu-items\/[^/]+$/) && method === "DELETE") {
    const { state } = requireAdmin();
    const id = url.pathname.split("/")[3] ?? "";
    state.menuItems = state.menuItems.filter((entry) => entry.id !== id);
    saveState(state);
    return { deleted: true } as T;
  }

  if (url.pathname === "/admin/categories" && method === "GET") {
    const { state } = requireAdmin();
    return clone(state.categories) as T;
  }

  if (url.pathname === "/admin/categories" && method === "POST") {
    const { state } = requireAdmin();
    const payload = body as unknown as CreateCategoryInput;
    const category: CategoryDto = {
      id: createId(),
      slug: payload.slug,
      names: clone(payload.names),
      icon: payload.icon ?? null,
      sortOrder: Number(payload.sortOrder ?? 0)
    };
    state.categories.unshift(category);
    saveState(state);
    return clone(category) as T;
  }

  if (url.pathname.match(/^\/admin\/categories\/[^/]+$/) && method === "PATCH") {
    const { state } = requireAdmin();
    const id = url.pathname.split("/")[3] ?? "";
    const category = state.categories.find((entry) => entry.id === id);
    if (!category) throw new DemoApiError("Category not found.", 404);
    const payload = body as Partial<CreateCategoryInput>;
    if (payload.slug !== undefined) category.slug = payload.slug;
    if (payload.names !== undefined) category.names = { ...category.names, ...payload.names };
    if (payload.icon !== undefined) category.icon = payload.icon ?? null;
    if (payload.sortOrder !== undefined) category.sortOrder = Number(payload.sortOrder);
    updateCategoryNames(state, category.id);
    saveState(state);
    return clone(category) as T;
  }

  if (url.pathname.match(/^\/admin\/categories\/[^/]+$/) && method === "DELETE") {
    const { state } = requireAdmin();
    const id = url.pathname.split("/")[3] ?? "";
    state.categories = state.categories.filter((entry) => entry.id !== id);
    saveState(state);
    return { deleted: true } as T;
  }

  if (url.pathname === "/admin/users" && method === "GET") {
    const { state } = requireAdmin();
    return clone(state.users.map(({ pin, ...user }) => user)) as T;
  }

  if (url.pathname === "/admin/users" && method === "POST") {
    const { state } = requireAdmin();
    const payload = body as unknown as CreateUserInput;
    const user: DemoUser = {
      id: createId(),
      displayName: payload.displayName,
      pin: payload.pin,
      role: payload.role,
      preferredLocale: payload.preferredLocale,
      isActive: true,
      createdAt: nowIso()
    };
    state.users.unshift(user);
    saveState(state);
    return clone({ id: user.id, displayName: user.displayName, role: user.role, preferredLocale: user.preferredLocale }) as T;
  }

  if (url.pathname.match(/^\/admin\/users\/[^/]+$/) && method === "DELETE") {
    const { state } = requireAdmin();
    const id = url.pathname.split("/")[3] ?? "";
    const user = state.users.find((entry) => entry.id === id);
    if (user) user.isActive = false;
    saveState(state);
    return { deleted: true } as T;
  }

  if (url.pathname === "/admin/tables" && method === "GET") {
    const { state } = requireAdmin();
    return clone(state.tables) as T;
  }

  if (url.pathname === "/admin/tables" && method === "POST") {
    const { state } = requireAdmin();
    const label = String(body.label ?? "");
    const table: TableRefDto = { id: createId(), label, qrToken: createId(), isActive: true, createdAt: nowIso(), updatedAt: nowIso() };
    state.tables.unshift(table);
    saveState(state);
    return clone(table) as T;
  }

  if (url.pathname.match(/^\/admin\/tables\/[^/]+$/) && method === "DELETE") {
    const { state } = requireAdmin();
    const id = url.pathname.split("/")[3] ?? "";
    state.tables = state.tables.filter((entry) => entry.id !== id);
    saveState(state);
    return { deleted: true } as T;
  }

  if (url.pathname === "/admin/media/signature" && method === "GET") {
    requireAdmin();
    return { timestamp: Date.now(), signature: "demo-signature", apiKey: "demo-key", cloudName: "demo-cloud", folder: "demo-folder" } as T;
  }

  throw new DemoApiError(`Demo endpoint not implemented: ${method} ${url.pathname}`, 404);
};

export const demoDownload = async (path: string, filename: string) => {
  const url = new URL(path, "http://demo.local");
  if (url.pathname !== "/admin/reports/export") {
    throw new DemoApiError("Download failed", 400);
  }
  const { state } = requireAdmin();
  triggerDownload(createOrderDownloadBlob(state), filename);
};
