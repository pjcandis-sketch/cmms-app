import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exportToExcel, printSection } from "../utils/export.js";
import { hasPerm } from "../utils/permissions.js";

const METHODS = ["5 Why", "ماهی استخوانی", "تحلیل درخت خطا (FTA)", "شش کلاه تفکر"];
const STATUS_CLS = { "باز": "bg-rose-100 text-rose-700", "در حال بررسی": "bg-amber-100 text-amber-700", "بسته شده": "bg-emerald-100 text-emerald-700" };
const EMPTY = { id: null, work_order_id: null, title: "", failure_mode: "", failure_cause: "", consequence: "", method: "5 Why", status: "باز" };

export default function RCA({ user }) {
  const [rcas, setRcas] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [whys, setWhys] = useState([]);
  const [actions, setActions] = useState([]);
  const [newAction, setNewAction] = useState({ description: "", responsible: "", due_date: "" });
  const canWrite = hasPerm(user, "workorders.write");

  const load = async () => { setRcas(await invoke("get_rcas")); setOrders(await invoke("get_work_orders")); };
  useEffect(() => { load(); }, []);

  const openDetail = async (r) => {
    setForm({ id: r.id, work_order_id: r.work_order_id, title: r.title, failure_mode: r.failure_mode,
      failure_cause: r.failure_cause, consequence: r.consequence, method: r.method, status: r.status });
    const [w, a] = await invoke("get_rca_detail", { rcaId: r.id });
    setWhys(w); setActions(a);
  };

  const save = async () => {
    try {
      const id = await invoke("save_rca", { rca: form });
      setForm({ ...form, id });
      load();
      alert("✅ ذخیره شد");
    } catch (e) { alert(e); }
  };

  const saveWhy = async (step, answer) => {
    if (!form.id) return alert("ابتدا تحلیل را ذخیره کنید.");
    await invoke("save_rca_why", { rcaId: form.id, step, answer });
    const [w] = await invoke("get_rca_detail", { rcaId: form.id });
    setWhys(w);
  };

  const F = "w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* فرم RCA */}
      <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white h-fit">
        <h2 className="font-bold text-lg mb-4 text-slate-800">{form.id ? "🔬 ویرایش تحلیل" : "🔬 تحلیل جدید علت ریشه‌ای"}</h2>
        <input className={`${F} mb-2`} placeholder="عنوان تحلیل * (مثل شکست مکرر کوپلینگ پمپ P-101)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <select className={`${F} mb-2`} value={form.work_order_id ?? ""} onChange={(e) => setForm({ ...form, work_order_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">مرتبط با دستورکار... (اختیاری)</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.wo_number} - {o.machine_name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input className={F} placeholder="حالت خرابی (Failure Mode)" value={form.failure_mode} onChange={(e) => setForm({ ...form, failure_mode: e.target.value })} />
          <select className={F} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <textarea className={`${F} mb-2`} rows="2" placeholder="علت خرابی (Failure Cause)..." value={form.failure_cause} onChange={(e) => setForm({ ...form, failure_cause: e.target.value })} />
        <textarea className={`${F} mb-2`} rows="2" placeholder="پیامد (Consequence) — توقف تولید، ایمنی، هزینه..." value={form.consequence} onChange={(e) => setForm({ ...form, consequence: e.target.value })} />
        <select className={`${F} mb-3`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          {["باز", "در حال بررسی", "بسته شده"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="flex gap-2">
          <button onClick={save} disabled={!canWrite} className="flex-1 bg-gradient-to-l from-cyan-500 to-blue-600 text-white py-2.5 rounded-xl font-medium shadow disabled:opacity-40">{form.id ? "ذخیره تغییرات" : "ایجاد تحلیل"}</button>
          {form.id && <button onClick={() => { setForm(EMPTY); setWhys([]); setActions([]); }} className="bg-slate-100 px-4 rounded-xl text-slate-600">جدید</button>}
        </div>

        {/* 5 Whys */}
        {form.id && form.method === "5 Why" && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <h3 className="text-sm font-bold text-slate-700 mb-3">❓ 5 چرا</h3>
            {[1, 2, 3, 4, 5].map((s) => {
              const w = whys.find((x) => x.step === s);
              return (
                <div key={s} className="flex gap-2 mb-2 items-center">
                  <span className="w-7 h-7 rounded-full bg-gradient-to-l from-cyan-500 to-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0">{s}</span>
                  <input className={F} placeholder={`چرا ${s}؟`}
                    defaultValue={w?.answer || ""}
                    onBlur={(e) => { if ((w?.answer || "") !== e.target.value) saveWhy(s, e.target.value); }} />
                </div>
              );
            })}
          </div>
        )}

        {/* اقدامات اصلاحی CAPA */}
        {form.id && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <h3 className="text-sm font-bold text-slate-700 mb-2">🛠️ اقدامات اصلاحی / پیشگیرانه (CAPA)</h3>
            <input className={`${F} mb-2`} placeholder="شرح اقدام..." value={newAction.description} onChange={(e) => setNewAction({ ...newAction, description: e.target.value })} />
            <div className="flex gap-2 mb-2">
              <input className={F} placeholder="مسئول" value={newAction.responsible} onChange={(e) => setNewAction({ ...newAction, responsible: e.target.value })} />
              <input className={F} type="date" value={newAction.due_date} onChange={(e) => setNewAction({ ...newAction, due_date: e.target.value })} />
            </div>
            <button onClick={async () => {
              if (!newAction.description.trim()) return;
              await invoke("add_rca_action", { rcaId: form.id, description: newAction.description, responsible: newAction.responsible, dueDate: newAction.due_date });
              setNewAction({ description: "", responsible: "", due_date: "" });
              const [, a] = await invoke("get_rca_detail", { rcaId: form.id });
              setActions(a);
            }} disabled={!canWrite} className="text-xs bg-indigo-500 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-600 disabled:opacity-40">+ افزودن اقدام</button>
            <ul className="mt-2 space-y-1.5">
              {actions.map((a) => (
                <li key={a.id} className="bg-slate-50 rounded-lg p-2 text-xs">
                  <div className="flex justify-between items-start">
                    <span className="font-medium">{a.description}</span>
                    <button onClick={async () => { await invoke("remove_rca_action", { id: a.id }); const [, ac] = await invoke("get_rca_detail", { rcaId: form.id }); setActions(ac); }}
                      className="text-rose-400 hover:text-rose-600">✕</button>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-slate-400">{a.responsible} · سررسید: {a.due_date || "—"}</span>
                    <select value={a.status} disabled={!canWrite}
                      onChange={async (e) => { await invoke("set_rca_action_status", { id: a.id, status: e.target.value }); const [, ac] = await invoke("get_rca_detail", { rcaId: form.id }); setActions(ac); }}
                      className={`text-[10px] rounded-full px-2 py-0.5 border-0 ${a.status === "انجام شده" ? "bg-emerald-100 text-emerald-700" : a.status === "در حال انجام" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-600"}`}>
                      {["باز", "در حال انجام", "انجام شده"].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* لیست RCA */}
      <div className="lg:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-lg text-slate-800">تحلیل‌های علت ریشه‌ای ({rcas.length})</h2>
          <div className="flex gap-2 no-print">
            <button onClick={() => exportToExcel(rcas, "RCA", "rca")}
              className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600">📊 اکسل</button>
            <button onClick={() => printSection("rca-table", "گزارش تحلیل علت ریشه‌ای")}
              className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800">🖨️ چاپ</button>
          </div>
        </div>
        <div id="rca-table" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
              <th className="p-2">عنوان</th><th className="p-2">تجهیز</th><th className="p-2">روش</th>
              <th className="p-2">حالت خرابی</th><th className="p-2">وضعیت</th><th className="p-2"></th>
            </tr></thead>
            <tbody>
              {rcas.map((r) => (
                <tr key={r.id} onClick={() => openDetail(r)}
                  className={`border-b border-slate-50 cursor-pointer transition ${form.id === r.id ? "bg-cyan-50" : "hover:bg-slate-50"}`}>
                  <td className="p-2 font-medium max-w-56 truncate">{r.title}</td>
                  <td className="p-2 text-xs text-slate-500">{r.machine_name || "—"}</td>
                  <td className="p-2"><span className="bg-indigo-50 text-indigo-600 text-[11px] px-2 py-0.5 rounded-full">{r.method}</span></td>
                  <td className="p-2 text-xs text-slate-500">{r.failure_mode || "—"}</td>
                  <td className="p-2"><span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_CLS[r.status] || "bg-slate-100"}`}>{r.status}</span></td>
                  <td className="p-2"><button onClick={async (e) => { e.stopPropagation(); if (confirm("حذف این تحلیل؟")) { await invoke("delete_rca", { id: r.id }); setForm(EMPTY); load(); } }}
                    className="text-rose-400 hover:text-rose-600 text-xs">حذف</button></td>
                </tr>
              ))}
              {rcas.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-slate-400">تحلیلی ثبت نشده است.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
