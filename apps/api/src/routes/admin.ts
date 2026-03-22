import crypto from "node:crypto";
import dayjs from "dayjs";
import express from "express";
import { OrderStatus } from "@prisma/client";
import {
  createCategorySchema,
  createMenuItemSchema,
  createUserSchema,
  orderStatuses,
  socketEvents,
  updateOrderStatusSchema
} from "@ros/shared";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { createUploadSignature } from "../lib/cloudinary.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { buildOrdersPdf, buildOrdersWorkbook } from "../lib/exporters.js";
import { ok } from "../lib/http.js";
import { rebuildMetrics, recordOrderTransitionMetric } from "../lib/metrics.js";
import { assertOrderTransition, toPrismaMoney } from "../lib/orders.js";
import { mapActivityLog, mapCategory, mapMenuItem, mapOrder, mapAuthUser, toNumber } from "../lib/serializers.js";
import { createPinLookup, hashPin } from "../lib/security.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
const updateCategorySchema = createCategorySchema.partial();
const updateMenuItemSchema = createMenuItemSchema.partial();
const cancelSchema = z.object({ note: z.string().max(280).optional() });
const exportFormatSchema = z.enum(["xlsx", "pdf"]);
const tableSchema = z.object({ label: z.string().min(1).max(30) });
const revenueRangeQuerySchema = z.object({ start: z.string(), end: z.string() });

const orderInclude = {
  user: {
    select: {
      id: true,
      displayName: true,
      role: true,
      preferredLocale: true
    }
  },
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
      createdAt: "asc" as const
    }
  }
};

const orderWhereFromQuery = (query: Record<string, unknown>) => {
  const status = typeof query.status === "string" && orderStatuses.includes(query.status as OrderStatus)
    ? (query.status as OrderStatus)
    : undefined;
  const search = typeof query.q === "string" ? query.q.trim() : "";

  return {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { orderCode: { contains: search, mode: "insensitive" as const } },
            { customerNameKu: { contains: search, mode: "insensitive" as const } },
            { customerPhone: { contains: search } },
            { customerAddressKu: { contains: search, mode: "insensitive" as const } }
          ]
        }
      : {})
  };
};

const getRevenueRangeSummary = async (startAt: Date, endAt: Date) => {
  const where = {
    status: OrderStatus.DELIVERED,
    placedAt: {
      gte: startAt,
      lte: endAt
    }
  };

  const [deliveredOrders, aggregates] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.aggregate({
      _sum: { totalPrice: true },
      _avg: { totalPrice: true },
      where
    })
  ]);

  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    deliveredOrders,
    revenue: toNumber(aggregates._sum.totalPrice),
    averageOrderValue: toNumber(aggregates._avg.totalPrice)
  };
};

const getSummary = async () => {
  const now = dayjs();
  const [
    totalOrders,
    activeOrders,
    deliveredOrders,
    revenueToday,
    revenueWeek,
    revenueMonth,
    recentActivity
  ] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({
      where: { status: { in: [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY] } }
    }),
    prisma.order.count({ where: { status: OrderStatus.DELIVERED } }),
    prisma.order.aggregate({
      _sum: { totalPrice: true },
      where: { status: OrderStatus.DELIVERED, placedAt: { gte: now.startOf("day").toDate() } }
    }),
    prisma.order.aggregate({
      _sum: { totalPrice: true },
      where: { status: OrderStatus.DELIVERED, placedAt: { gte: now.startOf("week").toDate() } }
    }),
    prisma.order.aggregate({
      _sum: { totalPrice: true },
      where: { status: OrderStatus.DELIVERED, placedAt: { gte: now.startOf("month").toDate() } }
    }),
    prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 })
  ]);

  return {
    summary: {
      totalOrders,
      activeOrders,
      deliveredOrders,
      revenueToday: toNumber(revenueToday._sum.totalPrice),
      revenueWeek: toNumber(revenueWeek._sum.totalPrice),
      revenueMonth: toNumber(revenueMonth._sum.totalPrice)
    },
    recentActivity: recentActivity.map(mapActivityLog)
  };
};

const emitOrderUpdate = async (request: express.Request, orderId: string) => {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) {
    return null;
  }

  const dto = mapOrder(order);
  request.io?.to("admin").emit(socketEvents.orderUpdated, dto);
  request.io?.to(`user:${order.userId}`).emit(socketEvents.orderUpdated, dto);
  request.io?.to(`order:${order.id}`).emit(socketEvents.orderUpdated, dto);
  return { raw: order, dto };
};

router.use(requireAuth, requireRole("ADMIN"));

