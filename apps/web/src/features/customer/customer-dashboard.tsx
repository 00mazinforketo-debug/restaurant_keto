import { useDeferredValue, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CategoryDto, type Locale, type MenuItemDto, type OrderDto, isPhoneNumber } from "@ros/shared";
import { Bell, ChevronLeft, ClipboardList, Info, LogOut, Minus, Plus, ReceiptText, Search, Settings2, ShoppingBag, Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { LanguageSwitcher } from "../../components/language-switcher";
import { SkeletonCard } from "../../components/skeleton-card";
import { StatusBadge } from "../../components/status-badge";
import { ThemeToggle } from "../../components/theme-toggle";
import { api, isPersistentStorageOutageError } from "../../lib/api";
import { useAppExitGuard } from "../../hooks/use-app-exit-guard";
import { formatIraqAddress, iraqLocationOptions, isKnownIraqLocation, parseIraqAddress } from "../../lib/iraq-locations";
import { getSocket, isRealtimeEnabled } from "../../lib/socket";
import { cn, formatCurrency, formatDateTime, formatNumber, getCategoryName, getMenuText, toEnglishDigits } from "../../lib/utils";
import { useAuth } from "../../providers/auth-provider";
import { useCart } from "../../providers/cart-provider";

const customerNotificationSeenStorageKey = "ros-customer-notifications-seen-at";
const customerAvailabilitySettingsStorageKey = "ros-customer-availability-settings";

type CustomerNotificationItem = {
  id: string;
  orderId: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  status: OrderDto["status"];
  timestamp: string;
  title: string;
  message: string;
  isAdminResponse: boolean;
  canCancel: boolean;
  canDelete: boolean;
};

type MobileCustomerView = "browse" | "cart" | "checkout" | "notifications" | "orders";
const customerRootViews = ["browse", "cart", "checkout", "notifications", "orders"] as const satisfies readonly MobileCustomerView[];
const isCustomerRootView = (value: string | null): value is MobileCustomerView =>
  Boolean(value && customerRootViews.includes(value as MobileCustomerView));

type CustomerOrderGroup = {
  id: string;
  title: string;
  description: string;
  orders: OrderDto[];
};

type CustomerCategoryOption = {
  id: string;
  slug: string;
  names: { ku: string; ar?: string; fa?: string; en?: string; tr?: string };
  sortOrder: number;
  icon?: string | null;
};

type CustomerAvailabilitySettings = {
  categories: Record<string, boolean>;
  menuItems: Record<string, boolean>;
};

const orderDayWindowMs = 24 * 60 * 60 * 1000;
const numericOrderDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn"
});

const formatCustomerCurrency = (value: number) => formatCurrency(value, "IQD", "en-US");
const formatCustomerOrderDateTime = (value: string) => toEnglishDigits(numericOrderDateTimeFormatter.format(new Date(value)));
const canCustomerCancelOrder = (status: OrderDto["status"]) => status === "PENDING";
const canCustomerDeleteOrder = (status: OrderDto["status"]) => status === "PENDING" || status === "CANCELLED";
const normalizePhoneInput = (value: string) => toEnglishDigits(value).replace(/\D/g, "");
const createDefaultAvailabilitySettings = (): CustomerAvailabilitySettings => ({ categories: {}, menuItems: {} });

const readCustomerAvailabilitySettings = (userId?: string | null): CustomerAvailabilitySettings => {
  if (typeof window === "undefined" || !userId) {
    return createDefaultAvailabilitySettings();
  }

  try {
    const raw = window.localStorage.getItem(`${customerAvailabilitySettingsStorageKey}:${userId}`);
    if (!raw) {
      return createDefaultAvailabilitySettings();
    }

    const parsed = JSON.parse(raw) as Partial<CustomerAvailabilitySettings>;
    return {
      categories: parsed.categories ?? {},
      menuItems: parsed.menuItems ?? {}
    };
  } catch {
    return createDefaultAvailabilitySettings();
  }
};

const writeCustomerAvailabilitySettings = (userId: string | undefined | null, settings: CustomerAvailabilitySettings) => {
  if (typeof window === "undefined" || !userId) {
    return;
  }

  window.localStorage.setItem(`${customerAvailabilitySettingsStorageKey}:${userId}`, JSON.stringify(settings));
};

const updateAvailabilityMap = (
  current: Record<string, boolean>,
  id: string,
  enabled: boolean,
  defaultEnabled: boolean
) => {
  const next = { ...current };

  if (enabled === defaultEnabled) {
    delete next[id];
  } else {
    next[id] = enabled;
  }

  return next;
};

const resolveCategoryAvailability = (settings: CustomerAvailabilitySettings, categoryId: string) =>
  settings.categories[categoryId] ?? true;

const resolveMenuItemAvailability = (settings: CustomerAvailabilitySettings, item: MenuItemDto) =>
  settings.menuItems[item.id] ?? item.isAvailable;

const formatOrderGroupTitle = (dayIndex: number, value: string) => {
  if (dayIndex === 0) return "ئەمرۆ";
  if (dayIndex === 1) return "دوێنێ";
  return toEnglishDigits(new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric", numberingSystem: "latn" }).format(new Date(value)));
};

const formatOrderGroupDescription = (dayIndex: number) => {
  if (dayIndex === 0) return "هەموو ئۆردەرەکانی 24 کاتژمێری دوایی";
  if (dayIndex === 1) return "ئۆردەرەکانی 24 تا 48 کاتژمێر لەمەوبەر";
  return `ئۆردەرەکانی ${dayIndex * 24} تا ${(dayIndex + 1) * 24} کاتژمێر لەمەوبەر`;
};

const buildCustomerOrderGroups = (orders: OrderDto[], nowTimestamp: number): CustomerOrderGroup[] => {
  const groupedOrders = new Map<number, OrderDto[]>();

  for (const order of [...orders].sort((left, right) => new Date(right.placedAt).getTime() - new Date(left.placedAt).getTime())) {
    const elapsedTime = Math.max(0, nowTimestamp - new Date(order.placedAt).getTime());
    const dayIndex = Math.floor(elapsedTime / orderDayWindowMs);
    const currentGroup = groupedOrders.get(dayIndex);

    if (currentGroup) {
      currentGroup.push(order);
    } else {
      groupedOrders.set(dayIndex, [order]);
    }
  }

  return [...groupedOrders.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([dayIndex, dayOrders]) => ({
      id: `orders-day-${dayIndex}`,
      title: formatOrderGroupTitle(dayIndex, dayOrders[0]?.placedAt ?? new Date(nowTimestamp).toISOString()),
      description: formatOrderGroupDescription(dayIndex),
      orders: dayOrders
    }));
};

const readLastSeenNotificationAt = () => {
  if (typeof window === "undefined") return 0;
  const raw = Number(window.localStorage.getItem(customerNotificationSeenStorageKey));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
};

const useCustomerAvailabilitySettings = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<CustomerAvailabilitySettings>(() => readCustomerAvailabilitySettings(user?.id));

  useEffect(() => {
    setSettings(readCustomerAvailabilitySettings(user?.id));
  }, [user?.id]);

  const updateSettings = (updater: (current: CustomerAvailabilitySettings) => CustomerAvailabilitySettings) => {
    setSettings((current) => {
      const next = updater(current);
      writeCustomerAvailabilitySettings(user?.id, next);
      return next;
    });
  };

  return {
    settings,
    isCategoryAvailable: (categoryId: string) => resolveCategoryAvailability(settings, categoryId),
    isMenuItemAvailable: (item: MenuItemDto) => resolveMenuItemAvailability(settings, item),
    setCategoryAvailability: (categoryId: string, enabled: boolean) =>
      updateSettings((current) => ({
        ...current,
        categories: updateAvailabilityMap(current.categories, categoryId, enabled, true)
      })),
    setMenuItemAvailability: (item: MenuItemDto, enabled: boolean) =>
      updateSettings((current) => ({
        ...current,
        menuItems: updateAvailabilityMap(current.menuItems, item.id, enabled, item.isAvailable)
      }))
  };
};

const getLatestStatusEvent = (order: OrderDto) =>
  order.statusHistory[order.statusHistory.length - 1] ?? null;

const NotificationCustomerMeta = ({ customerName, customerPhone }: { customerName: string; customerPhone: string }) => (
  <div className="mt-3 grid gap-2 sm:grid-cols-2">
    <div className="rounded-2xl bg-white/5 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">ناوی کڕیار</p>
      <p className="mt-1 text-sm font-semibold text-white break-words">{customerName || "-"}</p>
    </div>
    <div className="rounded-2xl bg-white/5 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">ژمارەی مۆبایل</p>
      <p className="mt-1 text-right text-sm font-semibold text-white break-all" dir="ltr">{customerPhone || "-"}</p>
    </div>
  </div>
);

const DetailField = ({ label, value, dir }: { label: string; value: string; dir?: "ltr" | "rtl" }) => (
  <div className="rounded-2xl bg-white/5 px-3 py-2.5">
    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
    <p className={cn("mt-1.5 text-sm font-semibold text-white break-words", dir === "ltr" ? "text-right" : "")} dir={dir}>
      {value || "-"}
    </p>
  </div>
);

const CustomerPageHeader = ({
  eyebrow,
  title,
  description,
  backLabel,
  onBack,
  action
}: {
  eyebrow: string;
  title: string;
  description?: string;
  backLabel: string;
  onBack: () => void;
  action?: ReactNode;
}) => (
  <section className="app-panel sm:rounded-[30px]">
    <div className="flex flex-col gap-3 sm:gap-4 min-[1500px]:flex-row min-[1500px]:items-end min-[1500px]:justify-between">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">{eyebrow}</p>
        <h1 className="mt-2 font-display text-[1.55rem] font-extrabold text-white sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">{description}</p> : null}
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
        {action}
        <button
          type="button"
          onClick={onBack}
          className="compact-pill-button w-full justify-center sm:w-auto"
        >
          <ChevronLeft className="h-4 w-4" />
          {backLabel}
        </button>
      </div>
    </div>
  </section>
);

const CustomerOverviewStat = ({
  label,
  value,
  description
}: {
  label: string;
  value: string;
  description: string;
}) => (
  <article className="rounded-[20px] border border-white/10 bg-slate-950/35 p-3.5 sm:rounded-[24px] sm:p-4">
    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{label}</p>
    <p className="mt-3 font-display text-2xl font-extrabold text-white sm:text-3xl">{value}</p>
    <p className="mt-2 text-[0.9rem] leading-6 text-slate-300">{description}</p>
  </article>
);

const HostedMaintenancePanel = ({ title, message }: { title: string; message: string }) => (
  <div className="app-shell">
    <div className="app-stage">
      <section className="app-panel text-center">
        <p className="font-display text-2xl font-bold text-white">{title}</p>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-300">{message}</p>
      </section>
    </div>
  </div>
);

const AvailabilitySwitch = ({
  enabled,
  onToggle,
  className
}: {
  enabled: boolean;
  onToggle: (nextValue: boolean) => void;
  className?: string;
}) => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      onToggle(!enabled);
    }}
    className={cn(
      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
      enabled ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-rose-300/30 bg-rose-400/10 text-rose-100",
      className
    )}
    aria-pressed={enabled}
  >
    <span
      className={cn(
        "relative h-5 w-9 rounded-full transition",
        enabled ? "bg-emerald-300/30" : "bg-rose-300/20"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition",
          enabled ? "right-0.5" : "right-[1.125rem]"
        )}
      />
    </span>
    <span>{enabled ? "ON | بەردەستە" : "OFF | بەردەست نیە"}</span>
  </button>
);

