import ExcelJS from "exceljs";
import {
  OPERATOR_EXCEL_MAX_BYTES,
  OPERATOR_EXCEL_MAX_ROWS,
} from "@/constants";

export async function buildExcelWorkbook(
  sheets: { name: string; rows: string[][] }[],
): Promise<Buffer> {
  const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
  if (totalRows > OPERATOR_EXCEL_MAX_ROWS) {
    throw new Error("Excel exceeds 10000 rows");
  }

  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    for (const row of sheet.rows) {
      worksheet.addRow(row);
    }
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  if (buffer.byteLength > OPERATOR_EXCEL_MAX_BYTES) {
    throw new Error("Excel exceeds 5MB");
  }

  return buffer;
}