router.get("/orders", async (request, response, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: orderWhereFromQuery(request.query as Record<string, unknown>),
      include: orderInclude,
      orderBy: { placedAt: "desc" }
    });

    ok(response, orders.map(mapOrder));
  } catch (error) {
    next(error);
  }
});

router.patch("/orders/:id/status", async (request, response, next) => {
  try {
    const input = updateOrderStatusSchema.parse(request.body);
    const existing = await prisma.order.findUnique({ where: { id: request.params.id } });
    if (!existing) {
      throw notFound("Order not found.");
    }

    assertOrderTransition(existing.status, input.status);

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          deliveredAt: input.status === OrderStatus.DELIVERED ? new Date() : existing.deliveredAt,
          cancelledAt: input.status === OrderStatus.CANCELLED ? new Date() : existing.cancelledAt
        }
      });

      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: input.status,
          note: input.note,
          changedByUserId: request.auth!.id
        }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: request.auth!.id,
          actorNameSnapshot: request.auth!.displayName,
          actorRole: request.auth!.role,
          action: "ORDER_STATUS_UPDATED",
          entityType: "Order",
          entityId: order.id,
          metadata: {
            from: existing.status,
            to: input.status,
            note: input.note ?? null
          }
        }
      });

      if (input.status === OrderStatus.DELIVERED) {
        await recordOrderTransitionMetric(tx, "DELIVERED", order.totalPrice, new Date());
      }
      if (input.status === OrderStatus.CANCELLED) {
        await recordOrderTransitionMetric(tx, "CANCELLED", order.totalPrice, new Date());
      }

      return order;
    });

    const emitted = await emitOrderUpdate(request, updated.id);
    if (emitted) {
      request.io?.to(`user:${updated.userId}`).emit(socketEvents.notification, {
        level: "success",
        orderId: updated.id,
        status: updated.status,
        message: `Order ${updated.orderCode} is now ${updated.status}`
      });
    }
    request.io?.to("admin").emit(socketEvents.dashboardMetrics, await getSummary());

    ok(response, emitted?.dto);
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/cancel", async (request, response, next) => {
  try {
    cancelSchema.parse(request.body);
    throw badRequest("Admins can only move orders forward with status updates.");
  } catch (error) {
    next(error);
  }
});

router.delete("/orders/:id", async (request, response, next) => {
  try {
    throw badRequest("Admins can only move orders forward with status updates.");
  } catch (error) {
    next(error);
  }
});

router.get("/menu-items", async (_request, response, next) => {
  try {
    const items = await prisma.menuItem.findMany({
      include: { category: true, translations: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }]
    });

    ok(response, items.map(mapMenuItem));
  } catch (error) {
    next(error);
  }
});

router.post("/menu-items", async (request, response, next) => {
  try {
    const input = createMenuItemSchema.parse(request.body);
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.menuItem.create({
        data: {
          slug: input.slug,
          categoryId: input.categoryId,
          basePrice: toPrismaMoney(input.basePrice),
          imageUrl: input.imageUrl ?? null,
          imagePublicId: input.imagePublicId ?? null,
          isAvailable: input.isAvailable,
          sortOrder: input.sortOrder,
          translations: {
            create: input.translations.map((translation) => ({
              locale: translation.locale,
              name: translation.name,
              description: translation.description
            }))
          }
        },
        include: { category: true, translations: true }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: request.auth!.id,
          actorNameSnapshot: request.auth!.displayName,
          actorRole: request.auth!.role,
          action: "MENU_ITEM_CREATED",
          entityType: "MenuItem",
          entityId: created.id
        }
      });

      return created;
    });

    ok(response, mapMenuItem(item), "Menu item created.", 201);
  } catch (error) {
    next(error);
  }
});

router.patch("/menu-items/:id", async (request, response, next) => {
  try {
    const input = updateMenuItemSchema.parse(request.body);
    const existing = await prisma.menuItem.findUnique({ where: { id: request.params.id } });
    if (!existing) {
      throw notFound("Menu item not found.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.menuItem.update({
        where: { id: existing.id },
        data: {
          slug: input.slug ?? existing.slug,
          categoryId: input.categoryId ?? existing.categoryId,
          basePrice: input.basePrice !== undefined ? toPrismaMoney(input.basePrice) : existing.basePrice,
          imageUrl: input.imageUrl !== undefined ? input.imageUrl : existing.imageUrl,
          imagePublicId: input.imagePublicId !== undefined ? input.imagePublicId : existing.imagePublicId,
          isAvailable: input.isAvailable ?? existing.isAvailable,
          sortOrder: input.sortOrder ?? existing.sortOrder,
          ...(input.translations
            ? {
                translations: {
                  deleteMany: {},
                  create: input.translations.map((translation) => ({
                    locale: translation.locale,
                    name: translation.name,
                    description: translation.description
                  }))
                }
              }
            : {})
        },
        include: { category: true, translations: true }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: request.auth!.id,
          actorNameSnapshot: request.auth!.displayName,
          actorRole: request.auth!.role,
          action: "MENU_ITEM_UPDATED",
          entityType: "MenuItem",
          entityId: item.id
        }
      });
      return item;
    });

    ok(response, mapMenuItem(updated));
  } catch (error) {
    next(error);
  }
});

