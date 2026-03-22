import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { csrfMiddleware } from "./middleware/csrf.js";
import { errorMiddleware } from "./middleware/error.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import authRoutes from "./routes/auth.js";
import menuRoutes from "./routes/menu.js";
import orderRoutes from "./routes/orders.js";
import adminRoutes from "./routes/admin.js";
import type { Server as SocketServer } from "socket.io";

export type IoContext = { current?: SocketServer };

export const createApp = (ioContext: IoContext) => {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use((request, response, next) => {
    const startedAt = Date.now();
    response.on("finish", () => {
      logger.info({ requestId: request.requestId, method: request.method, url: request.originalUrl, statusCode: response.statusCode, durationMs: Date.now() - startedAt }, "HTTP request completed");
    });
    next();
  });
  app.use((request, _response, next) => { request.io = ioContext.current; next(); });
  app.use(csrfMiddleware);

  app.get("/healthz", (_request, response) => { response.json({ success: true, data: { status: "ok" } }); });
  app.get("/readyz", (_request, response) => { response.json({ success: true, data: { status: "ready" } }); });

  app.use("/auth", authRoutes);
  app.use("/menu", menuRoutes);
  app.use("/orders", orderRoutes);
  app.use("/admin", adminRoutes);
  app.use(errorMiddleware);

  return app;
};
