import { startTransition, useDeferredValue, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminSettingsPin, locales, orderStatuses, type CategoryDto, type Locale, type MenuItemDto, type OrderDto, type OrderStatus } from "@ros/shared";
import { BarChart3, CalendarClock, ChevronLeft, ChevronRight, ClipboardList, Download, DollarSign, ExternalLink, House, Info, LayoutGrid, LogOut, MapPin, NotebookText, PackageSearch, Phone, PlusCircle, ReceiptText, RefreshCw, Settings, Shield, Users2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LanguageSwitcher } from "../../components/language-switcher";
import { StatusBadge } from "../../components/status-badge";
import { ThemeToggle } from "../../components/theme-toggle";
import { useAppExitGuard } from "../../hooks/use-app-exit-guard";
import { api } from "../../lib/api";
import { parseIraqAddress } from "../../lib/iraq-locations";
import { isRealtimeEnabled } from "../../lib/socket";
import { cn, formatCurrency, formatDateTime, formatNumber, getCategoryName, getMenuText, toEnglishDigits } from "../../lib/utils";
import { useAuth } from "../../providers/auth-provider";

const tabs = ["home", "orders", "revenue", "menu", "categories", "users", "activity", "settings", "about"] as const;
type TabKey = (typeof tabs)[number];
const isAdminTabKey = (value: string | null): value is TabKey => Boolean(value && tabs.includes(value as TabKey));
type MenuVisibilityKey = Exclude<TabKey, "settings" | "about">;
type RevenueRangeMode = "day" | "month" | "year" | "custom";
type RevenueRangeForm = {
  mode: RevenueRangeMode;
  day: string;
  month: string;
  year: string;
  from: string;
  to: string;
};
type RevenueRangeRequest = { mode: RevenueRangeMode; startAt: string; endAt: string };

const adminMenuVisibilityStorageKey = "ros-admin-menu-visibility";
const manageableTabs = ["home", "orders", "revenue", "menu", "categories", "users", "activity"] as const satisfies readonly MenuVisibilityKey[];
const revenueRangeModes: Array<{ key: RevenueRangeMode; label: string }> = [
  { key: "day", label: "ڕۆژ" },
  { key: "month", label: "مانگ" },
  { key: "year", label: "ساڵ" },
  { key: "custom", label: "ماوەی دیاریکراو" }
];
const englishDateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", numberingSystem: "latn" });
const englishMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", numberingSystem: "latn" });

const defaultMenuVisibility = manageableTabs.reduce<Record<MenuVisibilityKey, boolean>>((accumulator, entry) => {
  accumulator[entry] = true;
  return accumulator;
}, {} as Record<MenuVisibilityKey, boolean>);

const readMenuVisibility = (): Record<MenuVisibilityKey, boolean> => {
  if (typeof window === "undefined") {
    return defaultMenuVisibility;
  }

  try {
    const raw = window.localStorage.getItem(adminMenuVisibilityStorageKey);
    if (!raw) return defaultMenuVisibility;
    const parsed = JSON.parse(raw) as Partial<Record<MenuVisibilityKey, boolean>>;
    return manageableTabs.reduce<Record<MenuVisibilityKey, boolean>>((accumulator, entry) => {
      accumulator[entry] = parsed[entry] ?? true;
      return accumulator;
    }, {} as Record<MenuVisibilityKey, boolean>);
  } catch {
    return defaultMenuVisibility;
  }
};

const tabIcons: Record<TabKey, ComponentType<{ className?: string }>> = {
  home: House,
  orders: ClipboardList,
  revenue: DollarSign,
  menu: LayoutGrid,
  categories: BarChart3,
  users: Users2,
  activity: BarChart3,
  settings: Settings,
  about: Info
};

const tabLabelKey: Record<TabKey, string> = {
  home: "nav.home",
  orders: "nav.orders",
  revenue: "nav.revenue",
  menu: "nav.menuManagement",
  categories: "nav.categories",
  users: "nav.users",
  activity: "nav.activity",
  settings: "nav.settings",
  about: "nav.about"
};

const nextStatusMap: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: "PREPARING",
  PREPARING: "READY",
  READY: "DELIVERED"
};

const createEmptyCategoryForm = () => ({
  id: "",
  slug: "",
  names: { ku: "", ar: "", fa: "", en: "", tr: "" },
  sortOrder: 0,
  icon: ""
});

const createEmptyMenuForm = () => ({
  id: "",
  slug: "",
  categoryId: "",
  basePrice: "0",
  imageUrl: "",
  sortOrder: 0,
  isAvailable: true,
  translations: {
    ku: { name: "", description: "" },
    ar: { name: "", description: "" },
    fa: { name: "", description: "" },
    en: { name: "", description: "" },
    tr: { name: "", description: "" }
  }
});

const emptyUserForm = { displayName: "", pin: "", role: "CUSTOMER" as const, preferredLocale: "ku" as Locale };
type CategoryFormState = ReturnType<typeof createEmptyCategoryForm>;
type MenuFormState = ReturnType<typeof createEmptyMenuForm>;

const createCategoryFormFromCategory = (category: CategoryDto): CategoryFormState => ({
  id: category.id,
  slug: category.slug,
  names: {
    ku: category.names.ku,
    ar: category.names.ar ?? "",
    fa: category.names.fa ?? "",
    en: category.names.en ?? "",
    tr: category.names.tr ?? ""
  },
  sortOrder: category.sortOrder,
  icon: category.icon ?? ""
});

const createMenuFormFromMenuItem = (item: MenuItemDto): MenuFormState => {
  const nextForm = createEmptyMenuForm();
  nextForm.id = item.id;
  nextForm.slug = item.slug;
  nextForm.categoryId = item.categoryId;
  nextForm.basePrice = String(item.basePrice);
  nextForm.imageUrl = item.imageUrl ?? "";
  nextForm.sortOrder = item.sortOrder;
  nextForm.isAvailable = item.isAvailable;

  for (const translation of item.translations) {
    nextForm.translations[translation.locale] = {
      name: translation.name,
      description: translation.description
    };
  }

  return nextForm;
};

const createCategoryPayload = (form: CategoryFormState) => ({
  slug: form.slug.trim(),
  names: {
    ku: form.names.ku.trim(),
    ar: form.names.ar.trim() || undefined,
    fa: form.names.fa.trim() || undefined,
    en: form.names.en.trim() || undefined,
    tr: form.names.tr.trim() || undefined
  },
  sortOrder: Number(form.sortOrder) || 0,
  icon: form.icon.trim() || undefined
});

const createMenuPayload = (form: MenuFormState) => {
  const translations = locales.flatMap((entry) => {
    const current = form.translations[entry];
    const name = current.name.trim();
    const description = current.description.trim();
    if (!name || !description) return [];
    return [{ locale: entry, name, description }];
  });

  return {
    slug: form.slug.trim(),
    categoryId: form.categoryId,
    basePrice: Number(form.basePrice) || 0,
    imageUrl: form.imageUrl.trim() || undefined,
    sortOrder: Number(form.sortOrder) || 0,
    isAvailable: form.isAvailable,
    translations
  };
};

const pickImageAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Image upload failed"));
    reader.readAsDataURL(file);
  });

const Section = ({ title, icon: Icon, children }: { title: string; icon: ComponentType<{ className?: string }>; children: ReactNode }) => (
  <section className="app-panel min-w-0 sm:rounded-[28px]">
    <div className="mb-4 flex items-center gap-3 sm:mb-5">
      <Icon className="h-5 w-5 text-amber-300" />
      <h2 className="font-display text-base font-bold text-white break-words sm:text-xl">{title}</h2>
    </div>
    {children}
  </section>
);

const MetricCard = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 rounded-[18px] border border-white/10 bg-slate-950/40 p-3.5 sm:rounded-[24px] sm:p-4">
    <p className="text-[0.9rem] text-slate-400">{label}</p>
    <h3 className="mt-2.5 font-display text-xl font-extrabold text-white sm:text-3xl">{value}</h3>
  </div>
);

const formatDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const formatMonthInputValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const getInitialRevenueRangeForm = (): RevenueRangeForm => {
  const today = new Date();
  return {
    mode: "custom",
    day: formatDateInputValue(today),
    month: formatMonthInputValue(today),
    year: String(today.getFullYear()),
    from: formatDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: formatDateInputValue(today)
  };
};

const buildRevenueRangeRequest = (form: RevenueRangeForm): RevenueRangeRequest | null => {
  const toLocalDate = (value: string, endOfDay = false) => {
    if (!value) return null;
    return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  };

  let startAt: Date | null = null;
  let endAt: Date | null = null;

  if (form.mode === "day") {
    startAt = toLocalDate(form.day);
    endAt = toLocalDate(form.day, true);
  }

  if (form.mode === "month") {
    const monthParts = form.month.split("-");
    const year = Number(monthParts[0]);
    const month = Number(monthParts[1]);
    if (monthParts.length === 2 && Number.isFinite(year) && Number.isFinite(month)) {
      startAt = new Date(year, month - 1, 1, 0, 0, 0, 0);
      endAt = new Date(year, month, 0, 23, 59, 59, 999);
    }
  }

  if (form.mode === "year") {
    const year = Number(form.year);
    if (Number.isFinite(year) && year > 0) {
      startAt = new Date(year, 0, 1, 0, 0, 0, 0);
      endAt = new Date(year, 11, 31, 23, 59, 59, 999);
    }
  }

  if (form.mode === "custom") {
    startAt = toLocalDate(form.from);
    endAt = toLocalDate(form.to, true);
  }

  if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt.getTime() < startAt.getTime()) {
    return null;
  }

  return { mode: form.mode, startAt: startAt.toISOString(), endAt: endAt.toISOString() };
};

