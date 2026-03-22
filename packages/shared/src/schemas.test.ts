import { describe, expect, it } from "vitest";
import { createMenuItemSchema, createOrderSchema } from "./schemas";

describe("createOrderSchema", () => {
  it("accepts multilingual contact fields and normalizes the phone number", () => {
    const parsed = createOrderSchema.parse({
      customerNameKu: "Ahmed",
      customerPhone: "0750 123 4567",
      customerAddressKu: "Baghdad center",
      notesKu: "بدون بصل",
      items: [{ menuItemId: "item-1", quantity: 2 }]
    });

    expect(parsed.customerNameKu).toBe("Ahmed");
    expect(parsed.customerPhone).toBe("07501234567");
  });

  it("rejects invalid phone numbers", () => {
    expect(() =>
      createOrderSchema.parse({
        customerNameKu: "ئاوات محەمەد",
        customerPhone: "phone-number",
        customerAddressKu: "هەولێر گەڕەکی ئازادی",
        items: [{ menuItemId: "item-1", quantity: 1 }]
      })
    ).toThrow();
  });
});

describe("createMenuItemSchema", () => {
  it("accepts local image paths for imported catalog items", () => {
    const parsed = createMenuItemSchema.parse({
      slug: "cauliflower-soup",
      categoryId: "soup",
      basePrice: 12000,
      imageUrl: "/images/keto/menu/item-1.png",
      translations: [
        { locale: "ku", name: "شۆربای قەڕنابیت", description: "شۆربای قەڕنابیتی کیتۆ." },
        { locale: "en", name: "Cauliflower Soup", description: "Keto cauliflower soup." }
      ]
    });

    expect(parsed.imageUrl).toBe("/images/keto/menu/item-1.png");
  });
});
