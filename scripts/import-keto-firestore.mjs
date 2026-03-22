import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const firebaseProjectId = "keto00";
const firebaseApiKey = "AIzaSyCxtuDiXBRmB-4hvhuRRvOGAFZsYHe7avI";
const firestoreBaseUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents`;

const outputImagesRoot = path.join(projectRoot, "apps", "web", "public", "images", "keto");
const outputCatalogFile = path.join(projectRoot, "packages", "shared", "src", "keto-catalog.ts");

const categoryIconMap = {
  soup: "soup",
  salads: "salad",
  appetizers: "utensils-crossed",
  grilled: "flame",
  main_dishes: "chef-hat",
  burger: "burger",
  pizza: "pizza",
  market: "shopping-bag",
  drinks: "glass-water",
  sweets: "cookie",
  ice_cream: "ice-cream-bowl"
};

const extFromMime = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg"
};

const locales = ["ku", "ar", "fa", "en", "tr"];

const decodeFirestoreValue = (value) => {
  if (!value || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decodeFirestoreValue);
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([key, entry]) => [key, decodeFirestoreValue(entry)])
    );
  }
  return value;
};

const decodeDocument = (document) => ({
  docId: document.name.split("/").pop(),
  createTime: document.createTime,
  updateTime: document.updateTime,
  ...decodeFirestoreValue({ mapValue: { fields: document.fields ?? {} } })
});

const fetchCollection = async (collection) => {
  const documents = [];
  let pageToken = "";

  do {
    const url = new URL(`${firestoreBaseUrl}/${collection}`);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("key", firebaseApiKey);
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${collection}: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    for (const document of payload.documents ?? []) {
      documents.push(decodeDocument(document));
    }
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);

  return documents;
};

const slugify = (value, fallback) => {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
};

const normalizeLookupKey = (value) => String(value ?? "").trim().toLowerCase();

const setLookupValue = (map, key, value) => {
  const normalizedKey = normalizeLookupKey(key);
  if (!normalizedKey || map.has(normalizedKey)) {
    return;
  }

  map.set(normalizedKey, value);
};

const getLookupValue = (map, key) => {
  const normalizedKey = normalizeLookupKey(key);
  return normalizedKey ? map.get(normalizedKey) : undefined;
};

const ensureLocalizedNames = (translations, fallbackId) => {
  const ku = translations?.ku || translations?.en || fallbackId;
  const en = translations?.en || ku;
  const ar = translations?.ar || ku;
  const fa = translations?.fa || ku;
  const tr = translations?.tr || en || ku;

  return { ku, ar, fa, en, tr };
};

const ensureTranslationEntries = (translations, fallbackId) => {
  const localizedNames = ensureLocalizedNames(
    Object.fromEntries(
      Object.entries(translations ?? {}).map(([locale, value]) => [
        locale,
        typeof value === "string" ? value : value?.name
      ])
    ),
    fallbackId
  );

  return locales.map((locale) => {
    const source = translations?.[locale] ?? {};
    const name = localizedNames[locale];
    const description =
      (typeof source === "object" ? source?.description : undefined) ||
      translations?.en?.description ||
      translations?.ku?.description ||
      name;

    return {
      locale,
      name,
      description
    };
  });
};

const decodeDataUri = (value) => {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(value);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
};

const saveImage = async (reference, subdir, basename) => {
  if (!reference || typeof reference !== "string" || !reference.trim()) {
    return null;
  }

  await fs.mkdir(path.join(outputImagesRoot, subdir), { recursive: true });

  let mimeType = "";
  let buffer = null;

  if (reference.startsWith("data:image/")) {
    const data = decodeDataUri(reference);
    if (!data) return null;
    mimeType = data.mimeType;
    buffer = data.buffer;
  } else if (/^https?:\/\//.test(reference)) {
    const response = await fetch(reference);
    if (!response.ok) {
      throw new Error(`Failed to download image ${reference}: ${response.status} ${response.statusText}`);
    }
    mimeType = (response.headers.get("content-type") ?? "").split(";")[0];
    buffer = Buffer.from(await response.arrayBuffer());
  } else {
    return reference;
  }

  const ext = extFromMime[mimeType] || "jpg";
  const filename = `${basename}.${ext}`;
  await fs.writeFile(path.join(outputImagesRoot, subdir, filename), buffer);
  return `/images/keto/${subdir}/${filename}`;
};

const buildCatalog = async () => {
  const [sectionsRaw, categoriesRaw, menuItemsRaw] = await Promise.all([
    fetchCollection("sections"),
    fetchCollection("categories"),
    fetchCollection("menuItems")
  ]);

  await fs.rm(outputImagesRoot, { recursive: true, force: true });

  const sectionsSorted = [...sectionsRaw].sort(
    (left, right) => (Number(left.order ?? 0) - Number(right.order ?? 0)) || String(left.docId).localeCompare(String(right.docId))
  );

  const sections = [];
  const sectionIdMap = new Map();
  for (const section of sectionsSorted) {
    const names = ensureLocalizedNames(section.translations, section.docId);
    const imageUrl = await saveImage(section.image, "sections", slugify(section.docId, `section-${section.docId}`));
    const sectionId = section.id || section.docId;
    const sectionSlug = slugify(names.en, `section-${section.docId}`);
    sections.push({
      id: sectionId,
      slug: sectionSlug,
      names,
      imageUrl,
      sortOrder: Number(section.order ?? 0)
    });
    setLookupValue(sectionIdMap, sectionId, sectionId);
    setLookupValue(sectionIdMap, section.docId, sectionId);
    setLookupValue(sectionIdMap, sectionSlug, sectionId);
  }

  const sectionOrderMap = new Map(sections.map((section, index) => [section.id, index]));

  const categoriesSorted = [...categoriesRaw]
    .filter((category) => category.isActive !== false)
    .sort((left, right) => {
      const leftSectionId = getLookupValue(sectionIdMap, left.sectionId) ?? left.sectionId ?? "main";
      const rightSectionId = getLookupValue(sectionIdMap, right.sectionId) ?? right.sectionId ?? "main";
      const leftSection = sectionOrderMap.get(leftSectionId) ?? 0;
      const rightSection = sectionOrderMap.get(rightSectionId) ?? 0;
      return leftSection - rightSection || Number(left.order ?? 0) - Number(right.order ?? 0) || String(left.docId).localeCompare(String(right.docId));
    });

  const categories = [];
  const categoryIdMap = new Map();
  for (const [index, category] of categoriesSorted.entries()) {
    const names = ensureLocalizedNames(category.translations, category.docId);
    const imageUrl = await saveImage(category.image, "categories", slugify(category.docId, `category-${category.docId}`));
    const categoryId = category.id || category.docId;
    const categorySlug = slugify(names.en, `category-${category.docId}`);
    const sectionId = getLookupValue(sectionIdMap, category.sectionId) ?? category.sectionId ?? "main";
    categories.push({
      id: categoryId,
      sectionId,
      slug: categorySlug,
      names,
      icon: categoryIconMap[categoryId] ?? categoryIconMap[category.docId] ?? null,
      imageUrl,
      sortOrder: index + 1
    });
    setLookupValue(categoryIdMap, categoryId, categoryId);
    setLookupValue(categoryIdMap, category.docId, categoryId);
    setLookupValue(categoryIdMap, categorySlug, categoryId);
  }

  const categoryOrderMap = new Map(categories.map((category, index) => [category.id, index]));

  const menuItemsSorted = [...menuItemsRaw].sort((left, right) => {
    const leftCategoryId = getLookupValue(categoryIdMap, left.categoryId) ?? left.categoryId;
    const rightCategoryId = getLookupValue(categoryIdMap, right.categoryId) ?? right.categoryId;
    const leftCategory = categoryOrderMap.get(leftCategoryId) ?? Number.MAX_SAFE_INTEGER;
    const rightCategory = categoryOrderMap.get(rightCategoryId) ?? Number.MAX_SAFE_INTEGER;
    return leftCategory - rightCategory || Number(left.order ?? 0) - Number(right.order ?? 0) || Number(left.id ?? left.docId) - Number(right.id ?? right.docId);
  });

  const menuItems = [];
  for (const [index, item] of menuItemsSorted.entries()) {
    const sourceId = String(item.id ?? item.docId);
    const translations = ensureTranslationEntries(item.translations, `item-${sourceId}`);
    const imageUrl = await saveImage(item.image, "menu", `item-${sourceId}`);
    const englishName = translations.find((entry) => entry.locale === "en")?.name ?? `item-${sourceId}`;
    const categoryId = getLookupValue(categoryIdMap, item.categoryId) ?? item.categoryId;

    menuItems.push({
      id: `item-${sourceId}`,
      sourceId,
      slug: slugify(englishName, `item-${sourceId}`),
      categoryId,
      basePrice: Number(item.price ?? 0),
      imageUrl,
      isAvailable: true,
      sortOrder: index + 1,
      createdAt: item.createTime ?? new Date().toISOString(),
      translations
    });
  }

  return {
    sections,
    categories,
    menuItems
  };
};

const toTsModule = (catalog) => `import type { Locale } from "./enums.js";

