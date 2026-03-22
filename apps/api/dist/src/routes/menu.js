import express from "express";
import { localeSchema } from "@ros/shared";
import { prisma } from "../lib/db.js";
import { ok } from "../lib/http.js";
import { mapCategory, mapMenuItem } from "../lib/serializers.js";
const router = express.Router();
router.get("/", async (request, response, next) => {
    try {
        const locale = localeSchema.optional().parse(request.query.locale);
        const search = request.query.q?.toString().trim();
        const categoryId = request.query.categoryId?.toString();
        const [categories, items] = await Promise.all([
            prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
            prisma.menuItem.findMany({
                where: {
                    isAvailable: true,
                    ...(categoryId ? { categoryId } : {}),
                    ...(search
                        ? {
                            translations: {
                                some: {
                                    OR: [
                                        { name: { contains: search, mode: "insensitive" } },
                                        { description: { contains: search, mode: "insensitive" } }
                                    ]
                                }
                            }
                        }
                        : {})
                },
                include: {
                    category: true,
                    translations: true
                },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }]
            })
        ]);
        ok(response, {
            locale,
            categories: categories.map(mapCategory),
            items: items.map(mapMenuItem)
        });
    }
    catch (error) {
        next(error);
    }
});
router.get("/categories", async (_request, response, next) => {
    try {
        const categories = await prisma.category.findMany({
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
        });
        ok(response, categories.map(mapCategory));
    }
    catch (error) {
        next(error);
    }
});
export default router;
