import "dotenv/config";
import { fixedLoginAccounts, ketoCatalogCategories, ketoCatalogMenuItems } from "@ros/shared";
import { prisma } from "../src/lib/db.js";
import { createPinLookup, hashPin } from "../src/lib/security.js";
const seed = async () => {
    await prisma.orderStatusEvent.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.menuItemTranslation.deleteMany();
    await prisma.menuItem.deleteMany();
    await prisma.category.deleteMany();
    await prisma.tableRef.deleteMany();
    await prisma.session.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.dailyMetric.deleteMany();
    await prisma.user.deleteMany();
    const adminAccount = fixedLoginAccounts.find((account) => account.role === "ADMIN");
    if (!adminAccount) {
        throw new Error("Admin fixed login account is missing.");
    }
    const admin = await prisma.user.create({
        data: {
            id: adminAccount.id,
            displayName: adminAccount.displayName,
            role: adminAccount.role,
            preferredLocale: adminAccount.preferredLocale,
            pinHash: await hashPin(adminAccount.pin),
            pinLookup: createPinLookup(adminAccount.pin)
        }
    });
    await Promise.all(fixedLoginAccounts
        .filter((account) => account.role === "CUSTOMER")
        .map(async (account) => prisma.user.create({
        data: {
            id: account.id,
            displayName: account.displayName,
            role: account.role,
            preferredLocale: account.preferredLocale,
            pinHash: await hashPin(account.pin),
            pinLookup: createPinLookup(account.pin)
        }
    })));
    await prisma.$transaction(ketoCatalogCategories.map((category) => prisma.category.create({
        data: {
            id: category.id,
            slug: category.slug,
            nameKu: category.names.ku,
            nameAr: category.names.ar,
            nameFa: category.names.fa,
            nameEn: category.names.en,
            nameTr: category.names.tr,
            icon: category.icon ?? null,
            sortOrder: category.sortOrder
        }
    })));
    for (const item of ketoCatalogMenuItems) {
        await prisma.menuItem.create({
            data: {
                id: item.id,
                slug: item.slug,
                categoryId: item.categoryId,
                basePrice: item.basePrice,
                imageUrl: item.imageUrl,
                isAvailable: item.isAvailable,
                sortOrder: item.sortOrder,
                createdAt: new Date(item.createdAt),
                translations: {
                    create: item.translations.map((translation) => ({
                        locale: translation.locale,
                        name: translation.name,
                        description: translation.description
                    }))
                }
            }
        });
    }
    await prisma.tableRef.createMany({
        data: [
            { label: "T1", qrToken: "table-t1" },
            { label: "T2", qrToken: "table-t2" },
            { label: "T3", qrToken: "table-t3" }
        ]
    });
    await prisma.activityLog.create({
        data: {
            actorUserId: admin.id,
            actorNameSnapshot: admin.displayName,
            actorRole: admin.role,
            action: "SEED_COMPLETED",
            entityType: "System"
        }
    });
};
seed()
    .then(async () => {
    await prisma.$disconnect();
})
    .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
});
