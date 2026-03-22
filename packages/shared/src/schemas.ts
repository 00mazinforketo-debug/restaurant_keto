import { z } from "zod";
import { defaultLocale, locales, orderStatuses, userRoles } from "./enums.js";
import { isPhoneNumber, normalizePhoneNumber } from "./text.js";

export const localeSchema = z.enum(locales).default(defaultLocale);
export const roleSchema = z.enum(userRoles);
export const orderStatusSchema = z.enum(orderStatuses);
const imageReferenceSchema = z
  .string()
  .trim()
  .refine((value) => {
    if (!value) return false;
    if (value.startsWith("/")) return true;
    if (value.startsWith("data:image/")) return true;
    try {
      return Boolean(new URL(value));
    } catch {
      return false;
    }
  }, "Image reference is invalid.");

export const loginPinSchema = z.object({ pin: z.string().regex(/^\d{4}$/), rememberMe: z.boolean().optional().default(false) });
export const localizedStringSchema = z.object({ ku: z.string().min(1), ar: z.string().optional(), fa: z.string().optional(), en: z.string().optional(), tr: z.string().optional() });
const freeTextSchema = z.string().trim();

export const categorySchema = z.object({ id: z.string(), slug: z.string(), names: localizedStringSchema, icon: z.string().nullable().optional(), sortOrder: z.number().int().nonnegative() });
export const createCategorySchema = z.object({ slug: z.string().min(2).max(64), names: localizedStringSchema, icon: z.string().nullable().optional(), sortOrder: z.number().int().nonnegative().default(0) });
export const menuItemTranslationSchema = z.object({ locale: localeSchema, name: z.string().min(1).max(120), description: z.string().min(1).max(400) });
export const menuItemSchema = z.object({ id: z.string(), slug: z.string(), categoryId: z.string(), categoryNames: localizedStringSchema, basePrice: z.number().nonnegative(), imageUrl: imageReferenceSchema.nullable(), imagePublicId: z.string().nullable().optional(), isAvailable: z.boolean(), sortOrder: z.number().int().nonnegative(), createdAt: z.string(), translations: z.array(menuItemTranslationSchema) });
export const createMenuItemSchema = z.object({ slug: z.string().min(2).max(80), categoryId: z.string(), basePrice: z.number().nonnegative(), imageUrl: imageReferenceSchema.nullable().optional(), imagePublicId: z.string().nullable().optional(), isAvailable: z.boolean().default(true), sortOrder: z.number().int().nonnegative().default(0), translations: z.array(menuItemTranslationSchema).superRefine((translations, ctx) => { if (!translations.some((item) => item.locale === "ku")) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Kurdish translation is required." }); }) });
export const orderItemInputSchema = z.object({ menuItemId: z.string(), quantity: z.number().int().min(1).max(99) });
const phoneSchema = z.string().transform(normalizePhoneNumber).refine(isPhoneNumber, "Phone number is invalid.");
export const createOrderSchema = z.object({ customerNameKu: freeTextSchema.min(2).max(100), customerPhone: phoneSchema.pipe(z.string().min(10).max(16)), customerAddressKu: freeTextSchema.min(4).max(220), notesKu: freeTextSchema.max(280).optional(), tableLabel: z.string().max(30).optional(), locale: localeSchema.optional(), items: z.array(orderItemInputSchema).min(1) });
export const orderItemSnapshotSchema = z.object({ menuItemId: z.string(), quantity: z.number().int(), unitPrice: z.number(), totalPrice: z.number(), nameKu: z.string(), categoryNameKu: z.string() });
export const orderSchema = z.object({ id: z.string(), orderCode: z.string(), customerNameKu: z.string(), customerPhone: z.string(), customerAddressKu: z.string(), notesKu: z.string().nullable(), tableLabel: z.string().nullable(), submittedByName: z.string().nullable().optional(), submittedByUserId: z.string().nullable().optional(), status: orderStatusSchema, totalPrice: z.number(), placedAt: z.string(), updatedAt: z.string(), items: z.array(orderItemSnapshotSchema), statusHistory: z.array(z.object({ status: orderStatusSchema, changedAt: z.string(), changedBy: z.string().nullable(), note: z.string().nullable() })) });
export const updateOrderStatusSchema = z.object({ status: orderStatusSchema, note: z.string().max(280).optional() });
export const createUserSchema = z.object({ displayName: z.string().min(2).max(120), pin: z.string().regex(/^\d{4}$/), role: roleSchema.default("CUSTOMER"), preferredLocale: localeSchema.default(defaultLocale) });
export const orderSummarySchema = z.object({ totalOrders: z.number().int(), activeOrders: z.number().int(), deliveredOrders: z.number().int(), revenueToday: z.number(), revenueWeek: z.number(), revenueMonth: z.number() });
export const activityLogSchema = z.object({ id: z.string(), actorName: z.string(), actorRole: roleSchema, action: z.string(), entityType: z.string(), createdAt: z.string() });
export const authUserSchema = z.object({ id: z.string(), displayName: z.string(), role: roleSchema, preferredLocale: localeSchema });
export const apiResponseSchema = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.boolean(), message: z.string().optional(), data });

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
