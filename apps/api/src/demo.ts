import http from "node:http";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { defaultLocale, findFixedLoginAccountByPin, fixedLoginAccounts, ketoCatalogCategories, ketoCatalogMenuItems, orderStatuses, socketEvents, type Locale, type OrderStatus, type UserRole } from "@ros/shared";

const port = 4001;
const localWebOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173"
];
const webOrigins = Array.from(new Set([process.env.WEB_ORIGIN, ...localWebOrigins].filter(Boolean))) as string[];
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const privateIpPattern = /^(10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/;
const authCookies = { access: "ros_access", refresh: "ros_refresh", csrf: "ros_csrf" } as const;
const sessionIdleTimeoutMs = 1000 * 60 * 30;
const sessionTouchThrottleMs = 1000 * 60;
const accessCookieMaxAgeMs = 1000 * 60 * 15;
const refreshCookieMaxAgeMs = 1000 * 60 * 60 * 24 * 7;

type DemoUser = {
  id: string;
  displayName: string;
  role: UserRole;
  preferredLocale: Locale;
  pin: string;
  isActive: boolean;
  createdAt: string;
};

type DemoCategory = {
  id: string;
  slug: string;
  names: { ku: string; ar?: string; fa?: string; en?: string; tr?: string };
  icon: string | null;
  sortOrder: number;
};

type DemoMenuItem = {
  id: string;
  slug: string;
  categoryId: string;
  basePrice: number;
  imageUrl: string | null;
  imagePublicId: string | null;
  isAvailable: boolean;
  sortOrder: number;
  createdAt: string;
  translations: Array<{ locale: Locale; name: string; description: string }>;
};

type DemoOrder = {
  id: string;
  orderCode: string;
  userId: string;
  submittedByName: string;
  submittedByUserId: string;
  customerNameKu: string;
  customerPhone: string;
  customerAddressKu: string;
  notesKu: string | null;
  tableLabel: string | null;
  status: OrderStatus;
  totalPrice: number;
  placedAt: string;
  updatedAt: string;
  items: Array<{ menuItemId: string; quantity: number; unitPrice: number; totalPrice: number; nameKu: string; categoryNameKu: string }>;
  statusHistory: Array<{ status: OrderStatus; changedAt: string; changedBy: string | null; note: string | null }>;
};

type DemoActivity = { id: string; actorName: string; actorRole: UserRole; action: string; entityType: string; createdAt: string };
type DemoTable = { id: string; label: string; qrToken: string; isActive: boolean; createdAt: string; updatedAt: string };

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();
const createOrderCode = () => {
  const date = new Date();
  return `ORD-${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${Math.floor(Math.random() * 9000 + 1000)}`;
};

const users: DemoUser[] = fixedLoginAccounts.map((account) => ({ ...account, isActive: true, createdAt: nowIso() }));

const categories: DemoCategory[] = ketoCatalogCategories.map((category) => ({
  id: category.id,
  slug: category.slug,
  names: category.names,
  icon: category.icon,
  sortOrder: category.sortOrder
}));

const menuItems: DemoMenuItem[] = ketoCatalogMenuItems.map((item) => ({
  id: item.id,
  slug: item.slug,
  categoryId: item.categoryId,
  basePrice: item.basePrice,
  imageUrl: item.imageUrl,
  imagePublicId: null,
  isAvailable: item.isAvailable,
  sortOrder: item.sortOrder,
  createdAt: item.createdAt || nowIso(),
  translations: item.translations
}));

const tables: DemoTable[] = [
  { id: "table-1", label: "T1", qrToken: "table-t1", isActive: true, createdAt: nowIso(), updatedAt: nowIso() },
  { id: "table-2", label: "T2", qrToken: "table-t2", isActive: true, createdAt: nowIso(), updatedAt: nowIso() }
];

const orders: DemoOrder[] = [];
const activity: DemoActivity[] = [];
const sessions = new Map<string, { userId: string; csrfToken: string; lastActiveAt: number }>();

const pushActivity = (actorName: string, actorRole: UserRole, action: string, entityType: string) => {
  activity.unshift({ id: createId(), actorName, actorRole, action, entityType, createdAt: nowIso() });
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

const isLocalDevHost = (hostname: string) => localHosts.has(hostname) || privateIpPattern.test(hostname);

const isAllowedOrigin = (origin?: string) => {
  if (!origin) {
    return true;
  }

  if (webOrigins.includes(origin)) {
    return true;
  }

  try {
    const parsedOrigin = new URL(origin);
    return ["http:", "https:"].includes(parsedOrigin.protocol) && ["5173", "4173"].includes(parsedOrigin.port) && isLocalDevHost(parsedOrigin.hostname);
  } catch {
    return false;
  }
};

const resolveCorsOrigin: cors.CorsOptions["origin"] = (origin, callback) => {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error("Not allowed by CORS"));
};

const getRevenueRangeSummary = (startAt: Date, endAt: Date) => {
  const delivered = orders.filter((order) => order.status === "DELIVERED" && isWithinRange(order.placedAt, startAt, endAt));
  const revenue = delivered.reduce((sum, order) => sum + order.totalPrice, 0);

  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    deliveredOrders: delivered.length,
    revenue,
    averageOrderValue: delivered.length ? revenue / delivered.length : 0
  };
};

