ALTER TABLE "Order"
ADD COLUMN "customerPhone" TEXT NOT NULL DEFAULT '',
ADD COLUMN "customerAddressKu" TEXT NOT NULL DEFAULT '';

CREATE INDEX "Order_customerPhone_idx" ON "Order"("customerPhone");
