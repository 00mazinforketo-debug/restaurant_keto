import { OrderStatus, Prisma } from "@prisma/client";
import { badRequest } from "./errors.js";
export const orderTransitionMap = {
    PENDING: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
    PREPARING: [OrderStatus.READY, OrderStatus.CANCELLED],
    READY: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    DELIVERED: [],
    CANCELLED: []
};
export const assertOrderTransition = (from, to) => {
    const allowed = orderTransitionMap[from] ?? [];
    if (!allowed.includes(to))
        throw badRequest(`Invalid status transition from ${from} to ${to}.`);
};
export const calculateOrderTotal = (items) => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
export const toPrismaMoney = (value) => new Prisma.Decimal(value.toFixed(2));
export const generateOrderCode = () => {
    const date = new Date();
    const datePart = `${date.getFullYear().toString().slice(-2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const randomPart = Math.floor(Math.random() * 9000 + 1000);
    return `ORD-${datePart}-${randomPart}`;
};
