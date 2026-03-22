import ExcelJS from "exceljs";
import type { OrderDto } from "@ros/shared";
export declare const buildOrdersWorkbook: (orders: OrderDto[]) => Promise<ExcelJS.Buffer>;
export declare const buildOrdersPdf: (orders: OrderDto[]) => Promise<Buffer<ArrayBufferLike>>;
