import type { Locale } from "@ros/shared";

export type SessionPayload = {
  user: {
    id: string;
    displayName: string;
    role: "CUSTOMER" | "ADMIN";
    preferredLocale: Locale;
  };
  csrfToken?: string;
};

export type AdminSummary = {
  summary: {
    totalOrders: number;
    activeOrders: number;
    deliveredOrders: number;
    revenueToday: number;
    revenueWeek: number;
    revenueMonth: number;
  };
  recentActivity: Array<{
    id: string;
    actorName: string;
    actorRole: "CUSTOMER" | "ADMIN";
    action: string;
    entityType: string;
    createdAt: string;
  }>;
};

export type RevenueRangeSummary = {
  startAt: string;
  endAt: string;
  deliveredOrders: number;
  revenue: number;
  averageOrderValue: number;
};

export type TableRefDto = {
  id: string;
  label: string;
  qrToken: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