export type KetoLocalizedNames = {
  ku: string;
  ar?: string;
  fa?: string;
  en?: string;
  tr?: string;
};

export type KetoCatalogSection = {
  id: string;
  slug: string;
  names: KetoLocalizedNames;
  imageUrl: string | null;
  sortOrder: number;
};

export type KetoCatalogCategory = {
  id: string;
  sectionId: string;
  slug: string;
  names: KetoLocalizedNames;
  icon: string | null;
  imageUrl: string | null;
  sortOrder: number;
};

export type KetoCatalogTranslation = {
  locale: Locale;
  name: string;
  description: string;
};

export type KetoCatalogMenuItem = {
  id: string;
  sourceId: string;
  slug: string;
  categoryId: string;
  basePrice: number;
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
  createdAt: string;
  translations: KetoCatalogTranslation[];
};

// Generated by scripts/import-keto-firestore.mjs from Firestore project keto00.
export const ketoCatalogSections = ${JSON.stringify(catalog.sections, null, 2)} satisfies KetoCatalogSection[];

export const ketoCatalogCategories = ${JSON.stringify(catalog.categories, null, 2)} satisfies KetoCatalogCategory[];

export const ketoCatalogMenuItems = ${JSON.stringify(catalog.menuItems, null, 2)} satisfies KetoCatalogMenuItem[];
`;

const main = async () => {
  const catalog = await buildCatalog();
  await fs.writeFile(outputCatalogFile, toTsModule(catalog), "utf8");
  console.log(`Imported ${catalog.sections.length} sections, ${catalog.categories.length} categories, and ${catalog.menuItems.length} menu items.`);
  console.log(`Images written to ${outputImagesRoot}`);
  console.log(`Catalog written to ${outputCatalogFile}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