router.delete("/menu-items/:id", async (request, response, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.menuItem.delete({ where: { id: request.params.id } });
      await tx.activityLog.create({
        data: {
          actorUserId: request.auth!.id,
          actorNameSnapshot: request.auth!.displayName,
          actorRole: request.auth!.role,
          action: "MENU_ITEM_DELETED",
          entityType: "MenuItem",
          entityId: request.params.id
        }
      });
    });

    ok(response, { deleted: true });
  } catch (error) {
    next(error);
  }
});

router.get("/categories", async (_request, response, next) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    ok(response, categories.map(mapCategory));
  } catch (error) {
    next(error);
  }
});

router.post("/categories", async (request, response, next) => {
  try {
    const input = createCategorySchema.parse(request.body);
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          slug: input.slug,
          nameKu: input.names.ku,
          nameAr: input.names.ar,
          nameFa: input.names.fa,
          nameEn: input.names.en,
          nameTr: input.names.tr,
          icon: input.icon ?? null,
          sortOrder: input.sortOrder
        }
      });
      await tx.activityLog.create({
        data: {
          actorUserId: request.auth!.id,
          actorNameSnapshot: request.auth!.displayName,
          actorRole: request.auth!.role,
          action: "CATEGORY_CREATED",
          entityType: "Category",
          entityId: created.id
        }
      });
      return created;
    });

    ok(response, mapCategory(category), "Category created.", 201);
  } catch (error) {
    next(error);
  }
});

router.patch("/categories/:id", async (request, response, next) => {
  try {
    const input = updateCategorySchema.parse(request.body);
    const existing = await prisma.category.findUnique({ where: { id: request.params.id } });
    if (!existing) {
      throw notFound("Category not found.");
    }

    const category = await prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id: existing.id },
        data: {
          slug: input.slug ?? existing.slug,
          nameKu: input.names?.ku ?? existing.nameKu,
          nameAr: input.names?.ar ?? existing.nameAr,
          nameFa: input.names?.fa ?? existing.nameFa,
          nameEn: input.names?.en ?? existing.nameEn,
          nameTr: input.names?.tr ?? existing.nameTr,
          icon: input.icon !== undefined ? input.icon : existing.icon,
          sortOrder: input.sortOrder ?? existing.sortOrder
        }
      });
      await tx.activityLog.create({
        data: {
          actorUserId: request.auth!.id,
          actorNameSnapshot: request.auth!.displayName,
          actorRole: request.auth!.role,
          action: "CATEGORY_UPDATED",
          entityType: "Category",
          entityId: updated.id
        }
      });
      return updated;
    });

    ok(response, mapCategory(category));
  } catch (error) {
    next(error);
  }
});

router.delete("/categories/:id", async (request, response, next) => {
  try {
    const linkedItems = await prisma.menuItem.count({ where: { categoryId: request.params.id } });
    if (linkedItems > 0) {
      throw conflict("Delete or move menu items before removing this category.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.category.delete({ where: { id: request.params.id } });
      await tx.activityLog.create({
        data: {
          actorUserId: request.auth!.id,
          actorNameSnapshot: request.auth!.displayName,
          actorRole: request.auth!.role,
          action: "CATEGORY_DELETED",
          entityType: "Category",
          entityId: request.params.id
        }
      });
    });

    ok(response, { deleted: true });
  } catch (error) {
    next(error);
  }
});

router.get("/users", async (_request, response, next) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
    ok(
      response,
      users.map((user) => ({
        ...mapAuthUser(user),
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString()
      }))
    );
  } catch (error) {
    next(error);
  }
});

router.post("/users", async (request, response, next) => {
  try {
    const input = createUserSchema.parse(request.body);
    const pinLookup = createPinLookup(input.pin);
    const existing = await prisma.user.findUnique({ where: { pinLookup } });
    if (existing) {
      throw conflict("This PIN is already assigned to another user.");
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          displayName: input.displayName,
          role: input.role,
          preferredLocale: input.preferredLocale,
          pinHash: await hashPin(input.pin),
          pinLookup
        }
      });
      await tx.activityLog.create({
        data: {
          actorUserId: request.auth!.id,
          actorNameSnapshot: request.auth!.displayName,
          actorRole: request.auth!.role,
          action: "USER_CREATED",
          entityType: "User",
          entityId: created.id,
          metadata: { role: created.role }
        }
      });
      return created;
    });

    ok(response, mapAuthUser(user), "User created.", 201);
  } catch (error) {
    next(error);
  }
});

