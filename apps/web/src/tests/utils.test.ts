import { describe, expect, it } from "vitest";
import type { CategoryDto, MenuItemDto } from "@ros/shared";
import { getCategoryName, getMenuText } from "../lib/utils";

const category: CategoryDto = {
  id: "cat-1",
  slug: "drinks",
  names: { ku: "خواردنەوەکان", en: "Drinks" },
  icon: null,
  sortOrder: 1
};

const item: MenuItemDto = {
  id: "item-1",
  slug: "cola",
  categoryId: "cat-1",
  categoryNames: { ku: "خواردنەوەکان", en: "Drinks" },
  basePrice: 2,
  imageUrl: null,
  imagePublicId: null,
  isAvailable: true,
  sortOrder: 0,
  createdAt: new Date().toISOString(),
  translations: [
    { locale: "ku", name: "کۆڵا", description: "سارد و خۆش" },
    { locale: "en", name: "Cola", description: "Cold and refreshing" }
  ]
};

describe("locale helpers", () => {
  it("falls back to Kurdish when a category translation is missing", () => {
    expect(getCategoryName(category, "tr")).toBe("خواردنەوەکان");
  });

  it("picks the requested menu translation", () => {
    expect(getMenuText(item, "en").name).toBe("Cola");
  });
});