const formatRevenueRangeLabel = (range: RevenueRangeRequest | null) => {
  if (!range) return "-";

  const startAt = new Date(range.startAt);
  const endAt = new Date(range.endAt);

  if (range.mode === "day") {
    return `ڕۆژی ${englishDateFormatter.format(startAt)}`;
  }

  if (range.mode === "month") {
    return `مانگی ${englishMonthFormatter.format(startAt)}`;
  }

  if (range.mode === "year") {
    return `ساڵی ${formatNumber(startAt.getFullYear())}`;
  }

  return `${toEnglishDigits(englishDateFormatter.format(startAt))} - ${toEnglishDigits(englishDateFormatter.format(endAt))}`;
};

const OrderMetaRow = ({ icon: Icon, label, value, dir }: { icon: ComponentType<{ className?: string }>; label: string; value: string; dir?: "ltr" | "rtl" }) => (
  <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/35 p-3.5 sm:p-4">
    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-slate-400">
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </div>
    <p dir={dir} className="mt-3 whitespace-pre-line break-words text-sm font-semibold text-white">{value || "-"}</p>
  </div>
);

const OrderListCard = ({ order, isSelected, onSelect, itemsLabel }: { order: OrderDto; isSelected: boolean; onSelect: () => void; itemsLabel: string }) => {
  const parsedAddress = parseIraqAddress(order.customerAddressKu);
  const addressSummary = [parsedAddress.governorate, parsedAddress.district].filter(Boolean).join(" - ") || parsedAddress.details || order.customerAddressKu;
  const submittedByLabel = order.submittedByName ? `نێردراوە لەلایەن ${order.submittedByName}` : "نێردراوە لەلایەن -";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full min-w-0 rounded-[18px] border p-3.5 text-left transition sm:rounded-[24px] sm:p-4",
        isSelected
          ? "border-amber-300/40 bg-amber-300/10 shadow-glow"
          : "border-white/10 bg-slate-950/30 hover:border-sky-300/30 hover:bg-white/5"
      )}
    >
      <div className="mb-3 flex flex-col gap-3 min-[460px]:flex-row min-[460px]:items-start min-[460px]:justify-between">
        <div className="min-w-0">
          <p className="font-display text-base font-bold text-white break-all sm:text-lg">{toEnglishDigits(order.orderCode)}</p>
          <p className="text-xs text-slate-400">{formatDateTime(order.placedAt)}</p>
        </div>
        <div className="self-start">
          <StatusBadge status={order.status} />
        </div>
      </div>
      <div className="min-w-0 space-y-2 text-sm text-slate-200">
        <p className="break-words">{order.customerNameKu}</p>
        <p className="text-xs font-semibold text-amber-100 break-words">{submittedByLabel}</p>
        <p className="text-sky-100 break-all">{toEnglishDigits(order.customerPhone)}</p>
        <p className="line-clamp-2 text-xs text-slate-400">{addressSummary}</p>
      </div>
      <div className="mt-3.5 flex items-center justify-between text-xs text-slate-300">
        <span>{formatNumber(order.items.length)} {itemsLabel}</span>
        <span className="font-semibold text-amber-200">{formatCurrency(order.totalPrice, "IQD", "en-US")}</span>
      </div>
    </button>
  );
};

