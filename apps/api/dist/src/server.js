import "dotenv/config";
import http from "node:http";
import * as Sentry from "@sentry/node";
import { prisma } from "./lib/db.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { createApp } from "./app.js";
import { startJobs } from "./jobs/index.js";
import { createSocketServer } from "./socket/server.js";
import { startDemoServer } from "./demo.js";
const startPrismaServer = async () => {
    if (env.SENTRY_DSN) {
        Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });
    }
    await prisma.$connect();
    const ioContext = {};
    const app = createApp(ioContext);
    const httpServer = http.createServer(app);
    const io = await createSocketServer(httpServer);
    ioContext.current = io;
    startJobs();
    httpServer.listen(env.PORT, () => {
        logger.info({ port: env.PORT }, `API listening on port ${env.PORT}`);
    });
};
const bootstrap = async () => {
    try {
        await startPrismaServer();
    }
    catch (error) {
        logger.warn({ error }, "Falling back to the demo API server (no database/redis required).");
        await startDemoServer(env.PORT);
    }
};
bootstrap().catch((error) => {
    logger.error({ error }, "Failed to start API server.");
    process.exit(1);
});
