import { Prisma, type PrismaClient } from "@prisma/client";
type MetricClient = Prisma.TransactionClient | PrismaClient;
export declare const recordOrderCreatedMetric: (tx: MetricClient, placedAt: Date) => Promise<void>;
export declare const recordOrderTransitionMetric: (tx: MetricClient, status: "DELIVERED" | "CANCELLED", totalPrice: Prisma.Decimal, at: Date) => Promise<void>;
export declare const rebuildMetrics: (prisma: PrismaClient) => Promise<void>;
export {};