router.delete("/users/:id", async (request, response, next) => {
  try {
    if (request.params.id === request.auth!.id) {
      throw badRequest("You cannot delete your own account.");
    }

    const target = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (!target) {
      throw notFound("User not found.");
    }

    if (target.role === "ADMIN") {
      const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
      if (activeAdmins <= 1) {
        throw conflict("At least one active admin must remain.");
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { isActive: false } });
      await tx.session.updateMany({ where: { userId: target.id }, data: { revokedAt: new Date() } });
      await tx.activityLog.create({
        data: {
          actorUserId: request.auth!.id,
          actorNameSnapshot: request.auth!.displayName,
          actorRole: request.auth!.role,
          action: "USER_DEACTIVATED",
          entityType: "User",
          entityId: target.id
        }
      });
    });

    ok(response, { deleted: true });
  } catch (error) {
    next(error);
  }
});

router.get("/reports/summary", async (_request, response, next) => {
  try {
    ok(response, await getSummary());
  } catch (error) {
    next(error);
  }
});

router.get("/reports/revenue-range", async (request, response, next) => {
  try {
    const query = revenueRangeQuerySchema.parse(request.query);
    const startAt = dayjs(query.start);
    const endAt = dayjs(query.end);

    if (!startAt.isValid() || !endAt.isValid()) {
      throw badRequest("Invalid revenue range.");
    }

    if (endAt.isBefore(startAt)) {
      throw badRequest("End date must be on or after start date.");
    }

    ok(response, await getRevenueRangeSummary(startAt.toDate(), endAt.toDate()));
  } catch (error) {
    next(error);
  }
});

router.get("/reports/export", async (request, response, next) => {
  try {
    const format = exportFormatSchema.parse(request.query.format);
    const orders = await prisma.order.findMany({
      where: orderWhereFromQuery(request.query as Record<string, unknown>),
      include: orderInclude,
      orderBy: { placedAt: "desc" }
    });
    const dto = orders.map(mapOrder);

    if (format === "xlsx") {
      const workbook = await buildOrdersWorkbook(dto);
      response.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      response.setHeader("Content-Disposition", 'attachment; filename="orders-report.xlsx"');
      response.send(Buffer.from(workbook));
      return;
    }

    const pdf = await buildOrdersPdf(dto);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", 'attachment; filename="orders-report.pdf"');
    response.send(pdf);
  } catch (error) {
    next(error);
  }
});

router.get("/activity", async (_request, response, next) => {
  try {
    const items = await prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
    ok(response, items.map(mapActivityLog));
  } catch (error) {
    next(error);
  }
});

router.get("/media/signature", async (_request, response, next) => {
  try {
    ok(response, createUploadSignature("restaurant-ordering-system/menu-items"));
  } catch (error) {
    next(error);
  }
});

router.get("/tables", async (_request, response, next) => {
  try {
    const tables = await prisma.tableRef.findMany({ orderBy: { label: "asc" } });
    ok(response, tables);
  } catch (error) {
    next(error);
  }
});

router.post("/tables", async (request, response, next) => {
  try {
    const input = tableSchema.parse(request.body);
    const table = await prisma.$transaction(async (tx) => {
      const created = await tx.tableRef.create({
        data: {
          label: input.label,
          qrToken: crypto.randomUUID()
        }
      });
      await tx.activityLog.create({
        data: {
          actorUserId: request.auth!.id,
          actorNameSnapshot: request.auth!.displayName,
          actorRole: request.auth!.role,
          action: "TABLE_CREATED",
          entityType: "TableRef",
          entityId: created.id
        }
      });
      return created;
    });

    ok(response, table, "Table created.", 201);
  } catch (error) {
    next(error);
  }
});

router.delete("/tables/:id", async (request, response, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.tableRef.delete({ where: { id: request.params.id } });
      await tx.activityLog.create({
        data: {
          actorUserId: request.auth!.id,
          actorNameSnapshot: request.auth!.displayName,
          actorRole: request.auth!.role,
          action: "TABLE_DELETED",
          entityType: "TableRef",
          entityId: request.params.id
        }
      });
    });

    ok(response, { deleted: true });
  } catch (error) {
    next(error);
  }
});

export default router;