export const AdminDashboard = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const initialRequestedTab = searchParams.get("tab");
  const initialTab: TabKey = isAdminTabKey(initialRequestedTab) ? initialRequestedTab : "home";
  const initialSelectedOrderId = searchParams.get("order") ?? "";
  const initialMobileOrdersView = searchParams.get("panel") === "detail" ? "detail" : "list";
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [orderSearch, setOrderSearch] = useState("");
  const deferredOrderSearch = useDeferredValue(orderSearch);
  const [selectedOrderId, setSelectedOrderId] = useState(initialSelectedOrderId);
  const [mobileOrdersView, setMobileOrdersView] = useState<"list" | "detail">(initialMobileOrdersView);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [menuVisibility, setMenuVisibility] = useState<Record<MenuVisibilityKey, boolean>>(() => readMenuVisibility());
  const [settingsUnlocked, setSettingsUnlocked] = useState(false);
  const [settingsPinInput, setSettingsPinInput] = useState("");
  const [settingsExportSearch, setSettingsExportSearch] = useState("");
  const [settingsExportStatusFilter, setSettingsExportStatusFilter] = useState<string>("");
  const [revenueRangeForm, setRevenueRangeForm] = useState<RevenueRangeForm>(() => getInitialRevenueRangeForm());
  const [appliedRevenueRange, setAppliedRevenueRange] = useState<RevenueRangeRequest | null>(() => buildRevenueRangeRequest(getInitialRevenueRangeForm()));
  const requestedTab = searchParams.get("tab");
  const requestedOrderId = searchParams.get("order") ?? "";
  const requestedMobilePanel = searchParams.get("panel") === "detail" ? "detail" : "list";

  useAppExitGuard(true);

  const updateAdminRoute = (
    nextTab: TabKey,
    options?: { orderId?: string; panel?: "list" | "detail"; replace?: boolean }
  ) => {
    const nextParams = new URLSearchParams();
    if (nextTab !== "home") {
      nextParams.set("tab", nextTab);
    }
    if (nextTab === "orders" && options?.orderId) {
      nextParams.set("order", options.orderId);
    }
    if (nextTab === "orders" && options?.panel === "detail") {
      nextParams.set("panel", "detail");
    }
    const nextSearch = nextParams.toString();
    navigate(nextSearch ? `/admin?${nextSearch}` : "/admin", { replace: options?.replace });
  };

  const openAdminTab = (nextTab: TabKey, replace = false) => {
    if (tab !== nextTab) {
      setTab(nextTab);
    }
    if (nextTab !== "orders" && mobileOrdersView !== "list") {
      setMobileOrdersView("list");
    }
    updateAdminRoute(nextTab, { replace });
  };

  useEffect(() => {
    const nextTab = isAdminTabKey(requestedTab) ? requestedTab : "home";
    if (tab !== nextTab) {
      setTab(nextTab);
    }

    if (nextTab !== "orders") {
      if (selectedOrderId) {
        setSelectedOrderId("");
      }
    } else if (requestedOrderId && selectedOrderId !== requestedOrderId) {
      setSelectedOrderId(requestedOrderId);
    }

    const nextMobileOrdersView = nextTab === "orders" ? requestedMobilePanel : "list";
    if (mobileOrdersView !== nextMobileOrdersView) {
      setMobileOrdersView(nextMobileOrdersView);
    }
  }, [requestedTab, requestedOrderId, requestedMobilePanel, tab, selectedOrderId, mobileOrdersView]);

  const pollingInterval = isRealtimeEnabled() ? false : 5000;

  const summaryQuery = useQuery({
    queryKey: ["admin", "summary"],
    queryFn: api.admin.getSummary,
    refetchInterval: pollingInterval
  });
  const revenueRangeQuery = useQuery({
    queryKey: ["admin", "revenue-range", appliedRevenueRange],
    queryFn: () => api.admin.getRevenueRange({ startAt: appliedRevenueRange!.startAt, endAt: appliedRevenueRange!.endAt }),
    enabled: Boolean(appliedRevenueRange),
    refetchInterval: pollingInterval
  });
  const ordersQuery = useQuery({
    queryKey: ["admin", "orders", statusFilter, deferredOrderSearch],
    queryFn: () => api.admin.getOrders({ status: statusFilter || undefined, q: deferredOrderSearch || undefined }),
    refetchInterval: pollingInterval
  });
  const menuItemsQuery = useQuery({
    queryKey: ["admin", "menu-items"],
    queryFn: api.admin.getMenuItems,
    refetchInterval: pollingInterval
  });
  const categoriesQuery = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: api.admin.getAdminCategories,
    refetchInterval: pollingInterval
  });
  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: api.admin.getUsers,
    refetchInterval: pollingInterval
  });
  const activityQuery = useQuery({
    queryKey: ["admin", "activity"],
    queryFn: api.admin.getActivity,
    refetchInterval: pollingInterval
  });

  useEffect(() => {
    if (tab !== "orders") return;
    const visibleOrders = ordersQuery.data ?? [];
    if (!visibleOrders.length) {
      if (selectedOrderId) {
        setSelectedOrderId("");
      }
      if (mobileOrdersView !== "list") {
        setMobileOrdersView("list");
      }
      return;
    }
    const fallbackOrderId = visibleOrders[0]!.id;
    if ((!selectedOrderId || !visibleOrders.some((order) => order.id === selectedOrderId)) && selectedOrderId !== fallbackOrderId) {
      setSelectedOrderId(fallbackOrderId);
    }
  }, [mobileOrdersView, ordersQuery.data, selectedOrderId, tab]);

  useEffect(() => {
    if (tab !== "orders" && mobileOrdersView !== "list") {
      setMobileOrdersView("list");
    }
  }, [mobileOrdersView, tab]);

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin"] }),
      queryClient.invalidateQueries({ queryKey: ["menu"] }),
      queryClient.invalidateQueries({ queryKey: ["orders"] })
    ]);
  };

  const statusMutation = useMutation({ mutationFn: ({ id, status }: { id: string; status: OrderStatus }) => api.admin.updateOrderStatus(id, { status }), onSuccess: async () => { toast.success(t("notifications.saved")); await invalidateAll(); } });
  const deleteCategoryMutation = useMutation({ mutationFn: (id: string) => api.admin.deleteCategory(id), onSuccess: async () => { toast.success(t("notifications.saved")); await invalidateAll(); } });
  const deleteMenuMutation = useMutation({ mutationFn: (id: string) => api.admin.deleteMenuItem(id), onSuccess: async () => { toast.success(t("notifications.saved")); await invalidateAll(); } });
  const saveUserMutation = useMutation({ mutationFn: () => api.admin.createUser(userForm), onSuccess: async () => { toast.success(t("notifications.saved")); setUserForm(emptyUserForm); await invalidateAll(); } });
  const deleteUserMutation = useMutation({ mutationFn: (id: string) => api.admin.deleteUser(id), onSuccess: async () => { toast.success(t("notifications.saved")); await invalidateAll(); } });

  const applyRevenueRange = () => {
    const nextRange = buildRevenueRangeRequest(revenueRangeForm);
    if (!nextRange) {
      toast.error("تکایە ماوەیەکی دروست هەڵبژێرە");
      return;
    }

    setAppliedRevenueRange(nextRange);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(adminMenuVisibilityStorageKey, JSON.stringify(menuVisibility));
  }, [menuVisibility]);

  useEffect(() => {
    if (tab === "settings" || tab === "about") return;
    if (!menuVisibility[tab as MenuVisibilityKey]) {
      openAdminTab("home", true);
    }
  }, [menuVisibility, tab]);

  const summary = summaryQuery.data?.summary;
  const visibleOrders = ordersQuery.data ?? [];
  const menuItemsById = useMemo(() => new Map((menuItemsQuery.data ?? []).map((item) => [item.id, item])), [menuItemsQuery.data]);
  const selectedOrder = visibleOrders.find((order) => order.id === selectedOrderId) ?? null;
  const selectedOrderIndex = selectedOrder ? visibleOrders.findIndex((order) => order.id === selectedOrder.id) : -1;
  const nextOrder = selectedOrderIndex >= 0 ? visibleOrders[selectedOrderIndex + 1] ?? null : null;
  const visibleTabs = tabs.filter((entry) => entry === "settings" || entry === "about" || menuVisibility[entry as MenuVisibilityKey]);
  const categoryItemCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const item of menuItemsQuery.data ?? []) {
      counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    }

    return counts;
  }, [menuItemsQuery.data]);
  const revenueRangeLabel = formatRevenueRangeLabel(appliedRevenueRange);

  const openOrderDetails = (orderId: string) => {
    setSelectedOrderId(orderId);
    setMobileOrdersView("detail");
    updateAdminRoute("orders", { orderId, panel: "detail" });
  };

  const showAllOrders = () => {
    if (mobileOrdersView !== "list") {
      setMobileOrdersView("list");
    }
    updateAdminRoute("orders");
  };

  const openNextOrder = () => {
    if (!nextOrder) return;
    setSelectedOrderId(nextOrder.id);
    setMobileOrdersView("detail");
    updateAdminRoute("orders", { orderId: nextOrder.id, panel: "detail" });
  };

  const renderSelectedOrderContent = (order: OrderDto) => {
    const parsedAddress = parseIraqAddress(order.customerAddressKu);
    const hasDistrict = Boolean(parsedAddress.district);
    const submittedByName = order.submittedByName ?? "-";

    return (
      <div className="space-y-6">
        <div className="min-w-0 rounded-[24px] border border-white/10 bg-slate-950/35 p-4 sm:rounded-[28px] sm:p-5">
          <div className="flex flex-col gap-4 min-[1500px]:flex-row min-[1500px]:items-start min-[1500px]:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t("common.orderDetails")}</p>
              <h3 className="mt-2 font-display text-xl font-extrabold text-white break-all sm:text-3xl">{toEnglishDigits(order.orderCode)}</h3>
              <p className="mt-2 break-words text-sm text-slate-300">{order.customerNameKu}</p>
              <p className="mt-2 text-sm font-semibold text-amber-100">نێردراوە لەلایەن {submittedByName}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={order.status} />
              <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100">{formatCurrency(order.totalPrice, "IQD", "en-US")}</span>
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-4 rounded-[24px] border border-white/10 bg-slate-950/35 p-4 sm:rounded-[28px] sm:p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t("admin.customerInfo")}</p>
          <div className="grid gap-3 min-[1500px]:grid-cols-2">
            <OrderMetaRow icon={Users2} label="کارمەندی ناردن" value={submittedByName} />
            <OrderMetaRow icon={Users2} label={t("common.customerName")} value={order.customerNameKu} />
            <OrderMetaRow icon={Phone} label={t("common.customerPhone")} value={toEnglishDigits(order.customerPhone)} dir="ltr" />
            <OrderMetaRow icon={MapPin} label={hasDistrict ? "پارێزگا" : "پارێزگا / شار / ناحیە"} value={parsedAddress.governorate} />
            {hasDistrict ? <OrderMetaRow icon={MapPin} label="شار / ناحیە" value={parsedAddress.district} /> : null}
            <OrderMetaRow icon={MapPin} label="وردەکاری ناونیشان" value={parsedAddress.details} />
            <OrderMetaRow icon={CalendarClock} label="کاتی داواکردن" value={formatDateTime(order.placedAt)} />
          </div>
          {order.notesKu ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-slate-400">
                <NotebookText className="h-4 w-4" />
                <span>{t("common.notes")}</span>
              </div>
              <p className="mt-3 text-sm text-slate-100">{order.notesKu}</p>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 rounded-[24px] border border-white/10 bg-slate-950/35 p-4 sm:rounded-[28px] sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t("admin.orderedItems")}</p>
            <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
              {formatNumber(order.items.length)} {t("common.items")}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {order.items.map((item) => (
              <div key={`${order.id}-${item.menuItemId}`} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:p-4">
                <div className="h-24 overflow-hidden rounded-[18px]">
                  {menuItemsById.get(item.menuItemId)?.imageUrl ? (
                    <img
                      src={menuItemsById.get(item.menuItemId)!.imageUrl!}
                      alt={item.nameKu}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-slate-700 to-slate-900" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-white break-words">{item.nameKu}</p>
                      <p className="mt-1 text-xs text-slate-400 break-words">{item.categoryNameKu}</p>
                    </div>
                    <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
                      {formatCurrency(item.totalPrice, "IQD", "en-US")}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-2xl bg-slate-950/45 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t("common.quantity")}</p>
                      <p className="mt-1 text-sm font-semibold text-white">{formatNumber(item.quantity)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-950/45 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t("common.price")}</p>
                      <p className="mt-1 text-sm font-semibold text-white">{formatCurrency(item.unitPrice, "IQD", "en-US")}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl bg-white/5 px-4 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-300">کۆی گشتی</p>
              <p className="text-base font-bold text-amber-200 sm:text-lg">{formatCurrency(order.totalPrice, "IQD", "en-US")}</p>
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-4 rounded-[24px] border border-white/10 bg-slate-950/35 p-4 sm:rounded-[28px] sm:p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t("admin.orderActions")}</p>
          {nextStatusMap[order.status] ? <button type="button" onClick={() => statusMutation.mutate({ id: order.id, status: nextStatusMap[order.status]! })} className="w-full rounded-2xl bg-amber-300 px-4 py-2.5 text-[0.95rem] font-bold text-slate-950">{t(`status.${nextStatusMap[order.status]!}`)}</button> : null}
          {!nextStatusMap[order.status] ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
              کۆتایی هات
            </div>
          ) : null}
        </div>

        <div className="min-w-0 rounded-[24px] border border-white/10 bg-slate-950/35 p-4 sm:rounded-[28px] sm:p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t("admin.statusTimeline")}</p>
          <div className="mt-4 space-y-3">
            {order.statusHistory.map((event, index) => (
              <div key={`${order.id}-${event.changedAt}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={event.status} />
                    <span className="text-sm font-semibold text-white">{event.changedBy ?? "-"}</span>
                  </div>
                  <span className="text-xs text-slate-400">{formatDateTime(event.changedAt)}</span>
                </div>
                {event.note ? <p className="mt-3 text-sm text-slate-300">{event.note}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="app-shell">
      <div className="app-stage-admin">
        <div className="grid gap-4 min-[1600px]:grid-cols-[16rem_minmax(0,1fr)] 2xl:gap-6">
          <aside className="min-w-0 space-y-4 min-[1600px]:sticky min-[1600px]:top-4 min-[1600px]:self-start">
            <nav className="no-scrollbar flex gap-2 overflow-x-auto rounded-[20px] border border-white/10 bg-white/5 p-2 backdrop-blur-xl min-[1600px]:flex-col min-[1600px]:overflow-visible sm:rounded-[28px] sm:p-3">
              {visibleTabs.map((entry) => {
                const Icon = tabIcons[entry];
                return (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => {
                      if (entry === "settings" && !settingsUnlocked) {
                        startTransition(() => openAdminTab("settings"));
                        return;
                      }
                      startTransition(() => openAdminTab(entry));
                    }}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-3 rounded-[18px] px-3.5 py-2.5 text-[0.85rem] font-semibold transition min-[1600px]:w-full sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm",
                      tab === entry
                        ? "bg-white text-slate-900"
                        : "bg-slate-950/25 text-slate-300 hover:bg-white/10"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="whitespace-nowrap">{t(tabLabelKey[entry])}</span>
                  </button>
                );
              })}
            </nav>


          </aside>

          <main className="min-w-0 space-y-4 sm:space-y-6">
            <header className="app-panel sm:rounded-[30px]">
              <div className="flex flex-col gap-5 min-[1700px]:flex-row min-[1700px]:items-center min-[1700px]:justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.35em] text-sky-200/75">{t("nav.admin")}</p>
                  <h1 className="mt-3 font-display text-[clamp(1.7rem,4vw,3rem)] font-extrabold text-white">{t("admin.dashboardTitle")}</h1>
                  <p className="mt-2.5 max-w-3xl text-[0.92rem] leading-6 text-slate-300">{t("app.tagline")}</p>
                </div>
                <div className="flex w-full flex-col gap-3 min-[1700px]:w-auto min-[1700px]:items-end">
                  <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center sm:justify-end">
                    <div className="w-full min-[420px]:w-auto">
                      <LanguageSwitcher />
                    </div>
                    <div className="self-end min-[420px]:self-auto">
                      <ThemeToggle />
                    </div>
                  </div>
                  <div className="grid gap-3 min-[520px]:grid-cols-2 sm:justify-end">
                    <button type="button" onClick={() => void invalidateAll()} className="compact-pill-button"><RefreshCw className="h-4 w-4" /> {t("common.refresh")}</button>
                    <button type="button" onClick={() => void logout()} className="compact-pill-button"><LogOut className="h-4 w-4" /> {t("common.logout")}</button>
                  </div>
                </div>
              </div>
            </header>



            {tab === "home" ? (
              <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] 2xl:gap-6">
                <Section title={t("nav.home")} icon={House}>
                  <div className="grid gap-3 min-[460px]:grid-cols-2 min-[1500px]:grid-cols-3">
                    {tabs
                      .filter((entry) => entry !== "home" && entry !== "settings" && entry !== "about")
                      .filter((entry) => menuVisibility[entry as MenuVisibilityKey])
                      .map((entry) => {
                        const Icon = tabIcons[entry];
                        const count =
                          entry === "menu"
                            ? menuItemsQuery.data?.length ?? 0
                            : entry === "categories"
                              ? categoriesQuery.data?.length ?? 0
                              : entry === "users"
                                ? usersQuery.data?.length ?? 0
                                : entry === "activity"
                                  ? activityQuery.data?.length ?? 0
                                  : undefined;

                        return (
                          <button
                            key={entry}
                            type="button"
                            onClick={() => startTransition(() => openAdminTab(entry))}
                            className="min-w-0 rounded-[22px] border border-white/10 bg-slate-950/35 p-4 text-left transition hover:border-sky-300/30 hover:bg-white/5"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="inline-flex min-w-0 items-center gap-3">
                                <span className="rounded-2xl bg-white/10 p-2 text-sky-100">
                                  <Icon className="h-5 w-5" />
                                </span>
                                <span className="truncate text-sm font-semibold text-white">{t(tabLabelKey[entry])}</span>
                              </div>
                              {count !== undefined ? <span className="font-display text-xl font-extrabold text-amber-200 sm:text-2xl">{count}</span> : null}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </Section>

                <Section title={t("common.recentActivity")} icon={BarChart3}>
                  <div className="space-y-3">
                    {(activityQuery.data ?? []).slice(0, 5).map((entry) => (
                      <div key={entry.id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-white">{entry.actorName}</p>
                          <p className="text-xs text-slate-400">{formatDateTime(entry.createdAt)}</p>
                        </div>
                        <p className="mt-2 text-sm text-slate-300">{entry.action} • {entry.entityType}</p>
                      </div>
                    ))}
                    {!activityQuery.isLoading && !(activityQuery.data ?? []).length ? (
                      <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/30 p-8 text-center text-sm text-slate-300">
                        <BarChart3 className="mx-auto mb-3 h-8 w-8 text-slate-500" />
                        {t("common.noResults")}
                      </div>
                    ) : null}
                  </div>
                </Section>
              </div>
            ) : null}

            {tab === "orders" ? (
              <>
                <div className={cn("space-y-4 min-[1700px]:hidden", mobileOrdersView === "detail" ? "hidden" : "block")}>
                  <Section title={t("admin.ordersBoard")} icon={ClipboardList}>
                    <div className="space-y-4">
                      <input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder={t("admin.orderSearchHint")} className="compact-input" />
                      <div className="grid gap-3">
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="compact-input">
                          <option value="">{t("common.all")}</option>
                          {orderStatuses.map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}
                        </select>
                      </div>

                      <div className="space-y-3">
                        {visibleOrders.map((order) => (
                          <OrderListCard key={order.id} order={order} isSelected={selectedOrderId === order.id} onSelect={() => openOrderDetails(order.id)} itemsLabel={t("common.items")} />
                        ))}
                        {!ordersQuery.isLoading && !visibleOrders.length ? (
                          <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/30 p-8 text-center text-sm text-slate-300">
                            <PackageSearch className="mx-auto mb-3 h-8 w-8 text-slate-500" />
                            {t("admin.noOrders")}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </Section>
                </div>

                <div className={cn("space-y-4 min-[1700px]:hidden", mobileOrdersView === "detail" ? "block" : "hidden")}>
                  <Section title={selectedOrder ? toEnglishDigits(selectedOrder.orderCode) : t("common.orderDetails")} icon={ReceiptText}>
                    {!selectedOrder ? (
                      <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/30 p-10 text-center text-sm text-slate-300">
                        <ReceiptText className="mx-auto mb-3 h-8 w-8 text-slate-500" />
                        {t("admin.selectOrder")}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded-[20px] border border-white/10 bg-slate-950/35 p-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <button type="button" onClick={showAllOrders} className="compact-pill-button">
                              <ChevronLeft className="h-4 w-4" />
                              گەڕانەوە
                            </button>
                            <div className="flex flex-wrap gap-2">
                              <button type="button" onClick={showAllOrders} className="compact-pill-button">
                                هەموو داواکاریەکان
                              </button>
                              <button type="button" onClick={openNextOrder} disabled={!nextOrder} className="compact-pill-button disabled:cursor-not-allowed disabled:opacity-50">
                                داواکاری داهاتوو
                                <ChevronRight className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                        {renderSelectedOrderContent(selectedOrder)}
                      </div>
                    )}
                  </Section>
                </div>

                <div className="hidden gap-4 min-[1700px]:grid min-[1700px]:grid-cols-[22rem_minmax(0,1fr)] 2xl:gap-6">
                  <Section title={t("admin.ordersBoard")} icon={ClipboardList}>
                    <div className="space-y-4">
                      <input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder={t("admin.orderSearchHint")} className="compact-input" />
                      <div className="grid gap-3">
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="compact-input">
                          <option value="">{t("common.all")}</option>
                          {orderStatuses.map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}
                        </select>
                      </div>

                      <div className="space-y-3 min-[1700px]:max-h-[calc(100vh-20rem)] min-[1700px]:overflow-y-auto min-[1700px]:pr-1">
                        {visibleOrders.map((order) => (
                          <OrderListCard key={order.id} order={order} isSelected={selectedOrderId === order.id} onSelect={() => setSelectedOrderId(order.id)} itemsLabel={t("common.items")} />
                        ))}
                        {!ordersQuery.isLoading && !visibleOrders.length ? (
                          <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/30 p-8 text-center text-sm text-slate-300">
                            <PackageSearch className="mx-auto mb-3 h-8 w-8 text-slate-500" />
                            {t("admin.noOrders")}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </Section>

                  <Section title={selectedOrder ? toEnglishDigits(selectedOrder.orderCode) : t("common.orderDetails")} icon={ReceiptText}>
                    {!selectedOrder ? (
                      <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/30 p-10 text-center text-sm text-slate-300">
                        <ReceiptText className="mx-auto mb-3 h-8 w-8 text-slate-500" />
                        {t("admin.selectOrder")}
                      </div>
                    ) : (
                      renderSelectedOrderContent(selectedOrder)
                    )}
                  </Section>
                </div>
              </>
            ) : null}

        {tab === "revenue" ? (
          <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] 2xl:gap-6">
            <Section title={t("nav.revenue")} icon={DollarSign}>
              <div className="space-y-4">
                <div className="grid gap-3 min-[1500px]:grid-cols-3">
                  <MetricCard label={t("admin.revenueToday")} value={formatCurrency(summary?.revenueToday ?? 0, "IQD", "en-US")} />
                  <MetricCard label={t("admin.revenueWeek")} value={formatCurrency(summary?.revenueWeek ?? 0, "IQD", "en-US")} />
                  <MetricCard label={t("admin.revenueMonth")} value={formatCurrency(summary?.revenueMonth ?? 0, "IQD", "en-US")} />
                </div>
                <div className="grid gap-3 min-[460px]:grid-cols-2 min-[1500px]:grid-cols-3">
                  <MetricCard label={t("admin.totalOrders")} value={formatNumber(summary?.totalOrders ?? 0)} />
                  <MetricCard label={t("admin.activeOrders")} value={formatNumber(summary?.activeOrders ?? 0)} />
                  <MetricCard label={t("admin.deliveredOrders")} value={formatNumber(summary?.deliveredOrders ?? 0)} />
                </div>
                <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5">
                  <div className="flex flex-col gap-2">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Revenue Format</p>
                    <h3 className="font-display text-xl font-bold text-white sm:text-2xl">English Numerals</h3>
                    <p className="text-[0.92rem] leading-6 text-slate-300">هەموو ژمارەکانی ئەم بەشە بە شێوەی ئینگلیزی نیشان دەدرێن بۆ خوێندنەوەی ڕوونتر و کاریگەری زیاتر.</p>
                  </div>
                </div>
              </div>
            </Section>

            <Section title="شیکردنەوەی داهات" icon={CalendarClock}>
              <div className="space-y-5">
                <div className="grid gap-2 min-[520px]:grid-cols-2 min-[1500px]:grid-cols-4">
                  {revenueRangeModes.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => setRevenueRangeForm((prev) => ({ ...prev, mode: entry.key }))}
                      className={cn(
                        "rounded-2xl px-4 py-2.5 text-[0.9rem] font-semibold transition",
                        revenueRangeForm.mode === entry.key
                          ? "bg-amber-300 text-slate-950"
                          : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                      )}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>

                <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4 sm:p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {revenueRangeForm.mode === "day" ? (
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-slate-200">ڕۆژ</span>
                        <input
                          type="date"
                          lang="en"
                          value={revenueRangeForm.day}
                          onChange={(event) => setRevenueRangeForm((prev) => ({ ...prev, day: event.target.value }))}
                          className="compact-input bg-white/5"
                        />
                      </label>
                    ) : null}

                    {revenueRangeForm.mode === "month" ? (
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-slate-200">مانگ</span>
                        <input
                          type="month"
                          lang="en"
                          value={revenueRangeForm.month}
                          onChange={(event) => setRevenueRangeForm((prev) => ({ ...prev, month: event.target.value }))}
                          className="compact-input bg-white/5"
                        />
                      </label>
                    ) : null}

                    {revenueRangeForm.mode === "year" ? (
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-slate-200">ساڵ</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="2000"
                          max="2100"
                          lang="en"
                          value={revenueRangeForm.year}
                          onChange={(event) => setRevenueRangeForm((prev) => ({ ...prev, year: event.target.value.replace(/\D/g, "").slice(0, 4) }))}
                          className="compact-input bg-white/5"
                        />
                      </label>
                    ) : null}

                    {revenueRangeForm.mode === "custom" ? (
                      <>
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-200">لە</span>
                          <input
                            type="date"
                            lang="en"
                            value={revenueRangeForm.from}
                            onChange={(event) => setRevenueRangeForm((prev) => ({ ...prev, from: event.target.value }))}
                            className="compact-input bg-white/5"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-200">تا</span>
                          <input
                            type="date"
                            lang="en"
                            value={revenueRangeForm.to}
                            onChange={(event) => setRevenueRangeForm((prev) => ({ ...prev, to: event.target.value }))}
                            className="compact-input bg-white/5"
                          />
                        </label>
                      </>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={applyRevenueRange}
                    className="mt-4 w-full rounded-2xl bg-amber-300 px-4 py-2.5 text-[0.95rem] font-bold text-slate-950 sm:w-auto"
                  >
                    هەژمارکردنی داهات
                  </button>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 sm:p-5">
                  <div className="flex flex-col gap-2">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Selected Range</p>
                    <h3 className="font-display text-xl font-bold text-white sm:text-2xl">{revenueRangeLabel}</h3>
                    <p className="text-[0.92rem] leading-6 text-slate-300">نمونە: لە `12`ی ئەم مانگە تا `19`ی ئەم مانگە، لێرە ڕێژەی داهاتەکە دەردەکەوێت.</p>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 min-[1500px]:grid-cols-3">
                    <MetricCard label="کۆی داهات" value={formatCurrency(revenueRangeQuery.data?.revenue ?? 0, "IQD", "en-US")} />
                    <MetricCard label="داواکارییە گەیشتووەکان" value={formatNumber(revenueRangeQuery.data?.deliveredOrders ?? 0)} />
                    <MetricCard label="ناوەندی هەر داواکارییەک" value={formatCurrency(revenueRangeQuery.data?.averageOrderValue ?? 0, "IQD", "en-US")} />
                  </div>

                  {revenueRangeQuery.isLoading ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-slate-950/30 p-4 text-sm text-slate-300">
                      {t("common.loading")}
                    </div>
                  ) : null}
                </div>
              </div>
            </Section>
          </div>
        ) : null}

        {tab === "menu" ? (
          <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] 2xl:gap-6">
            <Section title={t("admin.addFood")} icon={PlusCircle}>
              <div className="space-y-3">
                <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4 sm:p-5">
                  <h3 className="font-display text-xl font-bold text-white">بەڕێوەبردنی خواردنەکان</h3>
                  <p className="mt-3 text-[0.92rem] leading-6 text-slate-300">
                    زیادکردن، دەستکاری، گۆڕینی نرخ، بارکردنی وێنە، و ON/OFF کردنی بەردەستبوون هەمووی لە پەیجی تایبەت بەڕێوە دەبرێت بۆ ئەوەی لە مۆبایل و لاپتۆپ هەردووکیان ئاسان بێت.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => navigate("/admin/menu-items/new")}
                      className="rounded-2xl bg-amber-300 px-4 py-3 text-[0.95rem] font-bold text-slate-950"
                    >
                      خواردنی نوێ زیاد بکە
                    </button>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                      <p className="font-semibold text-white">{formatNumber(menuItemsQuery.data?.length ?? 0)} خواردن</p>
                      <p className="mt-1 text-xs text-slate-400">هەموو edit ـەکان ڕاستەوخۆ بۆ پەیجی تایبەت دەڕۆن.</p>
                    </div>
                  </div>
                </div>
              </div>
            </Section>
            <Section title={t("nav.menuManagement")} icon={LayoutGrid}>
              <div className="grid gap-4 min-[460px]:grid-cols-2">
                {(menuItemsQuery.data ?? []).map((item) => {
                  const text = getMenuText(item, locale);
                  return (
                    <article key={item.id} className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-white break-words">{text.name}</p><p className="text-xs text-slate-400">{formatCurrency(Number(item.basePrice), "IQD", "en-US")}</p></div><StatusBadge status={item.isAvailable ? "READY" : "CANCELLED"} /></div>
                      <p className="mt-3 break-words text-sm text-slate-300">{text.description}</p>
                      <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => navigate(`/admin/menu-items/${item.id}`)} className="rounded-full bg-sky-300 px-3 py-2 text-xs font-bold text-slate-950">{t("common.edit")}</button><button type="button" onClick={() => {
                        if (window.confirm("دڵنیایت دەتەوێت ئەم خواردنە بسڕیتەوە؟")) {
                          deleteMenuMutation.mutate(item.id);
                        }
                      }} className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-slate-200">{t("common.delete")}</button></div>
                    </article>
                  );
                })}
              </div>
            </Section>
          </div>
        ) : null}

        {tab === "categories" ? (
          <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] 2xl:gap-6">
            <Section title={t("admin.addCategory")} icon={PlusCircle}>
              <div className="space-y-3">
                <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4 sm:p-5">
                  <h3 className="font-display text-xl font-bold text-white">بەڕێوەبردنی پۆلەکان</h3>
                  <p className="mt-3 text-[0.92rem] leading-6 text-slate-300">
                    پۆلی نوێ زیاد بکە، ناوەکان بە هەموو زمانەکان دەستکاری بکە، icon و sort order بگۆڕە، و لە پەیجی تایبەت هەموو وردەکارییەکان بەڕێوەببە.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => navigate("/admin/categories/new")}
                      className="rounded-2xl bg-amber-300 px-4 py-3 text-[0.95rem] font-bold text-slate-950"
                    >
                      پۆلی نوێ زیاد بکە
                    </button>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                      <p className="font-semibold text-white">{formatNumber(categoriesQuery.data?.length ?? 0)} پۆل</p>
                      <p className="mt-1 text-xs text-slate-400">هەموو edit ـەکان بۆ پەیجی جیاواز دەڕۆن.</p>
                    </div>
                  </div>
                </div>
              </div>
            </Section>
            <Section title={t("nav.categories")} icon={BarChart3}>
              <div className="space-y-3">
                {(categoriesQuery.data ?? []).map((category) => (
                  <div key={category.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/35 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-white">{getCategoryName(category, locale)}</p>
                        <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[11px] font-semibold text-amber-100">
                          {formatNumber(categoryItemCounts.get(category.id) ?? 0)} ئایتیم
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{category.slug}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => navigate(`/admin/categories/${category.id}`)} className="rounded-full bg-sky-300 px-3 py-2 text-xs font-bold text-slate-950">{t("common.edit")}</button>
                      <button type="button" onClick={() => {
                        if (window.confirm("دڵنیایت دەتەوێت ئەم پۆلە بسڕیتەوە؟")) {
                          deleteCategoryMutation.mutate(category.id);
                        }
                      }} className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-slate-200">{t("common.delete")}</button>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        ) : null}

        {tab === "users" ? (
          <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,0.76fr)_minmax(0,1.24fr)] 2xl:gap-6">
            <Section title={t("admin.addUser")} icon={Users2}>
              <div className="space-y-3">
                <input value={userForm.displayName} onChange={(event) => setUserForm((prev) => ({ ...prev, displayName: event.target.value }))} placeholder={t("common.customerName")} className="compact-input" />
                <input value={userForm.pin} onChange={(event) => setUserForm((prev) => ({ ...prev, pin: event.target.value.replace(/\D/g, "").slice(0, 4) }))} placeholder="PIN" className="compact-input" />
                <select value={userForm.role} onChange={(event) => setUserForm((prev) => ({ ...prev, role: event.target.value as typeof prev.role }))} className="compact-input"><option value="CUSTOMER">Customer</option><option value="ADMIN">Admin</option></select>
                <select value={userForm.preferredLocale} onChange={(event) => setUserForm((prev) => ({ ...prev, preferredLocale: event.target.value as Locale }))} className="compact-input">{locales.map((entry) => <option key={entry} value={entry}>{t(`languages.${entry}`)}</option>)}</select>
                <button type="button" onClick={() => saveUserMutation.mutate()} className="w-full rounded-2xl bg-amber-300 px-4 py-2.5 text-[0.95rem] font-semibold text-slate-950">{t("common.create")}</button>
              </div>
            </Section>
            <Section title={t("nav.users")} icon={Shield}>
              <div className="space-y-3">{(usersQuery.data ?? []).map((entry) => <div key={entry.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/35 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-white">{entry.displayName}</p><p className="text-xs text-slate-400">{entry.role} • {t(`languages.${entry.preferredLocale}`)}</p></div><button type="button" onClick={() => {
                if (window.confirm("دڵنیایت دەتەوێت ئەم بەکارهێنەرە بسڕیتەوە؟")) {
                  deleteUserMutation.mutate(entry.id);
                }
              }} className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-slate-200">{t("common.delete")}</button></div>)}</div>
            </Section>
          </div>
        ) : null}

        {tab === "activity" ? (
          <div className="grid gap-4">
            <Section title={t("common.recentActivity")} icon={BarChart3}>
              <div className="space-y-3">{(activityQuery.data ?? []).map((entry) => <div key={entry.id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4"><div className="flex items-center justify-between gap-3"><p className="font-semibold text-white">{entry.actorName}</p><p className="text-xs text-slate-400">{formatDateTime(entry.createdAt)}</p></div><p className="mt-2 text-sm text-slate-300">{toEnglishDigits(entry.action)} • {toEnglishDigits(entry.entityType)}</p></div>)}</div>
            </Section>
          </div>
            ) : null}

        {tab === "settings" ? (
          <div className="grid gap-4">
            <Section title={t("nav.settings")} icon={Settings}>
              {!settingsUnlocked ? (
                <div className="mx-auto max-w-xl rounded-[24px] border border-white/10 bg-slate-950/35 p-5 sm:p-6">
                  <h3 className="font-display text-xl font-bold text-white sm:text-2xl">PINی ڕێخستن</h3>
                  <p className="mt-3 text-[0.92rem] leading-6 text-slate-300">بۆ چوونە ناو بەشی ڕێخستن، PIN بنووسە.</p>
                  <div className="mt-5 space-y-4">
                    <input
                      value={settingsPinInput}
                      onChange={(event) => setSettingsPinInput(event.target.value.replace(/\D/g, "").slice(0, 4))}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      placeholder="چوار وشەی نهێنی بنووسە"
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-center font-display text-[2rem] tracking-[0.32em] text-white outline-none transition focus:border-amber-300/60 focus:bg-white/10 sm:text-3xl sm:tracking-[0.4em]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (settingsPinInput !== adminSettingsPin) {
                          toast.error("PIN هەڵەیە");
                          return;
                        }
                        setSettingsUnlocked(true);
                        setSettingsPinInput("");
                        toast.success("ڕێخستن کراوە");
                      }}
                      className="w-full rounded-2xl bg-amber-300 px-4 py-2.5 text-[0.95rem] font-bold text-slate-950"
                    >
                      چوونە ناو
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-white">ڕێخستنی بینینی مینو</h3>
                        <p className="mt-2 text-sm text-slate-300">هەر بەشێک دەتوانیت قفل بکەیت یان بکەیتەوە. ئەوەی `OFF` بێت لە مینو نادیار دەبێت.</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {manageableTabs.map((entry) => (
                        <div key={entry} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <span className="text-sm font-semibold text-white">{t(tabLabelKey[entry])}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setMenuVisibility((prev) => ({ ...prev, [entry]: !prev[entry] }));
                            }}
                            className={cn(
                              "min-w-24 rounded-full px-4 py-2 text-sm font-bold transition",
                              menuVisibility[entry] ? "bg-emerald-300 text-slate-950" : "bg-rose-300 text-slate-950"
                            )}
                          >
                            {menuVisibility[entry] ? "ON" : "OFF"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-white">هەناردەکردنی داتا</h3>
                        <p className="mt-2 text-sm text-slate-300">هەموو دوگمەکانی دابەزاندنی زانیاری ئێستا تەنها لێرەن. دەتوانیت بە status یان گەڕان export ـەکە پاڵاوت بکەیت.</p>
                      </div>
                      <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-300/20 bg-sky-400/10 text-sky-200">
                        <Download className="h-5 w-5" />
                      </div>
                    </div>
                    <div className="grid gap-3 min-[1500px]:grid-cols-[minmax(0,1fr)_14rem]">
                      <input
                        value={settingsExportSearch}
                        onChange={(event) => setSettingsExportSearch(event.target.value)}
                        placeholder={t("admin.orderSearchHint")}
                        className="compact-input"
                      />
                      <select
                        value={settingsExportStatusFilter}
                        onChange={(event) => setSettingsExportStatusFilter(event.target.value)}
                        className="compact-input"
                      >
                        <option value="">{t("common.all")}</option>
                        {orderStatuses.map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}
                      </select>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => void api.admin.downloadOrdersReport("xlsx", settingsExportStatusFilter || undefined, settingsExportSearch || undefined)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3 text-[0.95rem] font-semibold text-slate-950"
                      >
                        <Download className="h-4 w-4" />
                        {t("common.exportExcel")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void api.admin.downloadOrdersReport("pdf", settingsExportStatusFilter || undefined, settingsExportSearch || undefined)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-300 px-4 py-3 text-[0.95rem] font-semibold text-slate-950"
                      >
                        <Download className="h-4 w-4" />
                        {t("common.exportPdf")}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettingsUnlocked(false)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-semibold text-slate-200 hover:bg-white/10"
                  >
                    داخستنی قفل
                  </button>
                </div>
              )}
            </Section>
          </div>
        ) : null}

        {tab === "about" ? (
          <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] 2xl:gap-6">
            <Section title={t("nav.about")} icon={Info}>
              <div className="space-y-4">
                <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5 sm:p-6">
                  <p className="text-xs uppercase tracking-[0.3em] text-sky-200/80">دەربارەی خزمەتگوزاری</p>
                  <h3 className="mt-3 font-display text-2xl font-extrabold text-white sm:text-3xl">
                    بۆ دروستکردنی سیستەم و ئەپڵیکەیشن بە فول پڕۆفیشناڵ پەیوەندیمان پێوە بکەن
                  </h3>
                  <p className="mt-4 text-[0.95rem] leading-7 text-slate-300">
                    ئەم پەیجە بۆ ناساندنی خزمەتگوزارییە دیجیتاڵییەکانمانە. لە دروستکردنی سیستەمی تایبەت بۆ رێستۆران، بازاڕ، کاروبار،
                    و ئەپڵیکەیشنە مۆبایل و وێبە پڕۆفیشناڵەکاندا کار دەکەین بە شێوازێکی ڕێکخراو، خێرا، و پشتیوانیی بەردەوام.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <article className="rounded-[22px] border border-white/10 bg-white/5 p-4">
                    <h4 className="font-display text-lg font-bold text-white">UI/UX پڕۆفیشناڵ</h4>
                    <p className="mt-2 text-sm leading-7 text-slate-300">دیزاینێکی جوان، ڕێک و گونجاو بۆ مۆبایل، تابلێت و لاپتۆپ.</p>
                  </article>
                  <article className="rounded-[22px] border border-white/10 bg-white/5 p-4">
                    <h4 className="font-display text-lg font-bold text-white">سیستەمی تایبەت</h4>
                    <p className="mt-2 text-sm leading-7 text-slate-300">بە پێی پێداویستی کاروبارەکەت سیستەمی نوێ و گونجاو دروست دەکرێت.</p>
                  </article>
                  <article className="rounded-[22px] border border-white/10 bg-white/5 p-4">
                    <h4 className="font-display text-lg font-bold text-white">پشتیوانی و گەشەپێدان</h4>
                    <p className="mt-2 text-sm leading-7 text-slate-300">دوای تەواوبوونی کارەکەش لەگەڵت دەبین بۆ نوێکردنەوە و باشترکردن.</p>
                  </article>
                </div>

                <div className="rounded-[24px] border border-amber-300/20 bg-amber-300/10 p-5">
                  <p className="text-sm leading-7 text-amber-50">
                    بۆ زانیاری زیاتر و بینینی نمونەی کارەکان، کلیک لە دوگمەی `زانیاری زیاتر` بکە. ئەوە ڕاستەوخۆ دەتبات بۆ پەیجی تایبەتی زانیاری.
                  </p>
                  <a
                    href="https://98ramyar.netlify.app/"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-slate-950"
                  >
                    زانیاری زیاتر
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            </Section>

            <Section title="خزمەتگوزاریەکان" icon={Shield}>
              <div className="space-y-3 text-sm leading-7 text-slate-300">
                <div className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4">
                  <p className="font-semibold text-white">دروستکردنی وێبسایت و وێب ئەپ</p>
                  <p className="mt-2">وێبسایت و dashboard ی تایبەت بە دیزاینێکی خێرا و متمانەپێکراو.</p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4">
                  <p className="font-semibold text-white">دروستکردنی ئەپڵیکەیشنی مۆبایل</p>
                  <p className="mt-2">ئەندڕۆید و iOS بە UI ی جوان، کارایی باش، و ئاسانکاری بەکارهێنان.</p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4">
                  <p className="font-semibold text-white">سیستەمی بەڕێوەبردن بۆ کاروبار</p>
                  <p className="mt-2">بۆ فرۆشتن، داواکاری، پۆلەکان، بەکارهێنەرەکان و ڕاپۆرتەکانی داهات.</p>
                </div>
              </div>
            </Section>
          </div>
        ) : null}
          </main>
        </div>
      </div>
    </div>
  );
};

const AdminStandaloneFrame = ({
  title,
  subtitle,
  backHref,
  children
}: {
  title: string;
  subtitle: string;
  backHref: string;
  children: ReactNode;
}) => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  useAppExitGuard(true);

  return (
    <div className="app-shell">
      <div className="app-stage-admin space-y-4 sm:space-y-6">
        <header className="app-panel sm:rounded-[30px]">
          <div className="flex flex-col gap-5 min-[1500px]:flex-row min-[1500px]:items-start min-[1500px]:justify-between">
            <div className="min-w-0">
              <button type="button" onClick={() => navigate(backHref)} className="compact-pill-button">
                <ChevronLeft className="h-4 w-4" />
                گەڕانەوە
              </button>
              <h1 className="mt-4 font-display text-[clamp(1.7rem,4vw,3rem)] font-extrabold text-white">{title}</h1>
              <p className="mt-2.5 max-w-3xl text-[0.92rem] leading-6 text-slate-300">{subtitle}</p>
            </div>
            <div className="flex w-full flex-col gap-3 min-[1500px]:w-auto min-[1500px]:items-end">
              <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center sm:justify-end">
                <div className="w-full min-[420px]:w-auto">
                  <LanguageSwitcher />
                </div>
                <div className="self-end min-[420px]:self-auto">
                  <ThemeToggle />
                </div>
              </div>
              <button type="button" onClick={() => void logout()} className="compact-pill-button">
                <LogOut className="h-4 w-4" />
                چوونەدەرەوە
              </button>
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
};

const AdminCategoryEditorForm = ({
  form,
  setForm,
  onSave,
  onReset,
  onDelete,
  isCreate,
  isSaving,
  isDeleting
}: {
  form: CategoryFormState;
  setForm: React.Dispatch<React.SetStateAction<CategoryFormState>>;
  onSave: () => void;
  onReset: () => void;
  onDelete?: () => void;
  isCreate: boolean;
  isSaving: boolean;
  isDeleting: boolean;
}) => (
  <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)] 2xl:gap-6">
    <Section title={isCreate ? "زیادکردنی پۆل" : "دەستکاریکردنی پۆل"} icon={PlusCircle}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-200">Slug</span>
          <input value={form.slug} onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))} placeholder="healthy-bowls" className="compact-input" />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-200">Icon</span>
            <input value={form.icon} onChange={(event) => setForm((prev) => ({ ...prev, icon: event.target.value }))} placeholder="🍽️ / soup / salad" className="compact-input" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-200">Sort Order</span>
            <input value={String(form.sortOrder)} onChange={(event) => setForm((prev) => ({ ...prev, sortOrder: Number(event.target.value.replace(/\D/g, "")) || 0 }))} inputMode="numeric" className="compact-input" />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {locales.map((entry) => (
            <label key={entry} className="block rounded-2xl border border-white/10 bg-white/5 p-3.5">
              <span className="mb-2 block text-sm font-semibold text-slate-200">{entry.toUpperCase()}</span>
              <input
                value={form.names[entry] ?? ""}
                onChange={(event) => setForm((prev) => ({ ...prev, names: { ...prev.names, [entry]: event.target.value } }))}
                placeholder={`ناوی ${entry.toUpperCase()}`}
                className="compact-input bg-slate-950/35"
              />
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={onSave} disabled={isSaving || isDeleting} className="flex-1 rounded-2xl bg-amber-300 px-4 py-3 text-[0.95rem] font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
            {isSaving ? "بارکردن..." : isCreate ? "پاشەکەوتی پۆلی نوێ" : "پاشەکەوتی دەستکاری"}
          </button>
          <button type="button" onClick={onReset} disabled={isSaving || isDeleting} className="rounded-2xl border border-white/10 px-4 py-3 text-[0.95rem] font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-60">
            {isCreate ? "پاککردنەوە" : "گەڕاندنەوەی زانیاری"}
          </button>
          {onDelete ? (
            <button type="button" onClick={onDelete} disabled={isSaving || isDeleting} className="rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-[0.95rem] font-semibold text-rose-100 disabled:cursor-not-allowed disabled:opacity-60">
              {isDeleting ? "بارکردن..." : "سڕینەوەی پۆل"}
            </button>
          ) : null}
        </div>
      </div>
    </Section>

    <Section title="پوختە" icon={Info}>
      <div className="space-y-3 rounded-[24px] border border-white/10 bg-slate-950/35 p-4 sm:p-5">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Preview</p>
          <h3 className="mt-2 font-display text-2xl font-bold text-white">{form.names.ku || "ناوی پۆل"}</h3>
          <p className="mt-2 text-sm text-slate-300">{form.slug || "slug"}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Icon</p>
            <p className="mt-2 text-sm font-semibold text-white">{form.icon || "-"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Sort Order</p>
            <p className="mt-2 text-sm font-semibold text-white">{formatNumber(form.sortOrder)}</p>
          </div>
        </div>
      </div>
    </Section>
  </div>
);

const AdminMenuEditorForm = ({
  form,
  setForm,
  categories,
  locale,
  onSave,
  onReset,
  onDelete,
  isCreate,
  isSaving,
  isDeleting
}: {
  form: MenuFormState;
  setForm: React.Dispatch<React.SetStateAction<MenuFormState>>;
  categories: CategoryDto[];
  locale: Locale;
  onSave: () => void;
  onReset: () => void;
  onDelete?: () => void;
  isCreate: boolean;
  isSaving: boolean;
  isDeleting: boolean;
}) => (
  <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)] 2xl:gap-6">
    <Section title={isCreate ? "زیادکردنی خواردن" : "دەستکاریکردنی خواردن"} icon={PlusCircle}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-200">Slug</span>
            <input value={form.slug} onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))} placeholder="classic-burger" className="compact-input" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-200">پۆل</span>
            <select value={form.categoryId} onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))} className="compact-input">
              <option value="">پۆلەکە هەڵبژێرە</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{getCategoryName(category, locale)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-200">نرخ</span>
            <input value={form.basePrice} onChange={(event) => setForm((prev) => ({ ...prev, basePrice: event.target.value.replace(/[^\d.]/g, "") }))} inputMode="decimal" className="compact-input" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-200">Sort Order</span>
            <input value={String(form.sortOrder)} onChange={(event) => setForm((prev) => ({ ...prev, sortOrder: Number(event.target.value.replace(/\D/g, "")) || 0 }))} inputMode="numeric" className="compact-input" />
          </label>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <label className="block text-sm font-semibold text-slate-200">وێنەی خواردن</label>
          <p className="mt-2 text-xs text-slate-400">باشترین قەبارە 1:1 ـە و هەوڵ بدە وێنەی پاک و ڕوون باربکەیت.</p>
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              try {
                const imageUrl = await pickImageAsDataUrl(file);
                setForm((prev) => ({ ...prev, imageUrl }));
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Image upload failed");
              }
            }}
            className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-300 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-950"
          />
          {form.imageUrl ? (
            <div className="mt-4 space-y-3">
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <img src={form.imageUrl} alt="Preview" className="h-48 w-full object-cover" />
              </div>
              <button type="button" onClick={() => setForm((prev) => ({ ...prev, imageUrl: "" }))} className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-slate-200">
                سڕینەوەی وێنە
              </button>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3">
          {locales.map((entry) => (
            <div key={entry} className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
              <p className="mb-3 text-sm font-semibold text-slate-200">{entry.toUpperCase()}</p>
              <input
                value={form.translations[entry].name}
                onChange={(event) => setForm((prev) => ({ ...prev, translations: { ...prev.translations, [entry]: { ...prev.translations[entry], name: event.target.value } } }))}
                placeholder={`${entry.toUpperCase()} name`}
                className="compact-input mb-3 bg-slate-950/35"
              />
              <textarea
                value={form.translations[entry].description}
                onChange={(event) => setForm((prev) => ({ ...prev, translations: { ...prev.translations, [entry]: { ...prev.translations[entry], description: event.target.value } } }))}
                rows={3}
                placeholder={`${entry.toUpperCase()} description`}
                className="compact-input bg-slate-950/35"
              />
            </div>
          ))}
        </div>

        <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          <input type="checkbox" checked={form.isAvailable} onChange={(event) => setForm((prev) => ({ ...prev, isAvailable: event.target.checked }))} />
          خواردنەکە بەردەستە
        </label>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={onSave} disabled={isSaving || isDeleting} className="flex-1 rounded-2xl bg-amber-300 px-4 py-3 text-[0.95rem] font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
            {isSaving ? "بارکردن..." : isCreate ? "پاشەکەوتی خواردنی نوێ" : "پاشەکەوتی دەستکاری"}
          </button>
          <button type="button" onClick={onReset} disabled={isSaving || isDeleting} className="rounded-2xl border border-white/10 px-4 py-3 text-[0.95rem] font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-60">
            {isCreate ? "پاککردنەوە" : "گەڕاندنەوەی زانیاری"}
          </button>
          {onDelete ? (
            <button type="button" onClick={onDelete} disabled={isSaving || isDeleting} className="rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-[0.95rem] font-semibold text-rose-100 disabled:cursor-not-allowed disabled:opacity-60">
              {isDeleting ? "بارکردن..." : "سڕینەوەی خواردن"}
            </button>
          ) : null}
        </div>
      </div>
    </Section>

    <Section title="پوختە" icon={Info}>
      <div className="space-y-4 rounded-[24px] border border-white/10 bg-slate-950/35 p-4 sm:p-5">
        <div className="overflow-hidden rounded-2xl border border-white/10">
          {form.imageUrl ? (
            <img src={form.imageUrl} alt={form.translations.ku.name || "Preview"} className="h-56 w-full object-cover" />
          ) : (
            <div className="flex h-56 items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 text-sm text-slate-400">وێنە هێشتا نەبارکراوە</div>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Preview</p>
          <h3 className="mt-2 font-display text-2xl font-bold text-white">{form.translations.ku.name || "ناوی خواردن"}</h3>
          <p className="mt-2 text-sm text-slate-300">{form.translations.ku.description || "وەسفەکە لێرە دەردەکەوێت."}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Price</p>
            <p className="mt-2 text-sm font-semibold text-white">{formatCurrency(Number(form.basePrice) || 0, "IQD", "en-US")}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Status</p>
            <p className="mt-2 text-sm font-semibold text-white">{form.isAvailable ? "بەردەستە" : "بەردەست نییە"}</p>
          </div>
        </div>
      </div>
    </Section>
  </div>
);

export const AdminCategoryEditorPage = () => {
  const { categoryId } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isCreate = !categoryId || categoryId === "new";
  const categoriesQuery = useQuery({ queryKey: ["admin", "categories"], queryFn: api.admin.getAdminCategories });
  const category = useMemo(() => (categoriesQuery.data ?? []).find((entry) => entry.id === categoryId) ?? null, [categoriesQuery.data, categoryId]);
  const [form, setForm] = useState<CategoryFormState>(() => createEmptyCategoryForm());

  useEffect(() => {
    if (isCreate) {
      setForm(createEmptyCategoryForm());
      return;
    }
    if (category) {
      setForm(createCategoryFormFromCategory(category));
    }
  }, [isCreate, category]);

  const invalidateAdminCatalog = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "categories"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "menu-items"] }),
      queryClient.invalidateQueries({ queryKey: ["menu"] })
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = createCategoryPayload(form);
      if (!payload.slug) throw new Error("Slug بنووسە");
      if (!payload.names.ku) throw new Error("ناوی کوردیی پۆل بنووسە");
      return isCreate ? api.admin.createCategory(payload) : api.admin.updateCategory(categoryId!, payload);
    },
    onSuccess: async () => {
      toast.success("گۆڕانکارییەکە پاشەکەوت کرا");
      await invalidateAdminCatalog();
      navigate("/admin?tab=categories", { replace: true });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Category save failed");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.admin.deleteCategory(categoryId!),
    onSuccess: async () => {
      toast.success("پۆلەکە سڕایەوە");
      await invalidateAdminCatalog();
      navigate("/admin?tab=categories", { replace: true });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Category delete failed");
    }
  });

  if (!isCreate && categoriesQuery.isSuccess && !category) {
    return (
      <AdminStandaloneFrame title="پۆلەکە نەدۆزرایەوە" subtitle="ئەم پۆلە بوونی نییە یان سڕاوەتەوە." backHref="/admin?tab=categories">
        <Section title="گەڕانەوە" icon={Info}>
          <button type="button" onClick={() => navigate("/admin?tab=categories", { replace: true })} className="rounded-2xl bg-amber-300 px-4 py-3 text-[0.95rem] font-bold text-slate-950">
            بگەڕێوە بۆ پۆلەکان
          </button>
        </Section>
      </AdminStandaloneFrame>
    );
  }

  return (
    <AdminStandaloneFrame
      title={isCreate ? "پەیجی زیادکردنی پۆل" : "پەیجی دەستکاریکردنی پۆل"}
      subtitle="لەو پەیجەدا دەتوانیت ناوی پۆلەکە، icon، و ڕیزبەندیی پیشاندان بە شێوەی ڕێکخراو دەستکاری بکەیت."
      backHref="/admin?tab=categories"
    >
      <AdminCategoryEditorForm
        form={form}
        setForm={setForm}
        onSave={() => saveMutation.mutate()}
        onReset={() => setForm(isCreate || !category ? createEmptyCategoryForm() : createCategoryFormFromCategory(category))}
        onDelete={!isCreate ? () => {
          if (window.confirm("دڵنیایت دەتەوێت ئەم پۆلە بسڕیتەوە؟")) {
            deleteMutation.mutate();
          }
        } : undefined}
        isCreate={isCreate}
        isSaving={saveMutation.isPending}
        isDeleting={deleteMutation.isPending}
      />
    </AdminStandaloneFrame>
  );
};

export const AdminMenuItemEditorPage = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const isCreate = !itemId || itemId === "new";
  const menuItemsQuery = useQuery({ queryKey: ["admin", "menu-items"], queryFn: api.admin.getMenuItems });
  const categoriesQuery = useQuery({ queryKey: ["admin", "categories"], queryFn: api.admin.getAdminCategories });
  const menuItem = useMemo(() => (menuItemsQuery.data ?? []).find((entry) => entry.id === itemId) ?? null, [menuItemsQuery.data, itemId]);
  const [form, setForm] = useState<MenuFormState>(() => createEmptyMenuForm());

  useEffect(() => {
    if (isCreate) {
      setForm(createEmptyMenuForm());
      return;
    }
    if (menuItem) {
      setForm(createMenuFormFromMenuItem(menuItem));
    }
  }, [isCreate, menuItem]);

  const invalidateAdminMenu = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "menu-items"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "categories"] }),
      queryClient.invalidateQueries({ queryKey: ["menu"] }),
      queryClient.invalidateQueries({ queryKey: ["orders"] })
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = createMenuPayload(form);
      if (!payload.slug) throw new Error("Slug بنووسە");
      if (!payload.categoryId) throw new Error("پۆل هەڵبژێرە");
      if (!payload.translations.some((entry) => entry.locale === "ku")) throw new Error("ناو و وەسفی کوردی بنووسە");
      return isCreate ? api.admin.createMenuItem(payload) : api.admin.updateMenuItem(itemId!, payload);
    },
    onSuccess: async () => {
      toast.success("گۆڕانکارییەکە پاشەکەوت کرا");
      await invalidateAdminMenu();
      navigate("/admin?tab=menu", { replace: true });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Menu item save failed");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.admin.deleteMenuItem(itemId!),
    onSuccess: async () => {
      toast.success("خواردنەکە سڕایەوە");
      await invalidateAdminMenu();
      navigate("/admin?tab=menu", { replace: true });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Menu item delete failed");
    }
  });

  if (!isCreate && menuItemsQuery.isSuccess && !menuItem) {
    return (
      <AdminStandaloneFrame title="خواردنەکە نەدۆزرایەوە" subtitle="ئەم خواردنە بوونی نییە یان سڕاوەتەوە." backHref="/admin?tab=menu">
        <Section title="گەڕانەوە" icon={Info}>
          <button type="button" onClick={() => navigate("/admin?tab=menu", { replace: true })} className="rounded-2xl bg-amber-300 px-4 py-3 text-[0.95rem] font-bold text-slate-950">
            بگەڕێوە بۆ خواردنەکان
          </button>
        </Section>
      </AdminStandaloneFrame>
    );
  }

  return (
    <AdminStandaloneFrame
      title={isCreate ? "پەیجی زیادکردنی خواردن" : "پەیجی دەستکاریکردنی خواردن"}
      subtitle="ناوی خواردن، وێنە، نرخ، پۆل، و بەردەستبوون لێرە بە شێوەی ڕێکخراو دەستکاری دەکرێت."
      backHref="/admin?tab=menu"
    >
      <AdminMenuEditorForm
        form={form}
        setForm={setForm}
        categories={categoriesQuery.data ?? []}
        locale={locale}
        onSave={() => saveMutation.mutate()}
        onReset={() => setForm(isCreate || !menuItem ? createEmptyMenuForm() : createMenuFormFromMenuItem(menuItem))}
        onDelete={!isCreate ? () => {
          if (window.confirm("دڵنیایت دەتەوێت ئەم خواردنە بسڕیتەوە؟")) {
            deleteMutation.mutate();
          }
        } : undefined}
        isCreate={isCreate}
        isSaving={saveMutation.isPending}
        isDeleting={deleteMutation.isPending}
      />
    </AdminStandaloneFrame>
  );
};
