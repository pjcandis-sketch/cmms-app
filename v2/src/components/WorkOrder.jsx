import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exportToExcel, printSection } from "../utils/export.js";

const STATUS = ["باز", "در حال انجام", "تکمیل شده"];
const statusColor = {
  "باز": "bg-rose-100 text-rose-700",
  "در حال انجام": "bg-amber-100 text-amber-700",
  "تکمیل شده": "bg-emerald-100 text-emerald-700",
};
const priorityColor = {
  "پایین": "text-slate-500", "متوسط": "text-blue-600",
  "بالا": "text-orange-600", "اورژانسی": "text-rose-600 font-bold",
};

export default function WorkOrder({ machine }) {
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ description: "", priority: "متوسط", assigned_to: "" });

  const load = async () => setOrders(await invoke("get_work_orders"));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!machine) return alert("ابتدا دستگاهی انتخاب کنید");
    await invoke("create_work_order", { machineId: machine.id, order: form });
    setForm({ description: "", priority: "متوسط", assigned_to: "" });
    load();
  };
  const setStatus = async (id, status) => { await invoke("set_work_order_status", { id, status }); load(); };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white h-fit">
        <h2 className="font-bold text-lg mb-3 text-slate-800 flex items-center gap-2">
          <span className="w-1.5 h-6 rounded-full bg-gradient-to-b from-rose-400 to-orange-500 inline-block"></span>
          ثبت سفارش تعمیر
        </h2>
        <p className="text-sm text-slate-500 mb-3">
          دستگاه: {machine ? <span className="font-semibold text-cyan-700">{machine.name} ({machine.code})</span> : <span className="text-rose-400">— انتخاب نشده</span>}
        </p>
        <textarea className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-rose-300" rows="3"
          placeholder="شرح خرابی / تعمیر..."
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <select className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-rose-300"
          value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
          <option>پایین</option><option>متوسط</option><option>بالا</option><option>اورژانسی</option>
        </select>
        <input className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-rose-300"
          placeholder="تکنسین مسئول" value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} />
        <button onClick={create} className="w-full bg-gradient-to-l from-rose-500 to-orange-500 text-white px-4 py-2.5 rounded-xl font-medium shadow-lg shadow-rose-500/30 hover:opacity-90 transition">ثبت سفارش</button>
      </div>

      <div className="lg:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-lg text-slate-800">کارتابل ({orders.length})</h2>
          <div className="flex gap-2 no-print">
            <button onClick={() => exportToExcel(orders, "تعمیرات", "work-orders")}
              className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600 transition">📊 اکسل</button>
            <button onClick={() => printSection("wo-table", "کارتابل سفارش‌های تعمیر")}
              className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">🖨️ چاپ</button>
          </div>
        </div>
        <div id="wo-table" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
                <th className="p-2.5">شماره</th><th className="p-2.5">دستگاه</th><th className="p-2.5">شرح</th>
                <th className="p-2.5">اولویت</th><th className="p-2.5">تکنسین</th><th className="p-2.5">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-slate-50 hover:bg-orange-50/40 transition">
                  <td className="p-2.5 font-mono font-semibold text-slate-700">{o.wo_number}</td>
                  <td className="p-2.5 font-medium">{o.machine_name}</td>
                  <td className="p-2.5 max-w-52 truncate text-slate-600">{o.description}</td>
                  <td className={`p-2.5 text-xs ${priorityColor[o.priority] || ""}`}>{o.priority}</td>
                  <td className="p-2.5 text-slate-500 text-xs">{o.assigned_to || "—"}</td>
                  <td className="p-2.5">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColor[o.status] || "bg-slate-100"}`}>{o.status}</span>
                  </td>
                  <td className="p-2 no-print">
                    <select value={o.status} onChange={(e) => setStatus(o.id, e.target.value)}
                      className="border border-slate-200 rounded-lg p-1 text-xs bg-slate-50 focus:outline-none">
                      {STATUS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-slate-400">سفارشی ثبت نشده است.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
