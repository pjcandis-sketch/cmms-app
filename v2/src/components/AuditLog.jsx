import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exportToExcel, printSection } from "../utils/export.js";

const actionColor = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-rose-100 text-rose-700",
  login: "bg-slate-100 text-slate-600",
  logout: "bg-slate-100 text-slate-600",
  request_approval: "bg-amber-100 text-amber-700",
  decide_approval: "bg-violet-100 text-violet-700",
};
const actionFa = {
  create: "ایجاد", update: "ویرایش", delete: "حذف", login: "ورود", logout: "خروج",
  request_approval: "درخواست تأیید", decide_approval: "تصمیم تأیید",
};

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  useEffect(() => { invoke("get_audit_log").then(setRows).catch((e) => alert(e)); }, []);

  return (
    <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-bold text-lg text-slate-800">📝 گزارش فعالیت ({rows.length} رکورد اخیر)</h2>
        <div className="flex gap-2">
          <button onClick={() => exportToExcel(rows, "فعالیت", "audit-log")}
            className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600 transition">📊 اکسل</button>
          <button onClick={() => printSection("audit-table", "گزارش فعالیت کاربران")}
            className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">🖨️ چاپ</button>
        </div>
      </div>
      <div id="audit-table" className="overflow-x-auto max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white"><tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
            <th className="p-2.5">کاربر</th><th className="p-2.5">عملیات</th><th className="p-2.5">بخش</th>
            <th className="p-2.5">جزئیات</th><th className="p-2.5">زمان</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="p-2.5 font-medium">{r.username}</td>
                <td className="p-2.5"><span className={`px-2 py-1 rounded-full text-xs font-medium ${actionColor[r.action] || "bg-slate-100"}`}>{actionFa[r.action] || r.action}</span></td>
                <td className="p-2.5 text-slate-500 text-xs">{r.entity_type}{r.entity_id > 0 ? ` #${r.entity_id}` : ""}</td>
                <td className="p-2.5 text-slate-600 max-w-72 truncate">{r.details || "—"}</td>
                <td className="p-2.5 text-slate-400 text-xs font-mono">{r.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
