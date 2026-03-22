import type { Locale } from "./enums.js";
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
export declare const ketoCatalogSections: {
    id: string;
    slug: string;
    names: {
        ku: string;
        ar: string;
        fa: string;
        en: string;
        tr: string;
    };
    imageUrl: null;
    sortOrder: number;
}[];
export declare const ketoCatalogCategories: {
    id: string;
    sectionId: string;
    slug: string;
    names: {
        ku: string;
        ar: string;
        fa: string;
        en: string;
        tr: string;
    };
    icon: string;
    imageUrl: string;
    sortOrder: number;
}[];
export declare const ketoCatalogMenuItems: ({
    id: string;
    sourceId: string;
    slug: string;
    categoryId: string;
    basePrice: number;
    imageUrl: string;
    isAvailable: true;
    sortOrder: number;
    createdAt: string;
    translations: ({
        locale: "ku";
        name: string;
        description: string;
    } | {
        locale: "ar";
        name: string;
        description: string;
    } | {
        locale: "fa";
        name: string;
        description: string;
    } | {
        locale: "en";
        name: string;
        description: string;
    } | {
        locale: "tr";
        name: string;
        description: string;
    })[];
} | {
    id: string;
    sourceId: string;
    slug: string;
    categoryId: string;
    basePrice: number;
    imageUrl: null;
    isAvailable: true;
    sortOrder: number;
    createdAt: string;
    translations: ({
        locale: "ku";
        name: string;
        description: string;
    } | {
        locale: "ar";
        name: string;
        description: string;
    } | {
        locale: "fa";
        name: string;
        description: string;
    } | {
        locale: "en";
        name: string;
        description: string;
    } | {
        locale: "tr";
        name: string;
        description: string;
    })[];
})[];
