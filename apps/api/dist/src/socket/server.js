import { socketEvents } from "@ros/shared";
import { Server } from "socket.io";
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { redis } from "../lib/rate-limit.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { AUTH_COOKIE_NAMES } from "../lib/constants.js";
const parseCookies = (raw) => {
    const result = {};
    if (!raw)
        return result;
    for (const segment of raw.split(";")) {
        const [key, ...rest] = segment.trim().split("=");
        if (!key)
            continue;
        result[key] = decodeURIComponent(rest.join("="));
    }
    return result;
};
export const createSocketServer = async (httpServer) => {
    const io = new Server(httpServer, { cors: { origin: env.WEB_ORIGIN, credentials: true } });
    if (redis) {
        const { createAdapter } = await import("@socket.io/redis-adapter");
        const pubClient = redis;
        const subClient = redis.duplicate();
        io.adapter(createAdapter(pubClient, subClient));
    }
    io.use(async (socket, next) => {
        try {
            const cookies = parseCookies(socket.handshake.headers.cookie);
            const token = cookies[AUTH_COOKIE_NAMES.access] || socket.handshake.auth.token;
            if (!token)
                return next(new Error("Unauthorized"));
            const payload = verifyAccessToken(token);
            const user = await prisma.user.findUnique({ where: { id: payload.sub } });
            if (!user || !user.isActive)
                return next(new Error("Unauthorized"));
            socket.data.user = { id: user.id, role: user.role };
            next();
        }
        catch {
            next(new Error("Unauthorized"));
        }
    });
    io.on("connection", (socket) => {
        const user = socket.data.user;
        socket.join(`user:${user.id}`);
        if (user.role === "ADMIN")
            socket.join("admin");
        socket.emit(socketEvents.connected, { connectedAt: new Date().toISOString() });
        socket.on("order:subscribe", async (orderId) => {
            if (!orderId)
                return;
            if (user.role === "ADMIN") {
                socket.join(`order:${orderId}`);
                return;
            }
            const order = await prisma.order.findFirst({ where: { id: orderId, userId: user.id }, select: { id: true } });
            if (order)
                socket.join(`order:${orderId}`);
        });
        socket.on("disconnect", () => {
            logger.debug({ socketId: socket.id, userId: user.id }, "Socket disconnected");
        });
    });
    return io;
};
