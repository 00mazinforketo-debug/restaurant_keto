import cron from "node-cron";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { rebuildMetrics } from "../lib/metrics.js";
export const startJobs = () => {
    cron.schedule("5 0 * * *", async () => {
        try {
            await rebuildMetrics(prisma);
            logger.info("Daily metrics reconciliation completed.");
        }
        catch (error) {
            logger.error({ error }, "Failed to rebuild daily metrics.");
        }
    });
};
