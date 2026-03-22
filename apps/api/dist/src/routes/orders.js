import express from "express";
import { OrderStatus, Prisma } from "@prisma/client";
import { createOrderSchema, socketEvents } from "@ros/shared";
import { prisma } from "../lib/db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { ok } from "../lib/http.js";
import { recordOrderCreatedMetric, recordOrderTransitionMetric } from "../lib/metrics.js";
import { calculateOrderTotal, generateOrderCode, toPrismaMoney } from "../lib/orders.js";
import { mapOrder } from "../lib/serializers.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
const router = express.Router();
const orderInclude = Prisma.validator()({
    items: true,
    statusEvents: {
        include: {
            changedByUser: {
                select: {
                    displayName: true
                }
            }
        },
        orderBy: {
            createdAt: "asc"
        }
    }
});
router.post("/", requireAuth, requireRole("CUSTOMER"), async (request, response, next) => {
    try {
        const input = createOrderSchema.parse(request.body);
        const requestedIds = input.items.map((item) => item.menuItemId);
        const menuItems = await prisma.menuItem.findMany({
            where: { id: { in: requestedIds }, isAvailable: true },
            include: { category: true, translations: { where: { locale: "ku" } } }
        });
        if (menuItems.length !== requestedIds.length) {
            throw badRequest("One or more items are unavailable.");
        }
        const tableRef = input.tableLabel ? await prisma.tableRef.findFirst({ where: { label: input.tableLabel, isActive: true } }) : null;
        const itemMap = new Map(menuItems.map((item) => [item.id, item]));
        const calculatedItems = input.items.map((entry) => {
            const menuItem = itemMap.get(entry.menuItemId);
            if (!menuItem)
                throw badRequest("Invalid menu item.");
            return {
                menuItemId: menuItem.id,
                quantity: entry.quantity,
                unitPrice: Number(menuItem.basePrice),
                totalPrice: Number(menuItem.basePrice) * entry.quantity,
                nameKuSnapshot: menuItem.translations[0]?.name ?? menuItem.slug,
                categoryNameKuSnapshot: menuItem.category.nameKu
            };
        });
        const orderTotal = calculateOrderTotal(calculatedItems.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice })));
        const order = await prisma.$transaction(async (tx) => {
            const created = await tx.order.create({
                data: {
                    orderCode: generateOrderCode(),
                    userId: request.auth.id,
                    customerNameKu: input.customerNameKu,
                    customerPhone: input.customerPhone,
                    customerAddressKu: input.customerAddressKu,
                    notesKu: input.notesKu || null,
                    tableRefId: tableRef?.id,
                    tableLabelSnapshot: tableRef?.label ?? input.tableLabel ?? null,
                    localeAtCheckout: input.locale ?? "ku",
                    totalPrice: toPrismaMoney(orderTotal),
                    items: {
                        create: calculatedItems.map((item) => ({
                            menuItemId: item.menuItemId,
                            quantity: item.quantity,
                            unitPrice: toPrismaMoney(item.unitPrice),
                            totalPrice: toPrismaMoney(item.totalPrice),
                            nameKuSnapshot: item.nameKuSnapshot,
                            categoryNameKuSnapshot: item.categoryNameKuSnapshot
                        }))
                    },
                    statusEvents: {
                        create: {
                            status: OrderStatus.PENDING,
                            changedByUserId: request.auth.id,
                            note: "Order received"
                        }
                    }
                },
                include: orderInclude
            });
            await tx.activityLog.create({
                data: {
                    actorUserId: request.auth.id,
                    actorNameSnapshot: request.auth.displayName,
                    actorRole: request.auth.role,
                    action: "ORDER_CREATED",
                    entityType: "Order",
                    entityId: created.id,
                    metadata: { orderCode: created.orderCode, totalPrice: orderTotal }
                }
            });
            await recordOrderCreatedMetric(tx, created.placedAt);
            return created;
        });
        const dto = mapOrder(order);
        request.io?.to("admin").emit(socketEvents.orderCreated, dto);
        request.io?.to(`user:${request.auth.id}`).emit(socketEvents.orderUpdated, dto);
        request.io?.to(`order:${order.id}`).emit(socketEvents.orderUpdated, dto);
        request.io?.to("admin").emit(socketEvents.notification, { level: "info", message: `New order ${order.orderCode}`, orderId: order.id });
        ok(response, dto, "Order placed successfully.", 201);
    }
    catch (error) {
        next(error);
    }
});
router.get("/current", requireAuth, requireRole("CUSTOMER"), async (request, response, next) => {
    try {
        const orders = await prisma.order.findMany({
            where: { userId: request.auth.id, status: { in: [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY] } },
            include: orderInclude,
            orderBy: { placedAt: "desc" }
        });
        ok(response, orders.map(mapOrder));
    }
    catch (error) {
        next(error);
    }
});
router.get("/history", requireAuth, requireRole("CUSTOMER"), async (request, response, next) => {
    try {
        const orders = await prisma.order.findMany({ where: { userId: request.auth.id }, include: orderInclude, orderBy: { placedAt: "desc" } });
        ok(response, orders.map(mapOrder));
    }
    catch (error) {
        next(error);
    }
});
router.post("/:id/cancel", requireAuth, requireRole("CUSTOMER"), async (request, response, next) => {
    try {
        const existing = await prisma.order.findFirst({
            where: { id: String(request.params.id), userId: request.auth.id },
            include: orderInclude
        });
        if (!existing) {
            throw notFound("Order not found.");
        }
        if (existing.status !== OrderStatus.PENDING) {
            throw badRequest("Only pending orders can be cancelled by the customer.");
        }
        const updated = await prisma.$transaction(async (tx) => {
            const order = await tx.order.update({
                where: { id: existing.id },
                data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
                include: orderInclude
            });
            await tx.orderStatusEvent.create({
                data: {
                    orderId: order.id,
                    status: OrderStatus.CANCELLED,
                    note: "Cancelled by customer",
                    changedByUserId: request.auth.id
                }
            });
            await tx.activityLog.create({
                data: {
                    actorUserId: request.auth.id,
                    actorNameSnapshot: request.auth.displayName,
                    actorRole: request.auth.role,
                    action: "ORDER_CANCELLED",
                    entityType: "Order",
                    entityId: order.id,
                    metadata: { orderCode: order.orderCode, source: "customer" }
                }
            });
            await recordOrderTransitionMetric(tx, OrderStatus.CANCELLED, order.totalPrice, new Date());
            return order;
        });
        const dto = mapOrder(updated);
        request.io?.to("admin").emit(socketEvents.orderUpdated, dto);
        request.io?.to(`user:${updated.userId}`).emit(socketEvents.orderUpdated, dto);
        request.io?.to(`order:${updated.id}`).emit(socketEvents.orderUpdated, dto);
        request.io?.to("admin").emit(socketEvents.notification, {
            level: "warning",
            orderId: updated.id,
            status: updated.status,
            message: `Customer cancelled ${updated.orderCode}`
        });
        request.io?.to(`user:${updated.userId}`).emit(socketEvents.notification, {
            level: "warning",
            orderId: updated.id,
            status: updated.status,
            message: `Order ${updated.orderCode} was cancelled`
        });
        ok(response, dto);
    }
    catch (error) {
        next(error);
    }
});
router.delete("/:id", requireAuth, requireRole("CUSTOMER"), async (request, response, next) => {
    try {
        const existing = await prisma.order.findFirst({
            where: { id: String(request.params.id), userId: request.auth.id },
            include: orderInclude
        });
        if (!existing) {
            throw notFound("Order not found.");
        }
        if (existing.status !== OrderStatus.PENDING && existing.status !== OrderStatus.CANCELLED) {
            throw badRequest("Only pending or cancelled orders can be deleted.");
        }
        await prisma.$transaction(async (tx) => {
            await tx.activityLog.create({
                data: {
                    actorUserId: request.auth.id,
                    actorNameSnapshot: request.auth.displayName,
                    actorRole: request.auth.role,
                    action: "ORDER_DELETED",
                    entityType: "Order",
                    entityId: existing.id,
                    metadata: { orderCode: existing.orderCode, deletedStatus: existing.status, source: "customer" }
                }
            });
            await tx.order.delete({
                where: { id: existing.id }
            });
        });
        const payload = { deleted: true, orderId: existing.id };
        request.io?.to("admin").emit(socketEvents.orderDeleted, { ...payload, orderCode: existing.orderCode, userId: existing.userId });
        request.io?.to(`user:${existing.userId}`).emit(socketEvents.orderDeleted, { ...payload, orderCode: existing.orderCode, userId: existing.userId });
        request.io?.to("admin").emit(socketEvents.notification, {
            level: "warning",
            orderId: existing.id,
            status: existing.status,
            message: `Customer deleted ${existing.orderCode}`
        });
        request.io?.to(`user:${existing.userId}`).emit(socketEvents.notification, {
            level: "warning",
            orderId: existing.id,
            status: existing.status,
            message: `Order ${existing.orderCode} was removed`
        });
        ok(response, payload);
    }
    catch (error) {
        next(error);
    }
});
router.get("/:id", requireAuth, async (request, response, next) => {
    try {
        const orderId = String(request.params.id);
        const order = await prisma.order.findFirst({
            where: { id: orderId, ...(request.auth.role === "ADMIN" ? {} : { userId: request.auth.id }) },
            include: orderInclude
        });
        if (!order)
            throw notFound("Order not found.");
        ok(response, mapOrder(order));
    }
    catch (error) {
        next(error);
    }
});
export default router;