const CategoryFilterPanel = ({
  categories,
  activeCategory,
  onChange,
  locale,
  allLabel
}: {
  categories: CustomerCategoryOption[];
  activeCategory: string;
  onChange: (categoryId: string) => void;
  locale: Locale;
  allLabel: string;
}) => {
  const selectedCategory = categories.find((entry) => entry.id === activeCategory);
  const selectedCategoryLabel = selectedCategory ? getCategoryName(selectedCategory, locale) : allLabel;
  const categoryButtons = [
    {
      id: "",
      label: allLabel,
      subtitle: "بینینی هەموو خواردنەکان"
    },
    ...categories.map((category) => ({
      id: category.id,
      label: getCategoryName(category, locale),
      subtitle: category.slug
    }))
  ];

  return (
    <div className="app-panel">
      <div className="flex flex-col gap-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-white sm:text-lg">فلتەری پۆلەکان</h2>
          <p className="mt-1 text-[0.88rem] text-slate-300">
            هەڵبژاردەی ئێستا: <span className="font-semibold text-amber-100">{selectedCategoryLabel}</span>
          </p>
        </div>
        <span className="inline-flex self-start rounded-full border border-white/10 bg-slate-950/35 px-3 py-1 text-xs font-semibold text-slate-300 min-[520px]:self-auto">
          {formatNumber(categories.length)} پۆل
        </span>
      </div>

      <div className="mt-4 sm:hidden">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {categoryButtons.map((entry) => {
            const isActive = activeCategory === entry.id;

            return (
              <button
                key={"mobile-category-" + (entry.id || "all")}
                type="button"
                onClick={() => onChange(entry.id)}
                className={cn(
                  "min-w-[10.5rem] shrink-0 rounded-[20px] border px-3.5 py-3 text-right transition",
                  isActive
                    ? "border-amber-300/40 bg-amber-300/12 text-white shadow-glow"
                    : "border-white/10 bg-slate-950/35 text-slate-200 hover:bg-white/10"
                )}
              >
                <p className="line-clamp-1 font-display text-[0.95rem] font-bold">{entry.label}</p>
                <p className="mt-1 line-clamp-1 text-[11px] text-slate-400">{entry.subtitle}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 hidden gap-2 sm:grid sm:grid-cols-2 min-[1500px]:grid-cols-4">
        {categoryButtons.map((entry) => {
          const isActive = activeCategory === entry.id;

          return (
            <button
              key={"desktop-category-" + (entry.id || "all")}
              type="button"
              onClick={() => onChange(entry.id)}
              className={cn(
                "min-h-[4.75rem] rounded-[20px] border px-3 py-3 text-right transition",
                isActive
                  ? "border-amber-300/40 bg-amber-300/12 text-white shadow-glow"
                  : "border-white/10 bg-slate-950/35 text-slate-200 hover:bg-white/10"
              )}
            >
              <p className="line-clamp-2 font-display text-[0.95rem] font-bold">{entry.label}</p>
              <p className="mt-1 line-clamp-1 text-[11px] text-slate-400">{entry.subtitle}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const useCustomerSettingsCatalog = (locale: Locale) => {
  const catalogQuery = useQuery({
    queryKey: ["menu", "customer-settings-catalog", locale],
    queryFn: () => api.getMenu({ locale })
  });

  const categories = catalogQuery.data?.categories ?? [];
  const menuItems = catalogQuery.data?.items ?? [];
  const menuItemsById = useMemo(() => new Map(menuItems.map((item) => [item.id, item])), [menuItems]);
  const menuItemsByCategory = useMemo(() => {
    const groups = new Map<string, MenuItemDto[]>();

    for (const item of menuItems) {
      const currentItems = groups.get(item.categoryId);
      if (currentItems) {
        currentItems.push(item);
      } else {
        groups.set(item.categoryId, [item]);
      }
    }

    return groups;
  }, [menuItems]);

  return {
    catalogQuery,
    categories,
    menuItems,
    menuItemsById,
    menuItemsByCategory
  };
};

type OrderCardProps = {
  order: OrderDto;
  canCancel?: boolean;
  onCancel?: (order: OrderDto) => void;
  onView?: (order: OrderDto) => void;
  isActionPending?: boolean;
};

const OrderCard = ({ order, canCancel = false, onCancel, onView, isActionPending = false }: OrderCardProps) => {
  return (
    <article className="min-w-0 rounded-[20px] border border-white/10 bg-slate-950/45 p-3.5 sm:rounded-[26px] sm:p-4">
      <div className="sm:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">کۆدی ئۆڵدەر</p>
            <p className="mt-1 font-display text-base font-bold text-white break-all">{toEnglishDigits(order.orderCode)}</p>
            <p className="mt-1.5 text-xs text-slate-400">{formatCustomerOrderDateTime(order.placedAt)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <StatusBadge status={order.status} />
            <div className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
              {formatCustomerCurrency(order.totalPrice)}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <DetailField label="ناوی کڕیار" value={order.customerNameKu} />
          <DetailField label="ژمارەی موبایل" value={toEnglishDigits(order.customerPhone)} dir="ltr" />
        </div>
      </div>

      <div className="hidden sm:block">
        <div className="mb-4 flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
          <div className="min-w-0">
            <p className="font-display text-base font-bold text-white break-all sm:text-lg">{toEnglishDigits(order.orderCode)}</p>
            <p className="mt-2 text-xs text-slate-400">{formatCustomerOrderDateTime(order.placedAt)}</p>
          </div>
          <div className="self-start space-y-2">
            <StatusBadge status={order.status} />
            <div className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
              {formatCustomerCurrency(order.totalPrice)}
            </div>
          </div>
        </div>
        <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
          <DetailField label="کۆدی ئۆڵدەر" value={toEnglishDigits(order.orderCode)} />
          <DetailField label="ناوی کڕیار" value={order.customerNameKu} />
          <DetailField label="ژمارەی موبایل" value={toEnglishDigits(order.customerPhone)} dir="ltr" />
        </div>
      </div>

      <div className={cn("mt-4 grid gap-2", canCancel ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
        <button
          type="button"
          onClick={() => onView?.(order)}
          className="rounded-2xl border border-sky-300/30 bg-sky-400/10 px-4 py-2.5 text-[0.9rem] font-semibold text-sky-100 transition hover:bg-sky-400/20"
        >
          بینینی ئۆڵدەر
        </button>
        {canCancel ? (
          <button
            type="button"
            onClick={() => onCancel?.(order)}
            disabled={isActionPending}
            className="rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-2.5 text-[0.9rem] font-semibold text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isActionPending ? "چاوەڕوانبە..." : "ڕەتکردنەوەی داواکاری"}
          </button>
        ) : null}
      </div>
    </article>
  );
};

type CustomerOrdersPageProps = {
  groups: CustomerOrderGroup[];
  activeOrdersCount: number;
  isLoading: boolean;
  onBack?: () => void;
  onViewOrder?: (order: OrderDto) => void;
  onCancelOrder?: (order: OrderDto) => void;
  isActionPending?: boolean;
};

const CustomerOrderDetails = ({ order, menuItemsById, onClose }: { order: OrderDto; menuItemsById: Map<string, MenuItemDto>; onClose: () => void }) => {
  const latestStatusEvent = getLatestStatusEvent(order);
  const parsedAddress = parseIraqAddress(order.customerAddressKu);
  const hasDistrict = Boolean(parsedAddress.district);

  return (
    <section className="app-panel sm:rounded-[30px]">
      <div className="flex flex-col gap-3 min-[520px]:flex-row min-[520px]:items-start min-[520px]:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">زانیاری داواکاری</p>
          <h3 className="mt-2 font-display text-xl font-bold text-white break-all sm:text-2xl">{toEnglishDigits(order.orderCode)}</h3>
          <p className="mt-2 text-sm text-slate-300">{formatCustomerOrderDateTime(order.placedAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={order.status} />
          <button type="button" onClick={onClose} className="compact-pill-button">
            <ChevronLeft className="h-4 w-4" />
            گەڕانەوە بۆ هەموو ئۆردەرەکانم
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 min-[1500px]:grid-cols-2">
        <div className="rounded-[20px] border border-white/10 bg-slate-950/35 p-4 sm:rounded-[24px]">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">زانیاری کڕیار</p>
          <div className="mt-3 grid gap-2">
            <DetailField label="ناوی کڕیار" value={order.customerNameKu} />
            <DetailField label="ژمارەی موبایل" value={toEnglishDigits(order.customerPhone)} dir="ltr" />
            <DetailField label={hasDistrict ? "پارێزگا" : "پارێزگا / شار / ناحیە"} value={parsedAddress.governorate} />
            {hasDistrict ? <DetailField label="شار / ناحیە" value={parsedAddress.district} /> : null}
            <DetailField label="وردەکاری ناونیشان" value={parsedAddress.details} />
            {order.notesKu ? (
              <DetailField label="تێبینی" value={order.notesKu} />
            ) : null}
          </div>
        </div>

        <div className="rounded-[20px] border border-white/10 bg-slate-950/35 p-4 sm:rounded-[24px]">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">پوختەی داواکاری</p>
          <div className="mt-3 grid gap-2">
            <div className="rounded-2xl bg-white/5 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">کۆی گشتی</p>
              <p className="mt-1.5 text-lg font-bold text-amber-200">{formatCustomerCurrency(order.totalPrice)}</p>
            </div>
            <DetailField label="ژمارەی خواردنەکان" value={formatNumber(order.items.length)} />
            <DetailField label="دوایین نوێکردنەوە" value={formatCustomerOrderDateTime(latestStatusEvent?.changedAt ?? order.updatedAt)} />
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-[20px] border border-white/10 bg-slate-950/35 p-4 sm:rounded-[24px]">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">خواردنە هەڵبژێردراوەکان</p>
        <div className="mt-4 space-y-3">
          {order.items.map((item) => {
            const imageUrl = menuItemsById.get(item.menuItemId)?.imageUrl ?? null;

            return (
              <div key={`${order.id}-${item.menuItemId}`} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:p-4">
                <div className="h-24 overflow-hidden rounded-[18px]">
                  {imageUrl ? <img src={imageUrl} alt={item.nameKu} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-gradient-to-br from-slate-700 to-slate-900" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-white break-words">{item.nameKu}</p>
                      <p className="mt-1 text-xs text-slate-400 break-words">{item.categoryNameKu}</p>
                    </div>
                    <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
                      {formatCustomerCurrency(item.totalPrice)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-2xl bg-slate-950/45 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">ژمارە</p>
                      <p className="mt-1 text-sm font-semibold text-white">{formatNumber(item.quantity)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-950/45 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">نرخی دانەیەک</p>
                      <p className="mt-1 text-sm font-semibold text-white">{formatCustomerCurrency(item.unitPrice)}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

const CustomerOrdersPage = ({ groups, activeOrdersCount, isLoading, onBack, onCancelOrder, onViewOrder, isActionPending = false }: CustomerOrdersPageProps) => {
  const totalOrdersCount = groups.reduce((sum, group) => sum + group.orders.length, 0);

  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="app-panel sm:rounded-[30px]">
        <div className="flex flex-col gap-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-[18px] border border-sky-300/20 bg-sky-400/10 text-sky-200 sm:h-12 sm:w-12 sm:rounded-2xl">
              <ClipboardList className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-white sm:text-xl">هەموو ئۆردەرەکانم</h2>
              <p className="mt-1 text-[0.9rem] text-slate-300">هەموو داواکارییەکانت لێرە بە ڕێکخستنی 24 کاتژمێرەکان نیشان دەدرێن.</p>
            </div>
          </div>
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="compact-pill-button self-start min-[520px]:self-auto"
            >
              <ChevronLeft className="h-4 w-4" />
              گەڕانەوە بۆ سەرەکی
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 min-[460px]:grid-cols-2">
          <div className="rounded-[20px] border border-white/10 bg-slate-950/35 p-3.5 sm:rounded-[24px] sm:p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">All Orders</p>
            <p className="mt-3 font-display text-2xl font-extrabold text-white sm:text-3xl">{formatNumber(totalOrdersCount)}</p>
            <p className="mt-2 text-[0.9rem] text-slate-300">هەموو داواکارییە تۆمارکراوەکان لە هەژمارەکەت.</p>
          </div>
          <div className="rounded-[20px] border border-white/10 bg-slate-950/35 p-3.5 sm:rounded-[24px] sm:p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Active</p>
            <p className="mt-3 font-display text-2xl font-extrabold text-white sm:text-3xl">{formatNumber(activeOrdersCount)}</p>
            <p className="mt-2 text-[0.9rem] text-slate-300">داواکارییە چاڵاکەکان کە هێشتا تەواو نەبوون.</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-[20px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:rounded-[24px] sm:p-5">
              <div className="h-5 w-40 animate-pulse rounded-full bg-white/10" />
              <div className="mt-3 h-4 w-64 animate-pulse rounded-full bg-white/5" />
              <div className="mt-5 h-24 animate-pulse rounded-[20px] bg-slate-950/35 sm:rounded-[24px]" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-4">
        {!isLoading && groups.map((group) => (
          <div key={group.id} className="app-panel sm:rounded-[30px]">
            <div className="mb-4 flex flex-col gap-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold text-white sm:text-xl">{group.title}</h3>
                <p className="mt-1 text-[0.9rem] text-slate-300">{group.description}</p>
              </div>
              <span className="inline-flex self-start rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100 min-[520px]:self-auto">
                {formatNumber(group.orders.length)} داواکاری
              </span>
            </div>
            <div className="space-y-4">
              {group.orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  canCancel={canCustomerCancelOrder(order.status)}
                  onCancel={onCancelOrder}
                  onView={(currentOrder) => onViewOrder?.(currentOrder)}
                  isActionPending={isActionPending}
                />
              ))}
            </div>
          </div>
        ))}

        {!isLoading && !groups.length ? (
          <div className="rounded-[20px] border border-dashed border-white/10 bg-white/5 p-6 text-center text-[0.92rem] text-slate-300 sm:rounded-[24px] sm:p-8">
            هێشتا هیچ ئۆردەرێکت نییە.
          </div>
        ) : null}
      </div>
    </section>
  );
};

export const CustomerDashboard = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const customerAvailability = useCustomerAvailabilitySettings();
  const { lines, total, add, setQuantity, remove, clear } = useCart();
  const [searchParams] = useSearchParams();
  const initialTable = searchParams.get("table") ?? "";
  const initialRequestedView = searchParams.get("view");
  const initialRootView: MobileCustomerView = isCustomerRootView(initialRequestedView) ? initialRequestedView : "browse";
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [activeCategory, setActiveCategory] = useState("");
  const [customerNameKu, setCustomerNameKu] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerGovernorate, setCustomerGovernorate] = useState("");
  const [customerAddressKu, setCustomerAddressKu] = useState("");
  const [notesKu, setNotesKu] = useState("");
  const [tableLabel] = useState(initialTable);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [checkoutStep, setCheckoutStep] = useState<"cart" | "details">("cart");
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [lastSeenNotificationAt, setLastSeenNotificationAt] = useState(() => readLastSeenNotificationAt());
  const [mobileView, setMobileView] = useState<MobileCustomerView>(initialRootView);
  const [desktopView, setDesktopView] = useState<"dashboard" | "orders">(initialRootView === "orders" ? "orders" : "dashboard");
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const requestedRootView = searchParams.get("view");

  useAppExitGuard(true);

  const updateCustomerRootRoute = (nextView: MobileCustomerView | "dashboard", replace = false) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextView === "browse" || nextView === "dashboard") {
      nextParams.delete("view");
    } else {
      nextParams.set("view", nextView);
    }
    const nextSearch = nextParams.toString();
    navigate(nextSearch ? `/app?${nextSearch}` : "/app", { replace });
  };

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(customerNotificationSeenStorageKey, String(lastSeenNotificationAt));
  }, [lastSeenNotificationAt]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTimestamp(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const nextMobileView = isCustomerRootView(requestedRootView) ? requestedRootView : "browse";
    const nextDesktopView = nextMobileView === "orders" ? "orders" : "dashboard";

    if (mobileView !== nextMobileView) {
      setMobileView(nextMobileView);
    }
    if (desktopView !== nextDesktopView) {
      setDesktopView(nextDesktopView);
    }
    if (nextMobileView === "notifications") {
      setLastSeenNotificationAt((current) => Math.max(current, Date.now()));
    }
  }, [requestedRootView, mobileView, desktopView]);

  useEffect(() => {
    if (!lines.length) {
      setCheckoutStep("cart");
      if (mobileView === "cart" || mobileView === "checkout") {
        setMobileView("browse");
        updateCustomerRootRoute("browse", true);
      }
    }
  }, [lines.length, mobileView]);

  const pollingInterval = isRealtimeEnabled() ? false : 5000;

  const menuQuery = useQuery({
    queryKey: ["menu", locale, deferredSearch, activeCategory],
    queryFn: () => api.getMenu({ locale, q: deferredSearch, categoryId: activeCategory || undefined }),
    refetchInterval: pollingInterval
  });
  const settingsCatalogQuery = useCustomerSettingsCatalog(locale);
  const orderMenuItemsQuery = useQuery({
    queryKey: ["menu", "all-order-items", locale],
    queryFn: () => api.getMenu({ locale }),
    refetchInterval: pollingInterval
  });
  const currentOrdersQuery = useQuery({
    queryKey: ["orders", "current"],
    queryFn: api.getCurrentOrders,
    refetchInterval: pollingInterval
  });
  const historyQuery = useQuery({
    queryKey: ["orders", "history"],
    queryFn: api.getOrderHistory,
    refetchInterval: pollingInterval
  });

  const hasPersistentStorageOutage =
    isPersistentStorageOutageError(menuQuery.error) ||
    isPersistentStorageOutageError(orderMenuItemsQuery.error) ||
    isPersistentStorageOutageError(currentOrdersQuery.error) ||
    isPersistentStorageOutageError(historyQuery.error) ||
    isPersistentStorageOutageError(settingsCatalogQuery.catalogQuery.error);

  useEffect(() => {
    if (!isRealtimeEnabled()) {
      return;
    }

    const socket = getSocket();
    for (const order of currentOrdersQuery.data ?? []) {
      socket.emit("order:subscribe", order.id);
    }
  }, [currentOrdersQuery.data]);

  const orderMutation = useMutation({
    mutationFn: api.createOrder,
    onSuccess: async () => {
      clear();
      setCustomerNameKu("");
      setCustomerPhone("");
      setCustomerGovernorate("");
      setCustomerAddressKu("");
      setNotesKu("");
      setCheckoutStep("cart");
      setDesktopView("dashboard");
      toast.success(t("notifications.orderCreated"));
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["orders"] }), queryClient.invalidateQueries({ queryKey: ["admin"] })]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Order failed");
    }
  });

  const cancelOrderMutation = useMutation({
    mutationFn: (orderId: string) => api.cancelOrder(orderId),
    onSuccess: async () => {
      toast.success("داواکاریەکەت کانسڵ کرا");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["admin"] })
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Order cancellation failed");
    }
  });

  const deleteOrderMutation = useMutation({
    mutationFn: (orderId: string) => api.deleteOrder(orderId),
    onSuccess: async () => {
      toast.success("داواکاریەکەت سڕایەوە");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["admin"] })
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Order deletion failed");
    }
  });

  const allCatalogCategories = settingsCatalogQuery.categories.length ? settingsCatalogQuery.categories : menuQuery.data?.categories ?? [];
  const allCatalogMenuItems = settingsCatalogQuery.menuItems.length ? settingsCatalogQuery.menuItems : orderMenuItemsQuery.data?.items ?? [];
  const groupedCategories = useMemo(
    () =>
      allCatalogCategories.filter(
        (category) =>
          customerAvailability.isCategoryAvailable(category.id) &&
          allCatalogMenuItems.some(
            (item) => item.categoryId === category.id && customerAvailability.isMenuItemAvailable(item)
          )
      ),
    [allCatalogCategories, allCatalogMenuItems, customerAvailability]
  );
  const visibleCategoryIds = useMemo(() => new Set(groupedCategories.map((category) => category.id)), [groupedCategories]);
  const menuItems = useMemo(
    () =>
      (menuQuery.data?.items ?? []).filter(
        (item) => visibleCategoryIds.has(item.categoryId) && customerAvailability.isMenuItemAvailable(item)
      ),
    [customerAvailability, menuQuery.data?.items, visibleCategoryIds]
  );
  const menuItemsById = useMemo(() => new Map((orderMenuItemsQuery.data?.items ?? []).map((item) => [item.id, item])), [orderMenuItemsQuery.data?.items]);
  const allOrders = historyQuery.data ?? [];
  const activeOrdersCount = currentOrdersQuery.data?.length ?? 0;
  const cartItemsCount = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);
  const isSubmitDisabled = !lines.length || orderMutation.isPending || !isOnline;
  const groupedOrderHistory = useMemo(() => buildCustomerOrderGroups(allOrders, nowTimestamp), [allOrders, nowTimestamp]);

  if (hasPersistentStorageOutage) {
    return (
      <HostedMaintenancePanel
        title="بەشی داواکاری کاتێکی کورت وەستاوە"
        message="هەڵگرتنی زانیارییەکان لە production بەردەست نییە، بۆیە ناتوانرێت خواردن باربکرێت یان داواکاری بنێردرێت. تکایە دوای نوێکردنەوەی site دووبارە هەوڵ بدە."
      />
    );
  }

  useEffect(() => {
    if (activeCategory && !visibleCategoryIds.has(activeCategory)) {
      setActiveCategory("");
    }
  }, [activeCategory, visibleCategoryIds]);

  const notificationItems = useMemo<CustomerNotificationItem[]>(() => {
    return [...allOrders]
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .map((order) => {
        const latestStatusEvent = getLatestStatusEvent(order);
        const updatedAt = latestStatusEvent?.changedAt ?? order.updatedAt ?? order.placedAt;
        const changedBy = latestStatusEvent?.changedBy;

        if (order.status === "PREPARING") {
          return {
            id: `${order.id}-${updatedAt}`,
            orderId: order.id,
            orderCode: toEnglishDigits(order.orderCode),
            customerName: order.customerNameKu,
            customerPhone: toEnglishDigits(order.customerPhone),
            status: order.status,
            timestamp: updatedAt,
            title: `داواکاری ${toEnglishDigits(order.orderCode)}`,
            message: changedBy ? `قبوڵ کرا و ئێستا لەلایەن ${changedBy} ئامادەدەکرێت.` : "قبوڵ کرا و ئێستا ئامادەدەکرێت.",
            isAdminResponse: true,
            canCancel: false,
            canDelete: false
          };
        }

        if (order.status === "READY") {
          return {
            id: `${order.id}-${updatedAt}`,
            orderId: order.id,
            orderCode: toEnglishDigits(order.orderCode),
            customerName: order.customerNameKu,
            customerPhone: toEnglishDigits(order.customerPhone),
            status: order.status,
            timestamp: updatedAt,
            title: `داواکاری ${toEnglishDigits(order.orderCode)}`,
            message: "داواکاریەکەت ئامادەیە.",
            isAdminResponse: true,
            canCancel: false,
            canDelete: false
          };
        }

        if (order.status === "DELIVERED") {
          return {
            id: `${order.id}-${updatedAt}`,
            orderId: order.id,
            orderCode: toEnglishDigits(order.orderCode),
            customerName: order.customerNameKu,
            customerPhone: toEnglishDigits(order.customerPhone),
            status: order.status,
            timestamp: updatedAt,
            title: `داواکاری ${toEnglishDigits(order.orderCode)}`,
            message: "داواکاریەکەت گەیشتووە.",
            isAdminResponse: true,
            canCancel: false,
            canDelete: false
          };
        }

        if (order.status === "CANCELLED") {
          return {
            id: `${order.id}-${updatedAt}`,
            orderId: order.id,
            orderCode: toEnglishDigits(order.orderCode),
            customerName: order.customerNameKu,
            customerPhone: toEnglishDigits(order.customerPhone),
            status: order.status,
            timestamp: updatedAt,
            title: `داواکاری ${toEnglishDigits(order.orderCode)}`,
            message: "داواکاریەکەت هەڵوەشێندرایەوە.",
            isAdminResponse: true,
            canCancel: false,
            canDelete: canCustomerDeleteOrder(order.status)
          };
        }

        return {
          id: `${order.id}-${updatedAt}`,
          orderId: order.id,
          orderCode: toEnglishDigits(order.orderCode),
          customerName: order.customerNameKu,
          customerPhone: toEnglishDigits(order.customerPhone),
          status: order.status,
          timestamp: updatedAt,
          title: `داواکاری ${toEnglishDigits(order.orderCode)}`,
          message: "داواکاریەکەت لە چاوەڕوانیدایە.",
          isAdminResponse: false,
          canCancel: canCustomerCancelOrder(order.status),
          canDelete: canCustomerDeleteOrder(order.status)
        };
      });
  }, [allOrders]);

  const unreadNotificationsCount = notificationItems.filter((item) => item.isAdminResponse && new Date(item.timestamp).getTime() > lastSeenNotificationAt).length;

  const placeOrder = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = customerNameKu.trim();
    const normalizedPhone = normalizePhoneInput(customerPhone.trim());
    const normalizedLocation = customerGovernorate.trim();
    const trimmedAddressDetails = customerAddressKu.trim();
    const trimmedNotes = notesKu.trim();

    if (trimmedName.length < 2) {
      toast.error("ناوی کڕیار بنووسە");
      return;
    }
    if (!isPhoneNumber(normalizedPhone)) {
      toast.error(t("customer.phoneHint", { defaultValue: "ژمارەی کڕیار بە شێوەی دروست بنووسە" }));
      return;
    }
    if (!normalizedLocation) {
      toast.error("شوێنی داواکاری هەڵبژێرە");
      return;
    }
    if (!isKnownIraqLocation(normalizedLocation)) {
      toast.error("لە لیستی شوێنەکان هەڵبژێرە");
      return;
    }
    if (trimmedNotes.length > 280) {
      toast.error("تێبینی زۆر درێژە");
      return;
    }

    await orderMutation.mutateAsync({
      customerNameKu: trimmedName,
      customerPhone: normalizedPhone,
      customerAddressKu: formatIraqAddress({
        governorate: normalizedLocation,
        district: "",
        details: trimmedAddressDetails
      }),
      notesKu: trimmedNotes || undefined,
      tableLabel,
      locale,
      items: lines.map((line) => ({ menuItemId: line.menuItem.id, quantity: line.quantity }))
    });
  };

  const toggleNotificationCenter = () => {
    setNotificationCenterOpen((current) => {
      const next = !current;
      if (!current) {
        setDesktopView("dashboard");
        setLastSeenNotificationAt(Date.now());
      }
      return next;
    });
  };

  const proceedToCheckout = () => {
    if (!lines.length) {
      toast.error(t("customer.emptyCart"));
      return;
    }
    setCheckoutStep("details");
  };

  const cancelCustomerOrder = async (item: CustomerNotificationItem) => {
    const latestOrder = allOrders.find((order) => order.id === item.orderId);
    if (!latestOrder || !canCustomerCancelOrder(latestOrder.status) || !item.canCancel || cancelOrderMutation.isPending) return;
    const confirmed = window.confirm(`دڵنیایت دەتەوێت ${item.orderCode} کانسڵ بکەیت؟`);
    if (!confirmed) return;
    await cancelOrderMutation.mutateAsync(item.orderId);
  };

  const deleteCustomerOrder = async (item: Pick<CustomerNotificationItem, "orderId" | "orderCode" | "canDelete">) => {
    const latestOrder = allOrders.find((order) => order.id === item.orderId);
    if (!latestOrder || !canCustomerDeleteOrder(latestOrder.status) || !item.canDelete || deleteOrderMutation.isPending) return;
    const confirmed = window.confirm(`دڵنیایت دەتەوێت ${item.orderCode} بسڕیتەوە؟`);
    if (!confirmed) return;
    await deleteOrderMutation.mutateAsync(item.orderId);
  };

  const cancelOrderFromHistory = async (order: OrderDto) => {
    if (!canCustomerCancelOrder(order.status) || cancelOrderMutation.isPending) return;
    const confirmed = window.confirm(`دڵنیایت دەتەوێت ${toEnglishDigits(order.orderCode)} ڕەت بکەیتەوە؟`);
    if (!confirmed) return;
    await cancelOrderMutation.mutateAsync(order.id);
  };

  const openMobileCart = () => {
    if (!lines.length) {
      toast.error(t("customer.emptyCart"));
      return;
    }
    setMobileView("cart");
    updateCustomerRootRoute("cart");
  };

  const openMobileCheckout = () => {
    if (!lines.length) {
      toast.error(t("customer.emptyCart"));
      return;
    }
    setMobileView("checkout");
    updateCustomerRootRoute("checkout");
  };

  const openMobileOrders = () => {
    setMobileView("orders");
    updateCustomerRootRoute("orders");
  };

  const openMobileNotifications = () => {
    setLastSeenNotificationAt(Date.now());
    setMobileView("notifications");
    updateCustomerRootRoute("notifications");
  };

  const openDesktopOrders = () => {
    setNotificationCenterOpen(false);
    setDesktopView("orders");
    updateCustomerRootRoute("orders");
  };

  return (
    <div className="app-shell">
      <datalist id="iraq-location-options">
        {iraqLocationOptions.map((entry) => (
          <option key={`${entry.kind}-${entry.value}`} value={entry.value} />
        ))}
      </datalist>
      <div className="app-stage space-y-3 sm:space-y-6">
        <div className="space-y-3 min-[1600px]:hidden">
          <header className="app-panel">
            {mobileView === "browse" ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">{t("nav.customer")}</p>
                  <h1 className="mt-2 font-display text-xl font-extrabold text-white sm:text-2xl">{t("customer.heroTitle")}</h1>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate("/app/settings")}
                    className="compact-icon-button"
                  >
                    <Settings2 className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/app/about")}
                    className="compact-icon-button"
                  >
                    <Info className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => void logout()} className="compact-icon-button">
                    <LogOut className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMobileView("browse");
                    updateCustomerRootRoute("browse");
                    }}
                  className="compact-icon-button"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <h2 className="font-display text-base font-bold text-white sm:text-lg">
                  {mobileView === "cart" ? "سەبەتەی کڕین" : mobileView === "checkout" ? "ناردنی داواکاری" : mobileView === "notifications" ? "ئاگەدارکردنەوە" : "هەموو ئۆردەرەکانم"}
                </h2>
                <div className="w-10 sm:w-11" />
              </div>
            )}
          </header>

          {mobileView === "browse" ? (
            <>
              <section className="app-panel">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={openMobileOrders}
                    className="relative inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                  >
                    <ClipboardList className="h-4 w-4" />
                    هەموو ئۆردەرەکانم
                  </button>
                  <button
                    type="button"
                    onClick={openMobileNotifications}
                    className="relative inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                  >
                    <Bell className="h-4 w-4" />
                    ئاگەدارکردنەوە
                    {unreadNotificationsCount > 0 ? (
                      <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-400 px-1 text-[10px] font-bold text-slate-950">
                        {formatNumber(unreadNotificationsCount)}
                      </span>
                    ) : null}
                  </button>
                </div>
              </section>

              {!isOnline ? <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{t("customer.offlineHint")}</div> : null}

              <section className="app-panel">
                <label className="relative block">
                  <Search className="pointer-events-none absolute inset-y-0 left-4 my-auto h-5 w-5 text-slate-500" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("customer.searchPlaceholder")} className="compact-input py-2.5 pl-11 pr-4" />
                </label>
              </section>

              <CategoryFilterPanel
                categories={groupedCategories}
                activeCategory={activeCategory}
                onChange={setActiveCategory}
                locale={locale}
                allLabel={t("common.all")}
              />

              <section className="space-y-3 pb-28">
                {menuQuery.isLoading ? Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} />) : null}
                {!menuQuery.isLoading && !menuItems.length ? <div className="rounded-[20px] border border-dashed border-white/10 bg-white/5 p-6 text-center text-[0.92rem] text-slate-300 sm:rounded-[24px] sm:p-8">{t("customer.menuEmpty")}</div> : null}
                {menuItems.map((item) => {
                  const text = getMenuText(item, locale);
                  const category = groupedCategories.find((entry) => entry.id === item.categoryId);
                  return (
                    <article key={item.id} className="overflow-hidden rounded-[20px] border border-white/10 bg-slate-950/55 shadow-glow sm:rounded-[24px]">
                      <div className="grid grid-cols-[6.2rem_minmax(0,1fr)] gap-2.5 p-2.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3 sm:p-3">
                        <div className="h-24 overflow-hidden rounded-[16px] sm:h-28 sm:rounded-[18px]">
                          {item.imageUrl ? <img src={item.imageUrl} alt={text.name} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-gradient-to-br from-slate-700 to-slate-900" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-display text-base font-bold text-white break-words sm:text-lg">{text.name}</p>
                              <p className="mt-1 text-xs text-amber-100">{category ? getCategoryName(category, locale) : "-"}</p>
                            </div>
                            <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-slate-900">{formatCustomerCurrency(Number(item.basePrice))}</span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-[0.9rem] text-slate-300 break-words">{text.description}</p>
                          <button type="button" onClick={() => add(item)} className="mt-2.5 w-full rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-300 px-4 py-2.5 text-[0.9rem] font-semibold text-slate-950">
                            {t("common.add")}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            </>
          ) : null}

          {mobileView === "notifications" ? (
            <section className="space-y-3">
              {notificationItems.map((item) => (
                <div key={item.id} className="rounded-[20px] border border-white/10 bg-white/5 p-3.5 backdrop-blur-xl sm:rounded-[24px] sm:p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-white break-all">{item.title}</p>
                      <p className="mt-2 text-sm text-slate-300 break-words">{item.message}</p>
                      <NotificationCustomerMeta customerName={item.customerName} customerPhone={item.customerPhone} />
                      <p className="mt-2 text-xs text-slate-400">{formatDateTime(item.timestamp)}</p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  {item.canCancel || item.canDelete ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {item.canCancel ? (
                        <button
                          type="button"
                          onClick={() => void cancelCustomerOrder(item)}
                          disabled={cancelOrderMutation.isPending || deleteOrderMutation.isPending}
                          className="w-full rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {cancelOrderMutation.isPending ? t("common.loading") : "ڕەتکردنەوەی داواکاری"}
                        </button>
                      ) : null}
                      {item.canDelete ? (
                        <button
                          type="button"
                          onClick={() => void deleteCustomerOrder(item)}
                          disabled={cancelOrderMutation.isPending || deleteOrderMutation.isPending}
                          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deleteOrderMutation.isPending ? t("common.loading") : "سڕینەوەی داواکاری"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
              {!notificationItems.length ? <div className="rounded-[20px] border border-dashed border-white/10 bg-white/5 p-6 text-center text-[0.92rem] text-slate-300 sm:rounded-[24px] sm:p-8">هیچ ئاگەدارکردنەوەیەک نییە.</div> : null}
            </section>
          ) : null}

          {mobileView === "orders" ? (
            <CustomerOrdersPage
              groups={groupedOrderHistory}
              activeOrdersCount={activeOrdersCount}
              isLoading={historyQuery.isLoading}
              onViewOrder={(order) => navigate(`/app/orders/${order.id}`)}
              onCancelOrder={(order) => void cancelOrderFromHistory(order)}
              isActionPending={cancelOrderMutation.isPending || deleteOrderMutation.isPending}
            />
          ) : null}

          {mobileView === "cart" ? (
            <section className="space-y-3 pb-24">
              {lines.map((line) => {
                const text = getMenuText(line.menuItem, locale);
                return (
                  <div key={line.menuItem.id} className="rounded-[20px] border border-white/10 bg-white/5 p-3.5 backdrop-blur-xl sm:rounded-[24px] sm:p-4">
                    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                      <div className="h-24 overflow-hidden rounded-[18px]">
                        {line.menuItem.imageUrl ? <img src={line.menuItem.imageUrl} alt={text.name} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-gradient-to-br from-slate-700 to-slate-900" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-display text-lg font-bold text-white break-words">{text.name}</p>
                            <p className="mt-1 text-sm text-amber-100">{formatCustomerCurrency(Number(line.menuItem.basePrice))}</p>
                          </div>
                          <button type="button" onClick={() => remove(line.menuItem.id)} className="text-xs text-rose-200">{t("common.remove")}</button>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1">
                            <button type="button" onClick={() => setQuantity(line.menuItem.id, line.quantity - 1)} className="rounded-full bg-white/10 p-1 text-slate-200"><Minus className="h-4 w-4" /></button>
                            <span className="min-w-8 text-center text-sm font-semibold text-white">{formatNumber(line.quantity)}</span>
                            <button type="button" onClick={() => setQuantity(line.menuItem.id, line.quantity + 1)} className="rounded-full bg-white/10 p-1 text-slate-200"><Plus className="h-4 w-4" /></button>
                          </div>
                          <span className="font-semibold text-white">{formatCustomerCurrency(Number(line.menuItem.basePrice) * line.quantity)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {!lines.length ? <div className="rounded-[20px] border border-dashed border-white/10 bg-white/5 p-6 text-center text-[0.92rem] text-slate-300 sm:rounded-[24px] sm:p-8">{t("customer.emptyCart")}</div> : null}

              <div className="app-panel">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[0.92rem] text-slate-300">{t("common.total")}</span>
                  <strong className="font-display text-xl text-white sm:text-2xl">{formatCustomerCurrency(total)}</strong>
                </div>
              </div>

              <button type="button" onClick={openMobileCheckout} disabled={!lines.length} className="fixed bottom-4 left-3 right-3 z-30 rounded-[20px] bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 px-4 py-3.5 font-display text-base font-bold text-slate-950 shadow-glow disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-[22px] sm:py-4 sm:text-lg">
                ناردن
              </button>
            </section>
          ) : null}

          {mobileView === "checkout" ? (
            <section className="space-y-3 pb-24">
              <div className="app-panel">
                <div className="flex items-start gap-3">
                  <ReceiptText className="mt-0.5 h-5 w-5 text-sky-200" />
                  <div>
                    <p className="font-display text-base font-bold text-white sm:text-lg">زانیاری ناردنی داواکاری</p>
                    <p className="mt-2 text-[0.9rem] text-slate-300">کلیک کردن لە `ناردن` ڕاستەوخۆ داواکارییەکە بە هەموو زانیارییەکان دەچێت بۆ ئادمێن.</p>
                  </div>
                </div>
              </div>

              <form className="space-y-3" onSubmit={placeOrder}>
                <label className="block rounded-[20px] border border-white/10 bg-white/5 p-3.5 backdrop-blur-xl sm:rounded-[24px] sm:p-4">
                  <span className="mb-2 block text-[0.92rem] font-semibold text-slate-200">ناوی کڕیار</span>
                  <input value={customerNameKu} onChange={(event) => setCustomerNameKu(event.target.value)} placeholder="ناوی کڕیار" className="compact-input" />
                </label>

                <label className="block rounded-[20px] border border-white/10 bg-white/5 p-3.5 backdrop-blur-xl sm:rounded-[24px] sm:p-4">
                  <span className="mb-2 block text-[0.92rem] font-semibold text-slate-200">ژمارەی موبایلی عیراقی</span>
                    <input value={customerPhone} onChange={(event) => setCustomerPhone(normalizePhoneInput(event.target.value))} inputMode="numeric" pattern="[0-9]*" maxLength={11} autoComplete="tel-national" placeholder="07xxxxxxxxx" className="compact-input" dir="ltr" />
                </label>

                <label className="block rounded-[20px] border border-white/10 bg-white/5 p-3.5 backdrop-blur-xl sm:rounded-[24px] sm:p-4">
                  <span className="mb-2 block text-[0.92rem] font-semibold text-slate-200">پارێزگا</span>
                  <input
                    list="iraq-location-options"
                    value={customerGovernorate}
                    onChange={(event) => setCustomerGovernorate(event.target.value)}
                    placeholder="بگەڕێ و پارێزگا / شار / ناحیە هەڵبژێرە"
                    className="compact-input"
                  />
                  <p className="mt-2 text-xs text-slate-400">سەرەتا هەموو شوێنەکانی کوردستان، دواتر شوێنەکانی تری عیراق.</p>
                </label>

                <label className="block rounded-[20px] border border-white/10 bg-white/5 p-3.5 backdrop-blur-xl sm:rounded-[24px] sm:p-4">
                  <span className="mb-2 block text-[0.92rem] font-semibold text-slate-200">وردەکاری ناونیشان (ئارەزوومەندانە)</span>
                  <textarea value={customerAddressKu} onChange={(event) => setCustomerAddressKu(event.target.value)} rows={3} placeholder="کۆڵان، نزیکترین شوێنی ناسراو، ژمارەی خانوو..." className="compact-input" />
                </label>

                <label className="block rounded-[20px] border border-white/10 bg-white/5 p-3.5 backdrop-blur-xl sm:rounded-[24px] sm:p-4">
                  <span className="mb-2 block text-[0.92rem] font-semibold text-slate-200">تێبینی (ئارەزوومەندانە)</span>
                  <textarea value={notesKu} onChange={(event) => setNotesKu(event.target.value)} rows={3} placeholder={t("customer.notesHint")} className="compact-input" />
                </label>

                <div className="app-panel">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[0.92rem] text-slate-300">{t("common.total")}</span>
                    <strong className="font-display text-xl text-white sm:text-2xl">{formatCustomerCurrency(total)}</strong>
                  </div>
                </div>

                <button type="submit" disabled={isSubmitDisabled} className="fixed bottom-4 left-3 right-3 z-30 rounded-[20px] bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 px-4 py-3.5 font-display text-base font-bold text-slate-950 shadow-glow disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-[22px] sm:py-4 sm:text-lg">
                  {orderMutation.isPending ? t("common.loading") : "ناردن"}
                </button>
              </form>
            </section>
          ) : null}

          {mobileView === "browse" && lines.length ? (
            <button
              type="button"
              onClick={openMobileCart}
              className="fixed bottom-4 left-3 right-3 z-30 rounded-[20px] border border-white/10 bg-slate-950/95 px-4 py-3.5 text-left shadow-glow backdrop-blur-xl sm:rounded-[24px] sm:py-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-display text-base font-bold text-white sm:text-lg">سەبەتەی کڕین</span>
                <span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-bold text-slate-950">{formatNumber(cartItemsCount)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[0.9rem] text-slate-300">
                <span>کۆی گشتی</span>
                <strong className="font-display text-base text-white sm:text-lg">{formatCustomerCurrency(total)}</strong>
              </div>
            </button>
          ) : null}
        </div>

        <div className="hidden space-y-3 sm:space-y-5 min-[1600px]:block">
        <header className="app-panel sm:rounded-[30px]">
          <div className="flex flex-col gap-5 min-[1700px]:flex-row min-[1700px]:items-center min-[1700px]:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.4em] text-amber-200/70">{t("nav.customer")}</p>
              <h1 className="mt-3 font-display text-[clamp(1.7rem,4vw,3rem)] font-extrabold text-white">{t("customer.heroTitle")}</h1>
              <p className="mt-2.5 max-w-2xl text-[0.92rem] leading-6 text-slate-300">{t("customer.heroSubtitle")}</p>
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
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/app/settings")}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-[0.85rem] text-slate-200 hover:bg-white/10"
                >
                  <Settings2 className="h-4 w-4" />
                  ڕێکخستن
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/app/about")}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-[0.85rem] text-slate-200 hover:bg-white/10"
                >
                  <Info className="h-4 w-4" />
                  دەربارە
                </button>
                <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold", isOnline ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200" : "border-rose-300/30 bg-rose-400/10 text-rose-200")}>
                  {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />} {isOnline ? t("common.online") : t("common.offline")}
                </span>
                <button type="button" onClick={() => void logout()} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-[0.85rem] text-slate-200 hover:bg-white/10"><LogOut className="h-4 w-4" /> {t("common.logout")}</button>
              </div>
            </div>
          </div>
          <div className="mt-5 grid gap-3 min-[1500px]:grid-cols-3">
            <div className="rounded-[20px] border border-white/10 bg-slate-950/35 p-3.5 sm:rounded-[24px] sm:p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Cart</p>
              <h2 className="mt-3 font-display text-xl font-extrabold text-white sm:text-2xl">{formatNumber(cartItemsCount)} {t("common.quantity")}</h2>
              <p className="mt-2 text-[0.9rem] text-amber-100">{formatCustomerCurrency(total)}</p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-slate-950/35 p-3.5 sm:rounded-[24px] sm:p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Orders</p>
              <h2 className="mt-3 font-display text-xl font-extrabold text-white sm:text-2xl">{formatNumber(activeOrdersCount)}</h2>
              <p className="mt-2 text-[0.9rem] text-sky-100">{t("customer.currentOrders")}</p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-slate-950/35 p-3.5 sm:rounded-[24px] sm:p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Table</p>
              <h2 className="mt-3 font-display text-xl font-extrabold text-white sm:text-2xl">{tableLabel || "-"}</h2>
              <p className="mt-2 text-[0.9rem] text-slate-300">{tableLabel ? t("customer.tableDetected", { defaultValue: "مێزەکە بە شێوەی ئۆتۆماتیک دیاریکراوە." }) : "دەتوانیت بەبێ دیاریکردنی مێزیش داوا بکەیت."}</p>
            </div>
          </div>
          {!isOnline ? <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{t("customer.offlineHint")}</div> : null}
        </header>

        <section className="app-panel sm:rounded-[30px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={openDesktopOrders}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                desktopView === "orders" ? "border-sky-300/30 bg-sky-400/10 text-sky-100" : "border-white/10 bg-slate-950/35 text-slate-100 hover:bg-white/10"
              )}
            >
              <ClipboardList className="h-4 w-4" />
              هەموو ئۆردەرەکانم
            </button>
            <button
              type="button"
              onClick={toggleNotificationCenter}
              className={cn(
                "relative inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                notificationCenterOpen ? "border-amber-300/30 bg-amber-300/10 text-amber-100" : "border-white/10 bg-slate-950/35 text-slate-100 hover:bg-white/10"
              )}
            >
              <Bell className="h-4 w-4" />
              ئاگەدارکردنەوە
              {unreadNotificationsCount > 0 ? (
                <span className="absolute -right-2 -top-2 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-rose-400 px-1.5 text-xs font-bold text-slate-950">
                  {formatNumber(unreadNotificationsCount)}
                </span>
              ) : null}
            </button>
          </div>
        </section>

        {notificationCenterOpen ? (
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:rounded-[32px] sm:p-5">
            <div className="mb-4 flex flex-col gap-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <Bell className="h-5 w-5 text-amber-300" />
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-bold text-white">ئاگەدارکردنەوەی داواکاری</h2>
                  <p className="mt-1 text-sm text-slate-300">لێرە دەتوانیت دۆخی داواکارییەکانت ببینیت بە پێی وەڵامی ئادمێن.</p>
                </div>
              </div>
              <button type="button" onClick={toggleNotificationCenter} className="self-start rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10 min-[520px]:self-auto">
                {t("common.close")}
              </button>
            </div>
            <div className="space-y-3">
              {notificationItems.map((item) => (
                <div key={item.id} className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-white break-all">{item.title}</p>
                      <p className="mt-2 text-sm text-slate-300 break-words">{item.message}</p>
                      <NotificationCustomerMeta customerName={item.customerName} customerPhone={item.customerPhone} />
                      <p className="mt-2 text-xs text-slate-400">{formatDateTime(item.timestamp)}</p>
                    </div>
                    <div className="self-start">
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                  {item.canCancel || item.canDelete ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {item.canCancel ? (
                        <button
                          type="button"
                          onClick={() => void cancelCustomerOrder(item)}
                          disabled={cancelOrderMutation.isPending || deleteOrderMutation.isPending}
                          className="rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {cancelOrderMutation.isPending ? t("common.loading") : "ڕەتکردنەوەی داواکاری"}
                        </button>
                      ) : null}
                      {item.canDelete ? (
                        <button
                          type="button"
                          onClick={() => void deleteCustomerOrder(item)}
                          disabled={cancelOrderMutation.isPending || deleteOrderMutation.isPending}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deleteOrderMutation.isPending ? t("common.loading") : "سڕینەوەی داواکاری"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
              {!notificationItems.length ? <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-950/30 p-8 text-center text-sm text-slate-300">هیچ ئاگەدارکردنەوەیەک نییە.</div> : null}
            </div>
          </section>
        ) : null}

        {desktopView === "orders" ? (
          <CustomerOrdersPage
            groups={groupedOrderHistory}
            activeOrdersCount={activeOrdersCount}
            isLoading={historyQuery.isLoading}
            onViewOrder={(order) => navigate(`/app/orders/${order.id}`)}
            onBack={() => {
              setDesktopView("dashboard");
              updateCustomerRootRoute("dashboard");
            }}
            onCancelOrder={(order) => void cancelOrderFromHistory(order)}
            isActionPending={cancelOrderMutation.isPending || deleteOrderMutation.isPending}
          />
        ) : (
        <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,1.28fr)_minmax(18rem,0.94fr)] 2xl:gap-6">
          <section className="min-w-0 space-y-4 sm:space-y-6">
            <div className="app-panel sm:rounded-[30px]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-bold text-white">گەڕان لە مینو</h2>
                  <p className="mt-1 text-[0.9rem] text-slate-300">بە ناوی خواردن یان وەسف بگەڕێ، پاشان بە پۆل پاڵاوتنی وردتر بکە.</p>
                </div>
              </div>
              <label className="relative mt-4 block">
                <Search className="pointer-events-none absolute inset-y-0 left-4 my-auto h-5 w-5 text-slate-500" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("customer.searchPlaceholder")} className="w-full rounded-2xl border border-white/10 bg-slate-950/35 py-3 pl-11 pr-4 text-sm text-slate-100 outline-none transition focus:border-amber-300/50" />
              </label>
            </div>

            <CategoryFilterPanel
              categories={groupedCategories}
              activeCategory={activeCategory}
              onChange={setActiveCategory}
              locale={locale}
              allLabel={t("common.all")}
            />

            <div className="grid gap-4 min-[460px]:grid-cols-2 min-[1700px]:grid-cols-3">
              {menuQuery.isLoading ? Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} />) : null}
              {!menuQuery.isLoading && !menuItems.length ? <div className="col-span-full rounded-[28px] border border-dashed border-white/10 bg-white/5 p-10 text-center text-slate-300">{t("customer.menuEmpty")}</div> : null}
              {menuItems.map((item) => {
                const text = getMenuText(item, locale);
                const category = groupedCategories.find((entry) => entry.id === item.categoryId);
                return (
                  <article key={item.id} className="min-w-0 overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/55 shadow-glow transition hover:-translate-y-1 hover:border-amber-300/30 sm:rounded-[28px]">
                    <div className="relative h-44 overflow-hidden min-[420px]:h-48">
                      {item.imageUrl ? <img src={item.imageUrl} alt={text.name} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-gradient-to-br from-slate-700 to-slate-900" />}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
                      <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-end justify-between gap-3">
                        <span className="rounded-full bg-black/50 px-3 py-1 text-xs font-semibold text-amber-100 break-words">{category ? getCategoryName(category, locale) : "-"}</span>
                        <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-bold text-slate-900">{formatCustomerCurrency(Number(item.basePrice))}</span>
                      </div>
                    </div>
                    <div className="space-y-4 p-4 sm:p-5">
                      <div className="min-w-0">
                        <h3 className="font-display text-xl font-bold text-white break-words">{text.name}</h3>
                        <p className="mt-2 line-clamp-3 text-sm text-slate-300 break-words">{text.description}</p>
                      </div>
                      <button type="button" onClick={() => add(item)} className="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-300 px-4 py-3 font-semibold text-slate-950 transition hover:brightness-110">{t("common.add")}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="min-w-0 space-y-4 sm:space-y-6 min-[1500px]:sticky min-[1500px]:top-4 min-[1500px]:self-start">
            <section className="rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:rounded-[32px] sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">{t("customer.cart")}</p>
                  <h2 className="mt-2 font-display text-2xl font-bold text-white">{formatNumber(cartItemsCount)} {t("common.quantity")}</h2>
                  <p className="mt-2 text-sm text-slate-300">{checkoutStep === "cart" ? "خواردن هەڵبژێرە، نرخی کۆی گشتی ببینە، و پاشان بڕۆ بۆ ناردنی داواکاری." : "ئەم زانیارییە بە تەواوی دەنێردرێت بۆ ئادمێن لەگەڵ هەموو items و کۆی نرخ."}</p>
                </div>
                <ShoppingBag className="h-9 w-9 text-amber-300" />
              </div>

              <div className="space-y-3">
                {!lines.length ? <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 px-4 py-6 text-center text-sm text-slate-300">{t("customer.emptyCart")}</div> : null}
                {lines.map((line) => {
                  const text = getMenuText(line.menuItem, locale);
                  return (
                    <div key={line.menuItem.id} className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold text-white break-words">{text.name}</p>
                          <p className="text-sm text-slate-400">{formatCustomerCurrency(Number(line.menuItem.basePrice))}</p>
                        </div>
                        <button type="button" onClick={() => remove(line.menuItem.id)} className="text-sm text-rose-200">{t("common.remove")}</button>
                      </div>
                      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1">
                          <button type="button" onClick={() => setQuantity(line.menuItem.id, line.quantity - 1)} className="rounded-full bg-white/10 p-1 text-slate-200"><Minus className="h-4 w-4" /></button>
                          <span className="min-w-8 text-center text-sm font-semibold text-white">{formatNumber(line.quantity)}</span>
                          <button type="button" onClick={() => setQuantity(line.menuItem.id, line.quantity + 1)} className="rounded-full bg-white/10 p-1 text-slate-200"><Plus className="h-4 w-4" /></button>
                        </div>
                        <span className="font-semibold text-amber-200">{formatCustomerCurrency(Number(line.menuItem.basePrice) * line.quantity)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 rounded-2xl bg-gradient-to-r from-amber-300/15 to-orange-400/15 px-4 py-3 text-sm text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t("common.total")}</span>
                  <strong className="font-display text-xl text-white">{formatCustomerCurrency(total)}</strong>
                </div>
              </div>

              {checkoutStep === "cart" ? (
                <div className="mt-5 space-y-3">
                  <button type="button" onClick={proceedToCheckout} disabled={!lines.length} className="w-full rounded-2xl bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 px-4 py-4 font-display text-lg font-bold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
                    بڕۆ بۆ ناردنی داواکاری
                  </button>
                  <button type="button" onClick={clear} disabled={!lines.length} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60">
                    {t("common.clear")}
                  </button>
                </div>
              ) : (
                <form className="mt-5 space-y-4" onSubmit={placeOrder}>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                    <div className="flex items-start gap-3">
                      <ReceiptText className="mt-0.5 h-5 w-5 text-sky-200" />
                      <div>
                        <p className="font-display text-lg font-bold text-white">{t("customer.orderFormTitle", { defaultValue: "زانیاری ناردنی داواکاری" })}</p>
                        <p className="mt-2 text-sm text-slate-300">تەنها ناوی کڕیار، ژمارەی موبایل، و پارێزگا پێویستن. وردەکاری ناونیشان و تێبینی ئارەزوومەندانەن.</p>
                        {tableLabel ? <p className="mt-2 text-sm text-sky-100">{t("customer.tableDetected", { defaultValue: "مێزی دیاریکراو" })} <span className="font-semibold text-white">{tableLabel}</span></p> : null}
                      </div>
                    </div>
                  </div>
                  <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-200">{t("common.customerName")}</span><input value={customerNameKu} onChange={(event) => setCustomerNameKu(event.target.value)} placeholder={t("customer.nameHint", { defaultValue: "ناوی کڕیار" })} className="w-full rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/50" /></label>
                  <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-200">{t("common.customerPhone")}</span><input value={customerPhone} onChange={(event) => setCustomerPhone(normalizePhoneInput(event.target.value))} inputMode="numeric" pattern="[0-9]*" maxLength={11} autoComplete="tel-national" placeholder={t("customer.phoneHint", { defaultValue: "ژمارەی کڕیار" })} className="w-full rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/50" dir="ltr" /></label>
                  <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-200">پارێزگا</span><input list="iraq-location-options" value={customerGovernorate} onChange={(event) => setCustomerGovernorate(event.target.value)} placeholder="بگەڕێ و پارێزگا / شار / ناحیە هەڵبژێرە" className="w-full rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/50" /><p className="mt-2 text-xs text-slate-400">سەرەتا هەموو شوێنەکانی کوردستان، دواتر شوێنەکانی تری عیراق.</p></label>
                  <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-200">وردەکاری ناونیشان (ئارەزوومەندانە)</span><textarea value={customerAddressKu} onChange={(event) => setCustomerAddressKu(event.target.value)} rows={3} placeholder="کۆڵان، نزیکترین شوێنی ناسراو، ژمارەی خانوو..." className="w-full rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/50" /></label>
                  <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-200">تێبینی (ئارەزوومەندانە)</span><textarea value={notesKu} onChange={(event) => setNotesKu(event.target.value)} rows={3} placeholder={t("customer.notesHint")} className="w-full rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/50" /></label>
                  <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                    <button type="button" onClick={() => setCheckoutStep("cart")} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">
                      <ChevronLeft className="h-4 w-4" />
                      گەڕانەوە بۆ سەبەتە
                    </button>
                    <button type="submit" disabled={isSubmitDisabled} className="w-full rounded-2xl bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 px-4 py-4 font-display text-lg font-bold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">{orderMutation.isPending ? t("common.loading") : t("customer.placeOrder")}</button>
                  </div>
                </form>
              )}
            </section>
          </aside>
        </div>
        )}
        </div>
      </div>
    </div>
  );
};

export const CustomerOrderDetailPage = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const pollingInterval = isRealtimeEnabled() ? false : 5000;

  const orderHistoryQuery = useQuery({
    queryKey: ["orders", "history"],
    queryFn: api.getOrderHistory,
    refetchInterval: pollingInterval
  });
  const orderMenuItemsQuery = useQuery({
    queryKey: ["menu", "all-order-items", locale],
    queryFn: () => api.getMenu({ locale }),
    refetchInterval: pollingInterval
  });
  const menuItemsById = useMemo(() => new Map((orderMenuItemsQuery.data?.items ?? []).map((item) => [item.id, item])), [orderMenuItemsQuery.data]);

  const order = useMemo(() => {
    if (!orderId || !orderHistoryQuery.data) return null;
    return orderHistoryQuery.data.find((item) => item.id === orderId) ?? null;
  }, [orderId, orderHistoryQuery.data]);

  if (orderHistoryQuery.isLoading || orderMenuItemsQuery.isLoading) {
    return (
      <div className="app-shell">
        <div className="app-stage">
          <div className="app-panel text-center">
            <p className="font-display text-lg font-semibold text-white">چاوەڕوانبە، زانیاریی داواکاریەکە دێت...</p>
          </div>
        </div>
      </div>
    );
  }

  if (isPersistentStorageOutageError(orderHistoryQuery.error) || isPersistentStorageOutageError(orderMenuItemsQuery.error)) {
    return (
      <HostedMaintenancePanel
        title="وردەکاری داواکاری بەردەست نییە"
        message="کێشەیەک هەیە لە هەڵگرتنی زانیارییەکان لە production. تکایە دوای ماوەیەکی کەم دووبارە هەوڵ بدە."
      />
    );
  }

  if (!order) {
    return (
      <div className="app-shell">
        <div className="app-stage">
          <div className="app-panel p-6 text-center">
            <p className="font-display text-lg font-semibold text-white">داواکارییەکە نەدۆزرایەوە.</p>
            <button
              type="button"
              onClick={() => navigate("/app?view=orders")}
              className="mt-4 rounded-2xl border border-white/10 bg-sky-400/10 px-4 py-2 font-semibold text-sky-100 hover:bg-sky-400/20"
            >
              گەڕانەوە بۆ هەموو ئۆردەرەکانم
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-stage space-y-4 sm:space-y-6">
        <CustomerPageHeader
          eyebrow="داواکاری"
          title="بینینی ئۆڵدەر"
          description="ناو، ژمارەی موبایل، ناونیشان، تێبینی و هەموو خواردنەکانت لێرە نیشان دەدرێن."
          backLabel="گەڕانەوە بۆ هەموو ئۆردەرەکانم"
          onBack={() => navigate("/app?view=orders")}
        />
        <CustomerOrderDetails order={order} menuItemsById={menuItemsById} onClose={() => navigate("/app?view=orders")} />
      </div>
    </div>
  );
};

export const CustomerSettingsPage = () => {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const { catalogQuery, categories, menuItems, menuItemsByCategory } = useCustomerSettingsCatalog(locale);
  const customerAvailability = useCustomerAvailabilitySettings();
  const [itemSearch, setItemSearch] = useState("");

  const filteredMenuItems = useMemo(() => {
    const normalizedQuery = itemSearch.trim().toLowerCase();

    return menuItems.filter((item) => {
      if (!normalizedQuery) {
        return true;
      }

      const text = getMenuText(item, locale);
      return [text.name, text.description].join(" ").toLowerCase().includes(normalizedQuery);
    });
  }, [itemSearch, locale, menuItems]);

  if (catalogQuery.isLoading) {
    return (
      <div className="app-shell">
        <div className="app-stage">
          <div className="app-panel text-center">
            <p className="font-display text-lg font-semibold text-white">چاوەڕوانبە، ڕێکخستنەکان ئامادە دەکرێن...</p>
          </div>
        </div>
      </div>
    );
  }

  if (isPersistentStorageOutageError(catalogQuery.error)) {
    return (
      <HostedMaintenancePanel
        title="ڕێکخستنەکان بەردەست نین"
        message="هەڵگرتنی زانیارییەکان لە production کێشەی هەیە، بۆیە لیستی خواردن و پۆلەکان ئێستا بارنابن."
      />
    );
  }

  const enabledCategoriesCount = categories.filter((category) => customerAvailability.isCategoryAvailable(category.id)).length;
  const enabledMenuItemsCount = menuItems.filter((item) => customerAvailability.isMenuItemAvailable(item)).length;
  const disabledCategoriesCount = Math.max(0, categories.length - enabledCategoriesCount);
  const disabledMenuItemsCount = Math.max(0, menuItems.length - enabledMenuItemsCount);

  return (
    <div className="app-shell">
      <div className="app-stage space-y-4 sm:space-y-6">
        <CustomerPageHeader
          eyebrow="ڕێکخستن"
          title="بەڕێوەبردنی بەردەستی خواردن و پۆلەکان"
          description="لێرە دەتوانیت بۆ هەر پۆل و هەر خواردنێک بڕیار بدەیت کە بەردەست بێت یان نا. شێوازی مۆبایل و لاپتۆپ هەردووکیان ئێستا هەمان ڕێکخستنیان هەیە."
          backLabel="گەڕانەوە بۆ سەرەکی"
          onBack={() => navigate("/app")}
        />

        <section className="grid gap-3 min-[460px]:grid-cols-2">
          <CustomerOverviewStat
            label="Categories"
            value={formatNumber(enabledCategoriesCount)}
            description={"لە " + formatNumber(disabledCategoriesCount) + " پۆلی دیکە، ئەمانە ئێستا بەردەستن و لە فلتەر و menu ـدا دەردەکەون."}
          />
          <CustomerOverviewStat
            label="Menu Items"
            value={formatNumber(enabledMenuItemsCount)}
            description={"لە " + formatNumber(disabledMenuItemsCount) + " خواردنی دیکە، ئەمانە هێشتا بۆ هەڵبژاردنی کڕیار کراوەن."}
          />
        </section>

        <section className="app-panel">
          <div className="flex flex-col gap-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-white">بەشی پۆلەکان</h2>
              <p className="mt-1 text-sm leading-7 text-slate-300">هەموو پۆلەکان لێرەیەن. دەتوانیت بە خێرایی دۆخیان بگۆڕیت یان بچیتە پەیجی تایبەتی هەر پۆلێک.</p>
            </div>
            <span className="inline-flex self-start rounded-full border border-white/10 bg-slate-950/35 px-3 py-1 text-xs font-semibold text-slate-300 min-[520px]:self-auto">
              {formatNumber(categories.length)} پۆل
            </span>
          </div>

          <div className="mt-4 grid gap-3 min-[1500px]:grid-cols-2">
            {categories.map((category) => {
              const isAvailable = customerAvailability.isCategoryAvailable(category.id);
              const categoryItemsCount = menuItemsByCategory.get(category.id)?.length ?? 0;

              return (
                <article key={category.id} className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4 sm:rounded-[24px]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <button
                      type="button"
                      onClick={() => navigate("/app/settings/categories/" + category.id)}
                      className="min-w-0 text-right"
                    >
                      <p className="font-display text-lg font-bold text-white break-words">{getCategoryName(category, locale)}</p>
                      <p className="mt-1 text-xs text-slate-400">{category.slug}</p>
                      <p className="mt-3 text-sm text-slate-300">{formatNumber(categoryItemsCount)} خواردن لەم پۆلەدایە.</p>
                    </button>
                    <span className={cn(
                      "inline-flex self-start rounded-full border px-3 py-1 text-xs font-semibold",
                      isAvailable ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-rose-300/30 bg-rose-400/10 text-rose-100"
                    )}>
                      {isAvailable ? "ON" : "OFF"}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <AvailabilitySwitch
                      enabled={isAvailable}
                      onToggle={(nextValue) => customerAvailability.setCategoryAvailability(category.id, nextValue)}
                      className="w-full justify-center sm:justify-start"
                    />
                    <button
                      type="button"
                      onClick={() => navigate("/app/settings/categories/" + category.id)}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
                    >
                      بینینی وردەکاری
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="app-panel">
          <div className="flex flex-col gap-3 min-[1500px]:flex-row min-[1500px]:items-center min-[1500px]:justify-between">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-white">بەشی خواردنەکان</h2>
              <p className="mt-1 text-sm leading-7 text-slate-300">هەموو خواردنەکان لێرە دەردەکەون. لە مۆبایل و لاپتۆپ هەردووکیاندا دەتوانیت دۆخی هەر یەکێک بگۆڕیت یان پەیجی تایبەتی بکەیتەوە.</p>
            </div>
            <label className="relative block w-full min-[1500px]:w-96">
              <Search className="pointer-events-none absolute inset-y-0 left-4 my-auto h-4 w-4 text-slate-500" />
              <input
                value={itemSearch}
                onChange={(event) => setItemSearch(event.target.value)}
                placeholder="بگەڕێ بۆ خواردن"
                className="compact-input py-2.5 pl-10 pr-4 text-sm"
              />
            </label>
          </div>

          <div className="mt-4 space-y-3">
            {filteredMenuItems.map((item) => {
              const text = getMenuText(item, locale);
              const category = categories.find((entry) => entry.id === item.categoryId);
              const isAvailable = customerAvailability.isMenuItemAvailable(item);

              return (
                <article key={item.id} className="rounded-[22px] border border-white/10 bg-slate-950/35 p-3.5 sm:rounded-[24px] sm:p-4">
                  <div className="grid gap-3 min-[430px]:grid-cols-[5.8rem_minmax(0,1fr)] sm:grid-cols-[6.5rem_minmax(0,1fr)]">
                    <button
                      type="button"
                      onClick={() => navigate("/app/settings/menu-items/" + item.id)}
                      className="h-24 overflow-hidden rounded-[18px] sm:h-28"
                    >
                      {item.imageUrl ? <img src={item.imageUrl} alt={text.name} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-gradient-to-br from-slate-700 to-slate-900" />}
                    </button>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => navigate("/app/settings/menu-items/" + item.id)}
                        className="w-full text-right"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-display text-lg font-bold text-white break-words">{text.name}</p>
                            <p className="mt-1 text-xs text-amber-100">{category ? getCategoryName(category, locale) : "پۆل"}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-slate-900">
                              {formatCustomerCurrency(item.basePrice)}
                            </span>
                            <span className={cn(
                              "rounded-full border px-3 py-1 text-xs font-semibold",
                              isAvailable ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-rose-300/30 bg-rose-400/10 text-rose-100"
                            )}>
                              {isAvailable ? "ON" : "OFF"}
                            </span>
                          </div>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-300">{text.description}</p>
                      </button>
                      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <AvailabilitySwitch
                          enabled={isAvailable}
                          onToggle={(nextValue) => customerAvailability.setMenuItemAvailability(item, nextValue)}
                          className="w-full justify-center sm:justify-start"
                        />
                        <button
                          type="button"
                          onClick={() => navigate("/app/settings/menu-items/" + item.id)}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
                        >
                          بینینی وردەکاری
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}

            {!filteredMenuItems.length ? (
              <div className="rounded-[22px] border border-dashed border-white/10 bg-white/5 p-6 text-center text-sm text-slate-300">
                هیچ خواردنێک بەم ناوە نەدۆزرایەوە.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
};

export const CustomerCategorySettingsDetailPage = () => {
  const navigate = useNavigate();
  const { categoryId } = useParams<{ categoryId: string }>();
  const { i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const { catalogQuery, categories, menuItemsByCategory } = useCustomerSettingsCatalog(locale);
  const customerAvailability = useCustomerAvailabilitySettings();

  if (catalogQuery.isLoading) {
    return (
      <div className="app-shell">
        <div className="app-stage">
          <div className="app-panel text-center">
            <p className="font-display text-lg font-semibold text-white">چاوەڕوانبە، زانیاریی پۆلەکە دێت...</p>
          </div>
        </div>
      </div>
    );
  }

  if (isPersistentStorageOutageError(catalogQuery.error)) {
    return (
      <HostedMaintenancePanel
        title="وردەکاری پۆل بەردەست نییە"
        message="هەڵگرتنی زانیارییەکان لە production کێشەی هەیە. تکایە دوای ماوەیەکی کەم دووبارە هەوڵ بدە."
      />
    );
  }

  const category = categories.find((entry) => entry.id === categoryId);

  if (!category) {
    return (
      <div className="app-shell">
        <div className="app-stage">
          <div className="app-panel text-center">
            <p className="font-display text-lg font-semibold text-white">پۆلەکە نەدۆزرایەوە.</p>
            <button
              type="button"
              onClick={() => navigate("/app/settings")}
              className="mt-4 compact-pill-button justify-center"
            >
              <ChevronLeft className="h-4 w-4" />
              گەڕانەوە بۆ ڕێکخستن
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isAvailable = customerAvailability.isCategoryAvailable(category.id);
  const categoryItems = menuItemsByCategory.get(category.id) ?? [];

  return (
    <div className="app-shell">
      <div className="app-stage space-y-4 sm:space-y-6">
        <CustomerPageHeader
          eyebrow="وردەکاری پۆل"
          title={getCategoryName(category, locale)}
          description="دۆخی ئەم پۆلە لێرە دەگۆڕدرێت، و هەموو خواردنەکانی لە browse page ـدا بە پێی ئەم دۆخە پیشان دەدرێن."
          backLabel="گەڕانەوە بۆ ڕێکخستن"
          onBack={() => navigate("/app/settings")}
        />

        <section className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,1fr)_19rem]">
          <article className="app-panel">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">پوختەی پۆل</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <DetailField label="ناوی پۆل" value={getCategoryName(category, locale)} />
              <DetailField label="slug" value={category.slug} dir="ltr" />
              <DetailField label="ژمارەی خواردنەکان" value={formatNumber(categoryItems.length)} />
              <DetailField label="دۆخی ئێستا" value={isAvailable ? "بەردەستە" : "بەردەست نیە"} />
            </div>

            <div className="mt-5 rounded-[20px] border border-white/10 bg-slate-950/35 p-4 sm:rounded-[24px]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">خواردنەکانی ئەم پۆلە</p>
                <span className="inline-flex self-start rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300 sm:self-auto">
                  {formatNumber(categoryItems.length)} خواردن
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 min-[1500px]:grid-cols-3">
                {categoryItems.slice(0, 9).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate("/app/settings/menu-items/" + item.id)}
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-right text-sm text-slate-200 transition hover:bg-white/10"
                  >
                    {getMenuText(item, locale).name}
                  </button>
                ))}
              </div>
            </div>
          </article>

          <aside className="app-panel">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Availability</p>
            <h2 className="mt-3 font-display text-xl font-bold text-white">{isAvailable ? "پۆلەکە بەردەستە" : "پۆلەکە بەردەست نیە"}</h2>
            <p className="mt-2 text-sm leading-7 text-slate-300">ئەگەر OFF بکرێت، لە menu و فلتەری کڕیاردا ئەم پۆلە و خواردنەکانی نادیار دەبن.</p>
            <AvailabilitySwitch
              enabled={isAvailable}
              onToggle={(nextValue) => customerAvailability.setCategoryAvailability(category.id, nextValue)}
              className="mt-5 w-full justify-center"
            />
          </aside>
        </section>
      </div>
    </div>
  );
};

export const CustomerMenuItemSettingsDetailPage = () => {
  const navigate = useNavigate();
  const { itemId } = useParams<{ itemId: string }>();
  const { i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const { catalogQuery, categories, menuItemsById } = useCustomerSettingsCatalog(locale);
  const customerAvailability = useCustomerAvailabilitySettings();

  if (catalogQuery.isLoading) {
    return (
      <div className="app-shell">
        <div className="app-stage">
          <div className="app-panel text-center">
            <p className="font-display text-lg font-semibold text-white">چاوەڕوانبە، زانیاریی خواردنەکە دێت...</p>
          </div>
        </div>
      </div>
    );
  }

  if (isPersistentStorageOutageError(catalogQuery.error)) {
    return (
      <HostedMaintenancePanel
        title="وردەکاری خواردن بەردەست نییە"
        message="هەڵگرتنی زانیارییەکان لە production کێشەی هەیە. تکایە دوای ماوەیەکی کەم دووبارە هەوڵ بدە."
      />
    );
  }

  const item = itemId ? menuItemsById.get(itemId) ?? null : null;

  if (!item) {
    return (
      <div className="app-shell">
        <div className="app-stage">
          <div className="app-panel text-center">
            <p className="font-display text-lg font-semibold text-white">خواردنەکە نەدۆزرایەوە.</p>
            <button
              type="button"
              onClick={() => navigate("/app/settings")}
              className="mt-4 compact-pill-button justify-center"
            >
              <ChevronLeft className="h-4 w-4" />
              گەڕانەوە بۆ ڕێکخستن
            </button>
          </div>
        </div>
      </div>
    );
  }

  const text = getMenuText(item, locale);
  const category = categories.find((entry) => entry.id === item.categoryId);
  const isAvailable = customerAvailability.isMenuItemAvailable(item);

  return (
    <div className="app-shell">
      <div className="app-stage space-y-4 sm:space-y-6">
        <CustomerPageHeader
          eyebrow="وردەکاری خواردن"
          title={text.name}
          description="لێرە دەتوانیت دۆخی بەردەستی ئەم خواردنە بگۆڕیت و زانیاریی تەواوی ببینیت."
          backLabel="گەڕانەوە بۆ ڕێکخستن"
          onBack={() => navigate("/app/settings")}
        />

        <section className="grid gap-4 min-[1500px]:grid-cols-[18rem_minmax(0,1fr)]">
          <article className="app-panel">
            <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/35">
              {item.imageUrl ? <img src={item.imageUrl} alt={text.name} className="h-72 w-full object-cover" /> : <div className="h-72 w-full bg-gradient-to-br from-slate-700 to-slate-900" />}
            </div>
            <AvailabilitySwitch
              enabled={isAvailable}
              onToggle={(nextValue) => customerAvailability.setMenuItemAvailability(item, nextValue)}
              className="mt-5 w-full justify-center"
            />
          </article>

          <article className="app-panel">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">پوختەی خواردن</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <DetailField label="ناوی خواردن" value={text.name} />
              <DetailField label="پۆل" value={category ? getCategoryName(category, locale) : "پۆل"} />
              <DetailField label="نرخ" value={formatCustomerCurrency(item.basePrice)} />
              <DetailField label="دۆخی ئێستا" value={isAvailable ? "بەردەستە" : "بەردەست نیە"} />
            </div>

            <div className="mt-5 rounded-[20px] border border-white/10 bg-slate-950/35 p-4 sm:rounded-[24px]">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">دەربارەی ئەم خواردنە</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">{text.description}</p>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
};

export const CustomerAboutPage = () => {
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <div className="app-stage space-y-4 sm:space-y-6">
        <CustomerPageHeader
          eyebrow="دەربارە"
          title="دەربارەی بەکارهێنانی ئەم سیستەمە"
          description="ئەم پەیجە بۆ ئەوە دروست کراوە کە کڕیار بە شێوەیەکی ڕوون و ئاسان لە ڕێگای پلاتفۆڕمەکە خواردن هەڵبژێرێت، داواکاری بنێرێت، دۆخی ئۆڵدەرەکەی بەدواداچوون بکات، و بە هەموو زانیارییە پێویستەکان لە ماوەیەکی کورت بگات."
          backLabel="گەڕانەوە"
          onBack={() => navigate("/app")}
        />

        <section className="grid gap-4 min-[1500px]:grid-cols-3">
          <article className="app-panel">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-300/20 bg-sky-400/10 text-sky-200">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-display text-xl font-bold text-white">هەڵبژاردنی خواردن</h2>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              کڕیار دەتوانێت بە فلتەر و گەڕان، خواردنە گونجاوەکان بدۆزێتەوە و لەگەڵ نرخ و وێنە و وردەکاریەکانیان هەڵیبژێرێت.
            </p>
          </article>

          <article className="app-panel">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-amber-100">
              <ClipboardList className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-display text-xl font-bold text-white">بەڕێوەبردنی ئۆڵدەر</h2>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              دوای ناردنی داواکاری، کڕیار دەتوانێت لە بەشی هەموو ئۆردەرەکانم هەموو زانیارییەکان و مێژووی ئۆڵدەرەکان ببینێت.
            </p>
          </article>

          <article className="app-panel">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-300/20 bg-rose-400/10 text-rose-100">
              <Bell className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-display text-xl font-bold text-white">ئاگەدارکردنەوەی دۆخ</h2>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              لە کاتی گۆڕانی دۆخی داواکاری، سیستەمەکە ئاگەدارکردنەوە نیشان دەدات تا کڕیار بزانێت ئۆڵدەرەکەی لە چ هەنگاوێکدایە.
            </p>
          </article>
        </section>

        <section className="app-panel">
          <h2 className="font-display text-xl font-bold text-white sm:text-2xl">ئامانجی ئەم سیستەمە</h2>
          <p className="mt-3 text-sm leading-8 text-slate-300">
            ئامانجی سەرەکی ئەم پلاتفۆڕمە ئەوەیە کە پەیوەندی نێوان کڕیار و تیمی بەڕێوەبردن بە شێوەیەکی خێرا، ڕێکخراو و متمانەپێکراو بەڕێوە ببرێت. هەر بەکارهێنەرێک دەتوانێت بە بێ ئالۆزی، داواکاریەکەی تۆمار بکات و دواتریش بە شێوەی ڕاستەوخۆ دۆخی ئەو داواکارییە ببینێت.
          </p>
          <p className="mt-4 text-sm leading-8 text-slate-300">
            بۆ زانیاری زیاتر، کلیک لە دوگمەی خوارەوە بکە و پەیجی تایبەتی وردەکاریەکان بکەرەوە.
          </p>
          <a
            href="https://98ramyar.netlify.app/"
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 px-5 py-3 text-sm font-bold text-slate-950 transition hover:brightness-110"
          >
            <Info className="h-4 w-4" />
            زانیاری زیاتر
          </a>
        </section>
      </div>
    </div>
  );
};

export const CustomerAboutMorePage = () => {
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <div className="app-stage space-y-4 sm:space-y-6">
        <CustomerPageHeader
          eyebrow="زانیاری زیاتر"
          title="ڕێنمایی تەواو بۆ کڕیار"
          description="ئەمانە بنەمای کارکردنی باشترن بۆ ئەوەی کاتێک لە مۆبایل یان لاپتۆپ داواکاری دەنێریت، هەموو هەنگاوەکانت ڕوون و ڕێکخراو بن."
          backLabel="گەڕانەوە بۆ دەربارە"
          onBack={() => navigate("/app/about")}
        />

        <section className="app-panel">
          <h2 className="font-display text-xl font-bold text-white">چۆن بە باشترین شێوە بەکاریبهێنم؟</h2>
          <div className="mt-4 space-y-4 text-sm leading-8 text-slate-300">
            <p>1. خواردنەکان بە پێی پۆل یان بە گەڕان بدۆزەرەوە و ئەوەی دڵت دەوێت زیادبکە بۆ سەبەتە.</p>
            <p>2. لە کاتی ناردنی داواکاری، زانیارییە بنەڕەتییەکان و ناونیشانی ورد بە دروستی پڕ بکەرەوە تا گەیاندن و خزمەتگوزاری باشتر بێت.</p>
            <p>3. دوای ناردن، لە ئاگەدارکردنەوە و هەموو ئۆردەرەکانم دۆخی داواکارییەکەت بەردەوام ببینە.</p>
            <p>4. ئەگەر ئۆڵدەرەکە لە چاوەڕوانیدابێت، پێش هەنگاوی ئامادەکردن دەتوانیت بڕیاری گۆڕانکارییەکانی خۆت بدەیت.</p>
          </div>
        </section>

        <section className="grid gap-4 min-[1500px]:grid-cols-2">
          <article className="app-panel">
            <h2 className="font-display text-xl font-bold text-white">باشترکردنی دۆخی داواکاری</h2>
            <p className="mt-3 text-sm leading-8 text-slate-300">
              بەکارهێنانی ناونیشانی ورد، ژمارەی مۆبایلی دروست، و هەڵبژاردنی شوێنی گونجاو وا دەکات تیمی بەڕێوەبردن بتوانێت داواکارییەکەت بە خێرایی و بە وردی مامەڵە لەگەڵدا بکات.
            </p>
          </article>

          <article className="app-panel">
            <h2 className="font-display text-xl font-bold text-white">پەیوەندی و ڕوونکاری</h2>
            <p className="mt-3 text-sm leading-8 text-slate-300">
              ئەگەر دەبینیت دۆخی داواکارییەکەت گۆڕاوە، ئەوە بە واتای ئەوەیە تیمی ئادمێن هەنگاوێکی نوێ بۆ ئەو ئۆڵدەرە هەڵگرتووە. بەم شێوەیە، کڕیار بەردەوام لە جۆری خزمەتگوزارییەکە ئاگادار دەبێت.
            </p>
          </article>
        </section>
      </div>
    </div>
  );
};
