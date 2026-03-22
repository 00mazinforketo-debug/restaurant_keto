import { z } from "zod";
export declare const localeSchema: z.ZodDefault<z.ZodEnum<["ku", "ar", "fa", "en", "tr"]>>;
export declare const roleSchema: z.ZodEnum<["CUSTOMER", "ADMIN"]>;
export declare const orderStatusSchema: z.ZodEnum<["PENDING", "PREPARING", "READY", "DELIVERED", "CANCELLED"]>;
export declare const loginPinSchema: z.ZodObject<{
    pin: z.ZodString;
    rememberMe: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    pin: string;
    rememberMe: boolean;
}, {
    pin: string;
    rememberMe?: boolean | undefined;
}>;
export declare const localizedStringSchema: z.ZodObject<{
    ku: z.ZodString;
    ar: z.ZodOptional<z.ZodString>;
    fa: z.ZodOptional<z.ZodString>;
    en: z.ZodOptional<z.ZodString>;
    tr: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    ku: string;
    ar?: string | undefined;
    fa?: string | undefined;
    en?: string | undefined;
    tr?: string | undefined;
}, {
    ku: string;
    ar?: string | undefined;
    fa?: string | undefined;
    en?: string | undefined;
    tr?: string | undefined;
}>;
export declare const categorySchema: z.ZodObject<{
    id: z.ZodString;
    slug: z.ZodString;
    names: z.ZodObject<{
        ku: z.ZodString;
        ar: z.ZodOptional<z.ZodString>;
        fa: z.ZodOptional<z.ZodString>;
        en: z.ZodOptional<z.ZodString>;
        tr: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    }, {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    }>;
    icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    sortOrder: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    slug: string;
    names: {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    };
    sortOrder: number;
    icon?: string | null | undefined;
}, {
    id: string;
    slug: string;
    names: {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    };
    sortOrder: number;
    icon?: string | null | undefined;
}>;
export declare const createCategorySchema: z.ZodObject<{
    slug: z.ZodString;
    names: z.ZodObject<{
        ku: z.ZodString;
        ar: z.ZodOptional<z.ZodString>;
        fa: z.ZodOptional<z.ZodString>;
        en: z.ZodOptional<z.ZodString>;
        tr: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    }, {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    }>;
    icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    sortOrder: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    slug: string;
    names: {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    };
    sortOrder: number;
    icon?: string | null | undefined;
}, {
    slug: string;
    names: {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    };
    icon?: string | null | undefined;
    sortOrder?: number | undefined;
}>;
export declare const menuItemTranslationSchema: z.ZodObject<{
    locale: z.ZodDefault<z.ZodEnum<["ku", "ar", "fa", "en", "tr"]>>;
    name: z.ZodString;
    description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    locale: "ku" | "ar" | "fa" | "en" | "tr";
    name: string;
    description: string;
}, {
    name: string;
    description: string;
    locale?: "ku" | "ar" | "fa" | "en" | "tr" | undefined;
}>;
export declare const menuItemSchema: z.ZodObject<{
    id: z.ZodString;
    slug: z.ZodString;
    categoryId: z.ZodString;
    categoryNames: z.ZodObject<{
        ku: z.ZodString;
        ar: z.ZodOptional<z.ZodString>;
        fa: z.ZodOptional<z.ZodString>;
        en: z.ZodOptional<z.ZodString>;
        tr: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    }, {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    }>;
    basePrice: z.ZodNumber;
    imageUrl: z.ZodNullable<z.ZodEffects<z.ZodString, string, string>>;
    imagePublicId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    isAvailable: z.ZodBoolean;
    sortOrder: z.ZodNumber;
    createdAt: z.ZodString;
    translations: z.ZodArray<z.ZodObject<{
        locale: z.ZodDefault<z.ZodEnum<["ku", "ar", "fa", "en", "tr"]>>;
        name: z.ZodString;
        description: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        locale: "ku" | "ar" | "fa" | "en" | "tr";
        name: string;
        description: string;
    }, {
        name: string;
        description: string;
        locale?: "ku" | "ar" | "fa" | "en" | "tr" | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    id: string;
    slug: string;
    sortOrder: number;
    categoryId: string;
    categoryNames: {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    };
    basePrice: number;
    imageUrl: string | null;
    isAvailable: boolean;
    createdAt: string;
    translations: {
        locale: "ku" | "ar" | "fa" | "en" | "tr";
        name: string;
        description: string;
    }[];
    imagePublicId?: string | null | undefined;
}, {
    id: string;
    slug: string;
    sortOrder: number;
    categoryId: string;
    categoryNames: {
        ku: string;
        ar?: string | undefined;
        fa?: string | undefined;
        en?: string | undefined;
        tr?: string | undefined;
    };
    basePrice: number;
    imageUrl: string | null;
    isAvailable: boolean;
    createdAt: string;
    translations: {
        name: string;
        description: string;
        locale?: "ku" | "ar" | "fa" | "en" | "tr" | undefined;
    }[];
    imagePublicId?: string | null | undefined;
}>;
export declare const createMenuItemSchema: z.ZodObject<{
    slug: z.ZodString;
    categoryId: z.ZodString;
    basePrice: z.ZodNumber;
    imageUrl: z.ZodOptional<z.ZodNullable<z.ZodEffects<z.ZodString, string, string>>>;
    imagePublicId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    isAvailable: z.ZodDefault<z.ZodBoolean>;
    sortOrder: z.ZodDefault<z.ZodNumber>;
    translations: z.ZodEffects<z.ZodArray<z.ZodObject<{
        locale: z.ZodDefault<z.ZodEnum<["ku", "ar", "fa", "en", "tr"]>>;
        name: z.ZodString;
        description: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        locale: "ku" | "ar" | "fa" | "en" | "tr";
        name: string;
        description: string;
    }, {
        name: string;
        description: string;
        locale?: "ku" | "ar" | "fa" | "en" | "tr" | undefined;
    }>, "many">, {
        locale: "ku" | "ar" | "fa" | "en" | "tr";
        name: string;
        description: string;
    }[], {
        name: string;
        description: string;
        locale?: "ku" | "ar" | "fa" | "en" | "tr" | undefined;
    }[]>;
}, "strip", z.ZodTypeAny, {
    slug: string;
    sortOrder: number;
    categoryId: string;
    basePrice: number;
    isAvailable: boolean;
    translations: {
        locale: "ku" | "ar" | "fa" | "en" | "tr";
        name: string;
        description: string;
    }[];
    imageUrl?: string | null | undefined;
    imagePublicId?: string | null | undefined;
}, {
    slug: string;
    categoryId: string;
    basePrice: number;
    translations: {
        name: string;
        description: string;
        locale?: "ku" | "ar" | "fa" | "en" | "tr" | undefined;
    }[];
    sortOrder?: number | undefined;
    imageUrl?: string | null | undefined;
    imagePublicId?: string | null | undefined;
    isAvailable?: boolean | undefined;
}>;
export declare const orderItemInputSchema: z.ZodObject<{
    menuItemId: z.ZodString;
    quantity: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    menuItemId: string;
    quantity: number;
}, {
    menuItemId: string;
    quantity: number;
}>;
export declare const createOrderSchema: z.ZodObject<{
    customerNameKu: z.ZodString;
    customerPhone: z.ZodPipeline<z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>, z.ZodString>;
    customerAddressKu: z.ZodString;
    notesKu: z.ZodOptional<z.ZodString>;
    tableLabel: z.ZodOptional<z.ZodString>;
    locale: z.ZodOptional<z.ZodDefault<z.ZodEnum<["ku", "ar", "fa", "en", "tr"]>>>;
    items: z.ZodArray<z.ZodObject<{
        menuItemId: z.ZodString;
        quantity: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        menuItemId: string;
        quantity: number;
    }, {
        menuItemId: string;
        quantity: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    customerNameKu: string;
    customerPhone: string;
    customerAddressKu: string;
    items: {
        menuItemId: string;
        quantity: number;
    }[];
    locale?: "ku" | "ar" | "fa" | "en" | "tr" | undefined;
    notesKu?: string | undefined;
    tableLabel?: string | undefined;
}, {
    customerNameKu: string;
    customerPhone: string;
    customerAddressKu: string;
    items: {
        menuItemId: string;
        quantity: number;
    }[];
    locale?: "ku" | "ar" | "fa" | "en" | "tr" | undefined;
    notesKu?: string | undefined;
    tableLabel?: string | undefined;
}>;
export declare const orderItemSnapshotSchema: z.ZodObject<{
    menuItemId: z.ZodString;
    quantity: z.ZodNumber;
    unitPrice: z.ZodNumber;
    totalPrice: z.ZodNumber;
    nameKu: z.ZodString;
    categoryNameKu: z.ZodString;
}, "strip", z.ZodTypeAny, {
    menuItemId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    nameKu: string;
    categoryNameKu: string;
}, {
    menuItemId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    nameKu: string;
    categoryNameKu: string;
}>;
export declare const orderSchema: z.ZodObject<{
    id: z.ZodString;
    orderCode: z.ZodString;
    customerNameKu: z.ZodString;
    customerPhone: z.ZodString;
    customerAddressKu: z.ZodString;
    notesKu: z.ZodNullable<z.ZodString>;
    tableLabel: z.ZodNullable<z.ZodString>;
    submittedByName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    submittedByUserId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodEnum<["PENDING", "PREPARING", "READY", "DELIVERED", "CANCELLED"]>;
    totalPrice: z.ZodNumber;
    placedAt: z.ZodString;
    updatedAt: z.ZodString;
    items: z.ZodArray<z.ZodObject<{
        menuItemId: z.ZodString;
        quantity: z.ZodNumber;
        unitPrice: z.ZodNumber;
        totalPrice: z.ZodNumber;
        nameKu: z.ZodString;
        categoryNameKu: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        menuItemId: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        nameKu: string;
        categoryNameKu: string;
    }, {
        menuItemId: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        nameKu: string;
        categoryNameKu: string;
    }>, "many">;
    statusHistory: z.ZodArray<z.ZodObject<{
        status: z.ZodEnum<["PENDING", "PREPARING", "READY", "DELIVERED", "CANCELLED"]>;
        changedAt: z.ZodString;
        changedBy: z.ZodNullable<z.ZodString>;
        note: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "PENDING" | "PREPARING" | "READY" | "DELIVERED" | "CANCELLED";
        changedAt: string;
        changedBy: string | null;
        note: string | null;
    }, {
        status: "PENDING" | "PREPARING" | "READY" | "DELIVERED" | "CANCELLED";
        changedAt: string;
        changedBy: string | null;
        note: string | null;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    status: "PENDING" | "PREPARING" | "READY" | "DELIVERED" | "CANCELLED";
    id: string;
    customerNameKu: string;
    customerPhone: string;
    customerAddressKu: string;
    notesKu: string | null;
    tableLabel: string | null;
    items: {
        menuItemId: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        nameKu: string;
        categoryNameKu: string;
    }[];
    totalPrice: number;
    orderCode: string;
    placedAt: string;
    updatedAt: string;
    statusHistory: {
        status: "PENDING" | "PREPARING" | "READY" | "DELIVERED" | "CANCELLED";
        changedAt: string;
        changedBy: string | null;
        note: string | null;
    }[];
    submittedByName?: string | null | undefined;
    submittedByUserId?: string | null | undefined;
}, {
    status: "PENDING" | "PREPARING" | "READY" | "DELIVERED" | "CANCELLED";
    id: string;
    customerNameKu: string;
    customerPhone: string;
    customerAddressKu: string;
    notesKu: string | null;
    tableLabel: string | null;
    items: {
        menuItemId: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        nameKu: string;
        categoryNameKu: string;
    }[];
    totalPrice: number;
    orderCode: string;
    placedAt: string;
    updatedAt: string;
    statusHistory: {
        status: "PENDING" | "PREPARING" | "READY" | "DELIVERED" | "CANCELLED";
        changedAt: string;
        changedBy: string | null;
        note: string | null;
    }[];
    submittedByName?: string | null | undefined;
    submittedByUserId?: string | null | undefined;
}>;
export declare const updateOrderStatusSchema: z.ZodObject<{
    status: z.ZodEnum<["PENDING", "PREPARING", "READY", "DELIVERED", "CANCELLED"]>;
    note: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "PENDING" | "PREPARING" | "READY" | "DELIVERED" | "CANCELLED";
    note?: string | undefined;
}, {
    status: "PENDING" | "PREPARING" | "READY" | "DELIVERED" | "CANCELLED";
    note?: string | undefined;
}>;
export declare const createUserSchema: z.ZodObject<{
    displayName: z.ZodString;
    pin: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<["CUSTOMER", "ADMIN"]>>;
    preferredLocale: z.ZodDefault<z.ZodDefault<z.ZodEnum<["ku", "ar", "fa", "en", "tr"]>>>;
}, "strip", z.ZodTypeAny, {
    pin: string;
    displayName: string;
    role: "CUSTOMER" | "ADMIN";
    preferredLocale: "ku" | "ar" | "fa" | "en" | "tr";
}, {
    pin: string;
    displayName: string;
    role?: "CUSTOMER" | "ADMIN" | undefined;
    preferredLocale?: "ku" | "ar" | "fa" | "en" | "tr" | undefined;
}>;
export declare const orderSummarySchema: z.ZodObject<{
    totalOrders: z.ZodNumber;
    activeOrders: z.ZodNumber;
    deliveredOrders: z.ZodNumber;
    revenueToday: z.ZodNumber;
    revenueWeek: z.ZodNumber;
    revenueMonth: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    totalOrders: number;
    activeOrders: number;
    deliveredOrders: number;
    revenueToday: number;
    revenueWeek: number;
    revenueMonth: number;
}, {
    totalOrders: number;
    activeOrders: number;
    deliveredOrders: number;
    revenueToday: number;
    revenueWeek: number;
    revenueMonth: number;
}>;
export declare const activityLogSchema: z.ZodObject<{
    id: z.ZodString;
    actorName: z.ZodString;
    actorRole: z.ZodEnum<["CUSTOMER", "ADMIN"]>;
    action: z.ZodString;
    entityType: z.ZodString;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    createdAt: string;
    actorName: string;
    actorRole: "CUSTOMER" | "ADMIN";
    action: string;
    entityType: string;
}, {
    id: string;
    createdAt: string;
    actorName: string;
    actorRole: "CUSTOMER" | "ADMIN";
    action: string;
    entityType: string;
}>;
export declare const authUserSchema: z.ZodObject<{
    id: z.ZodString;
    displayName: z.ZodString;
    role: z.ZodEnum<["CUSTOMER", "ADMIN"]>;
    preferredLocale: z.ZodDefault<z.ZodEnum<["ku", "ar", "fa", "en", "tr"]>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    displayName: string;
    role: "CUSTOMER" | "ADMIN";
    preferredLocale: "ku" | "ar" | "fa" | "en" | "tr";
}, {
    id: string;
    displayName: string;
    role: "CUSTOMER" | "ADMIN";
    preferredLocale?: "ku" | "ar" | "fa" | "en" | "tr" | undefined;
}>;
export declare const apiResponseSchema: <T extends z.ZodTypeAny>(data: T) => z.ZodObject<{
    success: z.ZodBoolean;
    message: z.ZodOptional<z.ZodString>;
    data: T;
}, "strip", z.ZodTypeAny, z.objectUtil.addQuestionMarks<z.baseObjectOutputType<{
    success: z.ZodBoolean;
    message: z.ZodOptional<z.ZodString>;
    data: T;
}>, any> extends infer T_1 ? { [k in keyof T_1]: T_1[k]; } : never, z.baseObjectInputType<{
    success: z.ZodBoolean;
    message: z.ZodOptional<z.ZodString>;
    data: T;
}> extends infer T_2 ? { [k_1 in keyof T_2]: T_2[k_1]; } : never>;
export type LoginPinInput = z.infer<typeof loginPinSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type MenuItemDto = z.infer<typeof menuItemSchema>;
export type CategoryDto = z.infer<typeof categorySchema>;
export type OrderDto = z.infer<typeof orderSchema>;
export type AuthUserDto = z.infer<typeof authUserSchema>;
export type OrderSummaryDto = z.infer<typeof orderSummarySchema>;
export type ActivityLogDto = z.infer<typeof activityLogSchema>;