const getSummary = () => {
  const now = new Date();
  const delivered = orders.filter((order) => order.status === "DELIVERED");
  const active = orders.filter((order) => ["PENDING", "PREPARING", "READY"].includes(order.status));
  const revenueToday = getRevenueRangeSummary(startOfDay(now), now).revenue;
  const revenueWeek = getRevenueRangeSummary(startOfWeek(now), now).revenue;
  const revenueMonth = getRevenueRangeSummary(startOfMonth(now), now).revenue;
  return {
    summary: {
      totalOrders: orders.length,
      activeOrders: active.length,
      deliveredOrders: delivered.length,
      revenueToday,
      revenueWeek,
      revenueMonth
    },
    recentActivity: activity.slice(0, 20)
  };
};

const getFilteredMenuItems = (params: { categoryId?: string; q?: string }) => {
  const normalizedQuery = params.q?.trim().toLowerCase() ?? "";

  return menuItems
    .filter((item) => !params.categoryId || item.categoryId === params.categoryId)
    .filter((item) => {
      if (!normalizedQuery) {
        return true;
      }

      return item.translations.some((translation) =>
        `${translation.name} ${translation.description}`.toLowerCase().includes(normalizedQuery)
      );
    });
};

const accessCookieOptions = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: accessCookieMaxAgeMs };
const refreshCookieOptions = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: refreshCookieMaxAgeMs };
const publicCookieOptions = { sameSite: "lax" as const, path: "/", maxAge: refreshCookieMaxAgeMs };

