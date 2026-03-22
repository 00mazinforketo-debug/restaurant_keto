import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { OrderDto } from "@ros/shared";

export const buildOrdersWorkbook = async (orders: OrderDto[]) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Orders");

  worksheet.columns = [
    { header: "Order Code", key: "orderCode", width: 18 },
    { header: "Customer", key: "customerNameKu", width: 24 },
    { header: "Phone", key: "customerPhone", width: 18 },
    { header: "Address", key: "customerAddressKu", width: 28 },
    { header: "Status", key: "status", width: 18 },
    { header: "Total", key: "totalPrice", width: 14 },
    { header: "Placed At", key: "placedAt", width: 28 },
    { header: "Notes", key: "notesKu", width: 40 }
  ];

  for (const order of orders) {
    worksheet.addRow({
      orderCode: order.orderCode,
      customerNameKu: order.customerNameKu,
      customerPhone: order.customerPhone,
      customerAddressKu: order.customerAddressKu,
      status: order.status,
      totalPrice: order.totalPrice,
      placedAt: order.placedAt,
      notesKu: order.notesKu ?? ""
    });
  }

  return workbook.xlsx.writeBuffer();
};

export const buildOrdersPdf = async (orders: OrderDto[]) =>
  new Promise<Buffer>((resolve) => {
    const document = new PDFDocument({ margin: 36 });
    const chunks: Buffer[] = [];

    document.on("data", (chunk) => chunks.push(chunk as Buffer));
    document.on("end", () => resolve(Buffer.concat(chunks)));

    document.fontSize(18).text("Restaurant Orders Report");
    document.moveDown();

    orders.forEach((order) => {
      document
        .fontSize(12)
        .text(`${order.orderCode} | ${order.customerNameKu} | ${order.customerPhone} | ${order.status} | ${order.totalPrice}`)
        .text(`Placed: ${order.placedAt}`)
        .text(`Address: ${order.customerAddressKu}`)
        .text(`Items: ${order.items.map((item) => `${item.nameKu} x${item.quantity}`).join(", ")}`)
        .text(`Notes: ${order.notesKu ?? "-"}`)
        .moveDown();
    });

    document.end();
  });
