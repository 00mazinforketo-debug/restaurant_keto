import { OrderStatus, Prisma } from "@prisma/client";
export declare const orderTransitionMap: Record<OrderStatus, OrderStatus[]>;
export declare const assertOrderTransition: (from: OrderStatus, to: OrderStatus) => void;
export declare const calculateOrderTotal: (items: Array<{
    quantity: number;
    unitPrice: number;
}>) => number;
export declare const toPrismaMoney: (value: number) => Prisma.Decimal;
export declare const generateOrderCode: () => string;
