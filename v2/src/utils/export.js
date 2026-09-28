import * as XLSX from "xlsx";

// خروجی اکسل از آرایه‌ای از آبجکت‌ها
export function exportToExcel(data, sheetName, fileName) {
  if (!data || data.length === 0) {
    alert("داده‌ای برای خروجی وجود ندارد.");
    return;
  }
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = Object.keys(data[0]).map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

// چاپ جدول/بخش مشخص با استایل فارسی
export function printSection(elementId, title) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="fa"><head><meta charset="utf-8">
    <title>${title}</title>
    <style>
      @font-face { font-family: Vazirmatn; src: url("${location.origin}/src/assets/fonts/Vazirmatn-Regular.ttf"); }
      body { font-family: Vazirmatn, Tahoma, sans-serif; padding: 20px; color: #1e293b; }
      h2 { border-bottom: 2px solid #0284c7; padding-bottom: 8px; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: right; }
      th { background: #e0f2fe; }
      button, select { display: none; }
      .print-header { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 11px; color: #64748b; }
    </style></head><body>
    <div class="print-header"><span>سامانه مدیریت تعمیر و نگهداری (CMMS)</span><span>${new Date().toLocaleDateString("fa-IR")}</span></div>
    <h2>${title}</h2>
    ${el.innerHTML}
    <script>window.onload = () => window.print();</scr` + `ipt></body></html>`);
  win.document.close();
}