export const startDemoServer = (portArg = port) => {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: resolveCorsOrigin, credentials: true } });

  app.use(cors({ origin: resolveCorsOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  const isSessionIdle = (lastActiveAt: number) => Date.now() - lastActiveAt >= sessionIdleTimeoutMs;

  const touchSession = (session: { lastActiveAt: number }) => {
    if (Date.now() - session.lastActiveAt >= sessionTouchThrottleMs) {
      session.lastActiveAt = Date.now();
    }
  };

  const getSessionUser = (request: express.Request) => {
    const token = request.cookies?.[authCookies.access] as string | undefined;
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (isSessionIdle(session.lastActiveAt)) {
      sessions.delete(token);
      return null;
    }
    const user = users.find((entry) => entry.id === session.userId && entry.isActive);
    if (!user) return null;
    touchSession(session);
    return { token, session, user };
  };

  const requireAuth = (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const auth = getSessionUser(request);
    if (!auth) {
      response.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    (request as express.Request & { demoUser?: DemoUser }).demoUser = auth.user;
    next();
  };

  const requireRole = (role: UserRole) => (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const user = (request as express.Request & { demoUser?: DemoUser }).demoUser;
    if (!user || user.role !== role) {
      response.status(403).json({ success: false, message: "Forbidden" });
      return;
    }
    next();
  };

  const ok = (response: express.Response, data: unknown, message?: string, status = 200) => response.status(status).json({ success: true, message, data });

  app.get("/healthz", (_request, response) => ok(response, { status: "ok", mode: "demo" }));
  app.get("/readyz", (_request, response) => ok(response, { status: "ready", mode: "demo" }));

app.post("/auth/login-pin", (request, response) => {
  const { pin } = request.body as { pin?: string };
  const fixedAccount = pin ? findFixedLoginAccountByPin(pin) : null;
  if (!fixedAccount) {
    response.status(401).json({ success: false, message: "Invalid PIN." });
    return;
  }
  let user = users.find((entry) => entry.pin === fixedAccount.pin && entry.isActive);
  if (!user) {
    user = { ...fixedAccount, isActive: true, createdAt: nowIso() };
    users.push(user);
  } else {
    user.displayName = fixedAccount.displayName;
    user.role = fixedAccount.role;
    user.preferredLocale = fixedAccount.preferredLocale;
    user.isActive = true;
  }
  const token = createId();
  const csrfToken = createId();
  sessions.set(token, { userId: user.id, csrfToken, lastActiveAt: Date.now() });
  response.cookie(authCookies.access, token, accessCookieOptions);
  response.cookie(authCookies.refresh, token, refreshCookieOptions);
  response.cookie(authCookies.csrf, csrfToken, publicCookieOptions);
  pushActivity(user.displayName, user.role, "AUTH_LOGIN", "Session");
  ok(response, { user: { id: user.id, displayName: user.displayName, role: user.role, preferredLocale: user.preferredLocale }, csrfToken, accessExpiresIn: 900 });
});

app.post("/auth/refresh", (request, response) => {
  const token = request.cookies?.[authCookies.refresh] as string | undefined;
  const session = token ? sessions.get(token) : null;
  const expiredByInactivity = Boolean(session && isSessionIdle(session.lastActiveAt));
  if (!token || !session || expiredByInactivity) {
    if (token) sessions.delete(token);
    response.clearCookie(authCookies.access, { path: "/" });
    response.clearCookie(authCookies.refresh, { path: "/" });
    response.clearCookie(authCookies.csrf, { path: "/" });
    response.status(401).json({ success: false, message: expiredByInactivity ? "Session expired due to inactivity." : "Unauthorized" });
    return;
  }
  const user = users.find((entry) => entry.id === session.userId);
  if (!user) {
    response.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  session.lastActiveAt = Date.now();
  response.cookie(authCookies.access, token, accessCookieOptions);
  response.cookie(authCookies.refresh, token, refreshCookieOptions);
  response.cookie(authCookies.csrf, session.csrfToken, publicCookieOptions);
  ok(response, { user: { id: user.id, displayName: user.displayName, role: user.role, preferredLocale: user.preferredLocale }, csrfToken: session.csrfToken, accessExpiresIn: 900 });
});

app.get("/auth/me", requireAuth, (request, response) => {
  const user = (request as express.Request & { demoUser: DemoUser }).demoUser;
  ok(response, { user: { id: user.id, displayName: user.displayName, role: user.role, preferredLocale: user.preferredLocale } });
});

app.post("/auth/logout", requireAuth, (request, response) => {
  const token = request.cookies?.[authCookies.access] as string | undefined;
  if (token) sessions.delete(token);
  response.clearCookie(authCookies.access, { path: "/" });
  response.clearCookie(authCookies.refresh, { path: "/" });
  response.clearCookie(authCookies.csrf, { path: "/" });
  ok(response, { loggedOut: true }, "Logged out.");
});

app.get("/menu", (request, response) => {
  const locale = (request.query.locale?.toString() as Locale | undefined) ?? defaultLocale;
  const q = request.query.q?.toString();
  const categoryId = request.query.categoryId?.toString();

  ok(response, {
    locale,
    categories,
    items: getFilteredMenuItems({ categoryId, q })
  });
});
app.get("/menu/categories", (_request, response) => ok(response, categories));

app.post("/orders", requireAuth, requireRole("CUSTOMER"), (request, response) => {
  const user = (request as express.Request & { demoUser: DemoUser }).demoUser;
  const body = request.body as { customerNameKu: string; customerPhone: string; customerAddressKu: string; notesKu?: string; tableLabel?: string; items: Array<{ menuItemId: string; quantity: number }> };
  const selectedItems = body.items.map((line) => {
    const item = menuItems.find((entry) => entry.id === line.menuItemId)!;
    const category = categories.find((entry) => entry.id === item.categoryId)!;
    const kuTranslation = item.translations.find((entry) => entry.locale === "ku") ?? item.translations[0] ?? { name: item.slug, description: "" };
    return { menuItemId: item.id, quantity: line.quantity, unitPrice: item.basePrice, totalPrice: item.basePrice * line.quantity, nameKu: kuTranslation.name, categoryNameKu: category.names.ku };
  });
  const totalPrice = selectedItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const order: DemoOrder = { id: createId(), orderCode: createOrderCode(), userId: user.id, submittedByName: user.displayName, submittedByUserId: user.id, customerNameKu: body.customerNameKu, customerPhone: body.customerPhone, customerAddressKu: body.customerAddressKu, notesKu: body.notesKu || null, tableLabel: body.tableLabel || null, status: "PENDING", totalPrice, placedAt: nowIso(), updatedAt: nowIso(), items: selectedItems, statusHistory: [{ status: "PENDING", changedAt: nowIso(), changedBy: user.displayName, note: "Order received" }] };
  orders.unshift(order);
  pushActivity(user.displayName, user.role, "ORDER_CREATED", "Order");
  io.to("admin").emit(socketEvents.orderCreated, order);
  io.to(`user:${user.id}`).emit(socketEvents.orderUpdated, order);
  io.to("admin").emit(socketEvents.notification, { message: `New order ${order.orderCode} from ${user.displayName}` });
  ok(response, order, "Order placed successfully.", 201);
});

app.get("/orders/current", requireAuth, requireRole("CUSTOMER"), (request, response) => {
  const user = (request as express.Request & { demoUser: DemoUser }).demoUser;
  ok(response, orders.filter((order) => order.userId === user.id && ["PENDING", "PREPARING", "READY"].includes(order.status)));
});

app.get("/orders/history", requireAuth, requireRole("CUSTOMER"), (request, response) => {
  const user = (request as express.Request & { demoUser: DemoUser }).demoUser;
  ok(response, orders.filter((order) => order.userId === user.id));
});

app.post("/orders/:id/cancel", requireAuth, requireRole("CUSTOMER"), (request, response) => {
  const user = (request as express.Request & { demoUser: DemoUser }).demoUser;
  const order = orders.find((entry) => entry.id === request.params.id && entry.userId === user.id);
  if (!order) {
    response.status(404).json({ success: false, message: "Order not found." });
    return;
  }
  if (order.status !== "PENDING") {
    response.status(400).json({ success: false, message: "Only pending orders can be cancelled by the customer." });
    return;
  }
  order.status = "CANCELLED";
  order.updatedAt = nowIso();
  order.statusHistory.push({ status: "CANCELLED", changedAt: nowIso(), changedBy: user.displayName, note: "Cancelled by customer" });
  pushActivity(user.displayName, user.role, "ORDER_CANCELLED", "Order");
  io.to("admin").emit(socketEvents.orderUpdated, order);
  io.to(`user:${user.id}`).emit(socketEvents.orderUpdated, order);
  io.to(`user:${user.id}`).emit(socketEvents.notification, { message: `Order ${order.orderCode} was cancelled` });
  io.to("admin").emit(socketEvents.notification, { message: `Customer cancelled ${order.orderCode}` });
  io.to("admin").emit(socketEvents.dashboardMetrics, getSummary());
  ok(response, order);
});

app.delete("/orders/:id", requireAuth, requireRole("CUSTOMER"), (request, response) => {
  const user = (request as express.Request & { demoUser: DemoUser }).demoUser;
  const index = orders.findIndex((entry) => entry.id === request.params.id && entry.userId === user.id);
  if (index === -1) {
    response.status(404).json({ success: false, message: "Order not found." });
    return;
  }

  const order = orders[index]!;
  if (!["PENDING", "CANCELLED"].includes(order.status)) {
    response.status(400).json({ success: false, message: "Only pending or cancelled orders can be deleted." });
    return;
  }

  orders.splice(index, 1);
  pushActivity(user.displayName, user.role, "ORDER_DELETED", "Order");
  io.to("admin").emit(socketEvents.orderDeleted, { orderId: order.id, orderCode: order.orderCode, userId: user.id });
  io.to(`user:${user.id}`).emit(socketEvents.orderDeleted, { orderId: order.id, orderCode: order.orderCode, userId: user.id });
  io.to(`user:${user.id}`).emit(socketEvents.notification, { message: `Order ${order.orderCode} was removed` });
  io.to("admin").emit(socketEvents.notification, { message: `Customer deleted ${order.orderCode}` });
  io.to("admin").emit(socketEvents.dashboardMetrics, getSummary());
  ok(response, { deleted: true, orderId: order.id });
});

app.get("/admin/orders", requireAuth, requireRole("ADMIN"), (request, response) => {
  const status = request.query.status?.toString();
  const q = request.query.q?.toString().toLowerCase() || "";
  const filtered = orders.filter((order) => (!status || order.status === status) && (!q || order.orderCode.toLowerCase().includes(q) || order.customerNameKu.toLowerCase().includes(q) || order.customerPhone.includes(q) || order.customerAddressKu.toLowerCase().includes(q) || order.submittedByName.toLowerCase().includes(q)));
  ok(response, filtered);
});

app.patch("/admin/orders/:id/status", requireAuth, requireRole("ADMIN"), (request, response) => {
  const user = (request as express.Request & { demoUser: DemoUser }).demoUser;
  const order = orders.find((entry) => entry.id === request.params.id);
  if (!order) return response.status(404).json({ success: false, message: "Order not found." });
  order.status = request.body.status as OrderStatus;
  order.updatedAt = nowIso();
  order.statusHistory.push({ status: order.status, changedAt: nowIso(), changedBy: user.displayName, note: request.body.note ?? null });
  pushActivity(user.displayName, user.role, "ORDER_STATUS_UPDATED", "Order");
  io.to("admin").emit(socketEvents.orderUpdated, order);
  io.to(`user:${order.userId}`).emit(socketEvents.orderUpdated, order);
  io.to(`user:${order.userId}`).emit(socketEvents.notification, { message: `Order ${order.orderCode} is now ${order.status}` });
  io.to("admin").emit(socketEvents.dashboardMetrics, getSummary());
  return ok(response, order);
});

app.post("/admin/orders/:id/cancel", requireAuth, requireRole("ADMIN"), (request, response) => {
  response.status(400).json({ success: false, message: "Admins can only move orders forward with status updates." });
});

app.delete("/admin/orders/:id", requireAuth, requireRole("ADMIN"), (request, response) => {
  response.status(400).json({ success: false, message: "Admins can only move orders forward with status updates." });
});

app.get("/admin/reports/summary", requireAuth, requireRole("ADMIN"), (_request, response) => ok(response, getSummary()));
app.get("/admin/reports/revenue-range", requireAuth, requireRole("ADMIN"), (request, response) => {
  const start = request.query.start?.toString();
  const end = request.query.end?.toString();
  const startAt = start ? new Date(start) : null;
  const endAt = end ? new Date(end) : null;

  if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    response.status(400).json({ success: false, message: "Invalid revenue range." });
    return;
  }

  if (endAt.getTime() < startAt.getTime()) {
    response.status(400).json({ success: false, message: "End date must be on or after start date." });
    return;
  }

  ok(response, getRevenueRangeSummary(startAt, endAt));
});
app.get("/admin/activity", requireAuth, requireRole("ADMIN"), (_request, response) => ok(response, activity));

app.get("/admin/reports/export", requireAuth, requireRole("ADMIN"), (request, response) => {
  const format = request.query.format?.toString() || "txt";
  const content = JSON.stringify(orders, null, 2);
  response.setHeader("Content-Disposition", `attachment; filename="orders-report.${format}"`);
  response.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "application/octet-stream");
  response.send(Buffer.from(content, "utf8"));
});

app.get("/admin/menu-items", requireAuth, requireRole("ADMIN"), (_request, response) => ok(response, menuItems));
app.post("/admin/menu-items", requireAuth, requireRole("ADMIN"), (request, response) => {
  const created: DemoMenuItem = { id: createId(), createdAt: nowIso(), imagePublicId: null, imageUrl: request.body.imageUrl || null, slug: request.body.slug, categoryId: request.body.categoryId, basePrice: Number(request.body.basePrice), isAvailable: Boolean(request.body.isAvailable ?? true), sortOrder: Number(request.body.sortOrder ?? 0), translations: request.body.translations };
  menuItems.unshift(created);
  ok(response, created, "Menu item created.", 201);
});
app.patch("/admin/menu-items/:id", requireAuth, requireRole("ADMIN"), (request, response) => {
  const item = menuItems.find((entry) => entry.id === request.params.id);
  if (!item) return response.status(404).json({ success: false, message: "Menu item not found." });
  Object.assign(item, { ...request.body, basePrice: request.body.basePrice !== undefined ? Number(request.body.basePrice) : item.basePrice, imageUrl: request.body.imageUrl ?? item.imageUrl });
  ok(response, item);
});
app.delete("/admin/menu-items/:id", requireAuth, requireRole("ADMIN"), (request, response) => {
  const index = menuItems.findIndex((entry) => entry.id === request.params.id);
  if (index !== -1) menuItems.splice(index, 1);
  ok(response, { deleted: true });
});

app.get("/admin/categories", requireAuth, requireRole("ADMIN"), (_request, response) => ok(response, categories));
app.post("/admin/categories", requireAuth, requireRole("ADMIN"), (request, response) => {
  const created: DemoCategory = { id: createId(), slug: request.body.slug, names: request.body.names, icon: request.body.icon || null, sortOrder: Number(request.body.sortOrder ?? 0) };
  categories.unshift(created);
  ok(response, created, "Category created.", 201);
});
app.patch("/admin/categories/:id", requireAuth, requireRole("ADMIN"), (request, response) => {
  const category = categories.find((entry) => entry.id === request.params.id);
  if (!category) return response.status(404).json({ success: false, message: "Category not found." });
  Object.assign(category, { ...request.body, sortOrder: request.body.sortOrder !== undefined ? Number(request.body.sortOrder) : category.sortOrder, names: { ...category.names, ...(request.body.names || {}) } });
  ok(response, category);
});
app.delete("/admin/categories/:id", requireAuth, requireRole("ADMIN"), (request, response) => {
  const index = categories.findIndex((entry) => entry.id === request.params.id);
  if (index !== -1) categories.splice(index, 1);
  ok(response, { deleted: true });
});

app.get("/admin/users", requireAuth, requireRole("ADMIN"), (_request, response) => ok(response, users.map(({ pin, ...user }) => user)));
app.post("/admin/users", requireAuth, requireRole("ADMIN"), (request, response) => {
  const created: DemoUser = { id: createId(), displayName: request.body.displayName, role: request.body.role, preferredLocale: request.body.preferredLocale || defaultLocale, pin: request.body.pin, isActive: true, createdAt: nowIso() };
  users.unshift(created);
  ok(response, { id: created.id, displayName: created.displayName, role: created.role, preferredLocale: created.preferredLocale }, "User created.", 201);
});
app.delete("/admin/users/:id", requireAuth, requireRole("ADMIN"), (request, response) => {
  const user = users.find((entry) => entry.id === request.params.id);
  if (user) user.isActive = false;
  ok(response, { deleted: true });
});

app.get("/admin/tables", requireAuth, requireRole("ADMIN"), (_request, response) => ok(response, tables));
app.post("/admin/tables", requireAuth, requireRole("ADMIN"), (request, response) => {
  const created: DemoTable = { id: createId(), label: request.body.label, qrToken: createId(), isActive: true, createdAt: nowIso(), updatedAt: nowIso() };
  tables.unshift(created);
  ok(response, created, "Table created.", 201);
});
app.delete("/admin/tables/:id", requireAuth, requireRole("ADMIN"), (request, response) => {
  const index = tables.findIndex((entry) => entry.id === request.params.id);
  if (index !== -1) tables.splice(index, 1);
  ok(response, { deleted: true });
});

app.get("/admin/media/signature", requireAuth, requireRole("ADMIN"), (_request, response) => ok(response, { timestamp: Date.now(), signature: "demo-signature", apiKey: "demo-key", cloudName: "demo-cloud", folder: "demo-folder" }));

io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || "";
  const token = cookieHeader.split("; ").find((entry) => entry.startsWith(`${authCookies.access}=`))?.split("=")[1];
  if (!token) return next(new Error("Unauthorized"));
  const session = sessions.get(token);
  if (!session) return next(new Error("Unauthorized"));
  if (isSessionIdle(session.lastActiveAt)) {
    sessions.delete(token);
    return next(new Error("Unauthorized"));
  }
  touchSession(session);
  const user = users.find((entry) => entry.id === session.userId);
  if (!user) return next(new Error("Unauthorized"));
  socket.data.user = user;
  next();
});

io.on("connection", (socket) => {
  const user = socket.data.user as DemoUser;
  socket.join(`user:${user.id}`);
  if (user.role === "ADMIN") socket.join("admin");
  socket.emit(socketEvents.connected, { connectedAt: nowIso() });
  socket.on("order:subscribe", (orderId: string) => socket.join(`order:${orderId}`));
});

  server.listen(portArg, "0.0.0.0", () => {
    console.log(`Demo API running at http://localhost:${portArg}`);
  });
};

const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startDemoServer();
}
