import { Prisma, OrderStatus, type PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

const dateKey = (input: Date) => dayjs(input).startOf("day").toDate();
type MetricClient = Prisma.TransactionClient | PrismaClient;

const upsertMetric = async (tx: MetricClient, date: Date, changes: { totalOrders?: number; activeOrders?: number; deliveredOrders?: number; cancelledOrders?: number; revenue?: number; }) => {
  await tx.dailyMetric.upsert({
    where: { date: dateKey(date) },
    create: { date: dateKey(date), totalOrders: changes.totalOrders ?? 0, activeOrders: changes.activeOrders ?? 0, deliveredOrders: changes.deliveredOrders ?? 0, cancelledOrders: changes.cancelledOrders ?? 0, revenue: changes.revenue ?? 0 },
    update: { totalOrders: { increment: changes.totalOrders ?? 0 }, activeOrders: { increment: changes.activeOrders ?? 0 }, deliveredOrders: { increment: changes.deliveredOrders ?? 0 }, cancelledOrders: { increment: changes.cancelledOrders ?? 0 }, revenue: { increment: changes.revenue ?? 0 } }
  });
};

export const recordOrderCreatedMetric = async (tx: MetricClient, placedAt: Date) => upsertMetric(tx, placedAt, { totalOrders: 1, activeOrders: 1 });
export const recordOrderTransitionMetric = async (tx: MetricClient, status: "DELIVERED" | "CANCELLED", totalPrice: Prisma.Decimal, at: Date) => {
  if (status === OrderStatus.DELIVERED) return upsertMetric(tx, at, { activeOrders: -1, deliveredOrders: 1, revenue: Number(totalPrice) });
  return upsertMetric(tx, at, { activeOrders: -1, cancelledOrders: 1 });
};

export const rebuildMetrics = async (prisma: PrismaClient) => {
  const orders = await prisma.order.findMany({ select: { placedAt: true, totalPrice: true, status: true } });
  await prisma.dailyMetric.deleteMany();
  for (const order of orders) {
    await recordOrderCreatedMetric(prisma, order.placedAt);
    if (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED) {
      await recordOrderTransitionMetric(prisma, order.status, order.totalPrice, order.placedAt);
    }
  }
};
