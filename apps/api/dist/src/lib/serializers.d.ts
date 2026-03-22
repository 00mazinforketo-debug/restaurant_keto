import { Prisma, type ActivityLog, type Category, type MenuItem, type MenuItemTranslation, type Order, type OrderItem, type OrderStatusEvent, type User } from "@prisma/client";
import type { ActivityLogDto, AuthUserDto, CategoryDto, MenuItemDto, OrderDto } from "@ros/shared";
export declare const mapAuthUser: (user: Pick<User, "id" | "displayName" | "role" | "preferredLocale">) => AuthUserDto;
export declare const mapCategory: (category: Category) => CategoryDto;
export declare const mapMenuItem: (item: MenuItem & {
    category: Category;
    translations: MenuItemTranslation[];
}) => MenuItemDto;
export declare const mapOrder: (order: Order & {
    items: OrderItem[];
    statusEvents: (OrderStatusEvent & {
        changedByUser: Pick<User, "displayName"> | null;
    })[];
}) => OrderDto;
export declare const mapActivityLog: (activity: ActivityLog) => ActivityLogDto;
export declare const toNumber: (value: Prisma.Decimal | null | undefined) => number;
