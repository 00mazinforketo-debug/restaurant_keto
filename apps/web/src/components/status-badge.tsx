import { useTranslation } from "react-i18next";
import type { OrderStatus } from "@ros/shared";
import { cn, statusToneMap } from "../lib/utils";

export const StatusBadge = ({ status }: { status: OrderStatus }) => {
  const { t } = useTranslation();
  return <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-[0.16em] sm:px-3 sm:text-xs sm:tracking-[0.2em]", statusToneMap[status])}>{t(`status.${status}`)}</span>;
};
