import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exportToExcel, printSection } from "../utils/export.js";
import { hasPerm } from "../utils/permissions.js";

const WO_TYPES = ["برنامه‌ریزی‌شده", "پیشگیرانه", "اضطراری", "بازرسی", "بهبود"];
const FAILURE_MODES = ["مکانیکی", "الکتریکی", "ابزاردقیق", "نرم‌افزاری", "اپراتوری", "فرسودگی", "نامشخص"];
const PRIORITIES = ["پایین", "متوسط", "بالا", "اورژانسی"];
const STATUS_FLOW = {
  "درخواست": "bg-sky-100 text-sky-700",
  "تأیید شده": "bg-indigo-100 text-indigo-700",
  "در حال انجام": "bg-amber-100 text-amber-700",
  "تکمیل شده": "bg-emerald-100 text-emerald-700",
  "بسته شده": "bg-slate-200 text-slate-600",
  "لغو شده": "bg-rose-100 text-rose-500 line-through",
};
// گذارهای مجاز چرخه حیات (منبع واحد: نسخه Rust در main.rs باید هم‌خوان بماند)
const FLOW = {
  "درخواست": ["تأیید شده", "لغو شده"],
  "تأیید شده": ["در حال انجام", "لغو شده"],
  "در حال انجام": ["تکمیل شده", "لغو شده"],
  "تکمیل شده": ["بسته شده", "در حال انجام"],
};
const NEXT_LABEL = {
  "تأیید شده": "✔ تأیید دستورکار",
  "در حال انجام": "▶ شروع کار",
  "تکمیل شده": "✅ تکمیل",
  "بسته شده": "🔒 بستن پرونده",
  "لغو شده": "✖ لغو",
};

export default function WorkOrder({ user, machine }) {
  const [orders, setOrders] = useState([]);
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState([]);
  const [fieldHist, setFieldHist] = useState([]);
  const [parts, setParts] = useState([]);
  const [woParts, setWoParts] = useState([]);
  const [newPart, setNewPart] = useState({ code: "", name: "", unit: "عدد" });
  const [usage, setUsage] = useState({ part_id: "", quantity: 1, unit_price: 0 });
  const [form, setForm] = useState({
    description: "", priority: "متوسط", assigned_to: "",
    wo_type: WO_TYPES[0], failure_mode: FAILURE_MODES[6],
    cause: "", action_taken: "", start_date: "", end_date: "", labor_hours: 0, cost: 0,
  });

  const canWrite = hasPerm(user, "workorders.write");
  const load = async () => setOrders(await invoke("get_work_orders"));
  useEffect(() => { load(); }, []);

  const openDetail = async (o) => {
    setDetail(o);
    setForm({ ...form, description: o.description, priority: o.priority, assigned_to: o.assigned_to,
      wo_type: o.wo_type, failure_mode: o.failure_mode, cause: o.cause, action_taken: o.action_taken,
      start_date: o.start_date, end_date: o.end_date, labor_hours: o.labor_hours, cost: o.cost });
    setHistory(await invoke("get_work_order_history", { woId: o.id }));
    setFieldHist(await invoke("get_field_history", { entityType: "work_order", entityId: o.id }));
    setWoParts(await invoke("get_work_order_parts", { woId: o.id }));
    setParts(await invoke("get_parts"));
  };

  const create = async () => {
    if (!machine) return alert("ابتدا از بخش دارایی‌ها یک تجهیز انتخاب کنید");
    if (!form.description.trim()) return alert("شرح خرابی را بنویسید.");
    try {
      await invoke("create_work_order", { machineId: machine.id, order: form });
      setForm({ ...form, description: "" });
      load();
    } catch (e) { alert("خطا در ثبت: " + e); }
  };

  const transition = async (to) => {
    const note = prompt(`یادداشت برای گذار به «${to}» (اختیاری):`) || "";
    try {
      await invoke("set_work_order_status", { id: detail.id, status: to, note });
      await openDetail({ ...detail, status: to });
      load();
    } catch (e) { alert(e); }
  };

  const saveDetail = async () => {
    try {
      await invoke("update_work_order", { id: detail.id, order: form });
      await openDetail(detail);
      load();
      alert("✅ ذخیره شد");
    } catch (e) { alert(e); }
  };

  const addPart = async () => {
    if (!newPart.code.trim() || !newPart.name.trim()) return;
    try {
      await invoke("save_part", { part: { ...newPart, id: null } });
      setParts(await invoke("get_parts"));
      setNewPart({ code: "", name: "", unit: "عدد" });
    } catch (e) { alert(e); }
  };

  const addUsage = async () => {
    if (!usage.part_id) return alert("قطعه را انتخاب کنید");
    try {
      await invoke("add_work_order_part", { woId: detail.id, partId: Number(usage.part_id),
        quantity: Number(usage.quantity), unitPrice: Number(usage.unit_price) });
      setWoParts(await invoke("get_work_order_parts", { woId: detail.id }));
    } catch (e) { alert(e); }
  };

  const F = "w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* ثبت دستورکار */}
      <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white h-fit">
        <h2 className="font-bold text-lg mb-3 text-slate-800 flex items-center gap-2">
          <span className="w-1.5 h-6 rounded-full bg-gradient-to-b from-rose-400 to-orange-500 inline-block"></span>
          ثبت دستورکار جدید
        </h2>
        <p className="text-sm text-slate-500 mb-3">
          تجهیز: {machine ? <span className="font-semibold text-cyan-700">{machine.name} ({machine.code})</span> : <span className="text-rose-400">— انتخاب نشده</span>}
        </p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <select className={F} value={form.wo_type} onChange={(e) => setForm({ ...form, wo_type: e.target.value })}>
            {WO_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select className={F} value={form.failure_mode} onChange={(e) => setForm({ ...form, failure_mode: e.target.value })}>
            {FAILURE_MODES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <textarea className={`${F} mb-2`} rows="2" placeholder="شرح خرابی / درخواست..."
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-2 mb-2">
          <select className={F} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {PRIORITIES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <input className={F} placeholder="تکنسین مسئول" value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} />
        </div>
        {form.priority === "اورژانسی" && (
          <p className="text-[11px] bg-rose-50 text-rose-600 rounded-lg p-2 mb-2">⚠️ دستورکار اورژانسی پس از ثبت، نیازمند تأیید مدیر است.</p>
        )}
        <button onClick={create} disabled={!canWrite}
          className="w-full bg-gradient-to-l from-rose-500 to-orange-500 text-white px-4 py-2.5 rounded-xl font-medium shadow-lg shadow-rose-500/30 hover:opacity-90 transition disabled:opacity-40">
          {canWrite ? "ثبت دستورکار" : "بدون دسترسی"}
        </button>
      </div>

      {/* لیست */}
      <div className="lg:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-lg text-slate-800">کارتابل دستورکارها ({orders.length})</h2>
          <div className="flex gap-2 no-print">
            <button onClick={() => exportToExcel(orders, "دستورکارها", "work-orders")}
              className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600">📊 اکسل</button>
            <button onClick={() => printSection("wo-table", "کارتابل دستورکارهای تعمیر")}
              className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800">🖨️ چاپ</button>
          </div>
        </div>
        <div id="wo-table" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
              <th className="p-2">شماره</th><th className="p-2">تجهیز</th><th className="p-2">نوع</th>
              <th className="p-2">اولویت</th><th className="p-2">وضعیت</th><th className="p-2">تکنسین</th>
            </tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} onClick={() => openDetail(o)}
                  className={`border-b border-slate-50 cursor-pointer transition ${detail?.id === o.id ? "bg-rose-50" : "hover:bg-orange-50/40"}`}>
                  <td className="p-2 font-mono font-semibold text-slate-700">{o.wo_number}</td>
                  <td className="p-2 font-medium">{o.machine_name}</td>
                  <td className="p-2 text-xs text-slate-500">{o.wo_type}</td>
                  <td className={`p-2 text-xs ${o.priority === "اورژانسی" ? "text-rose-600 font-bold" : o.priority === "بالا" ? "text-orange-600" : "text-slate-500"}`}>{o.priority}</td>
                  <td className="p-2"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_FLOW[o.status] || "bg-slate-100"}`}>{o.status}</span></td>
                  <td className="p-2 text-xs text-slate-500">{o.assigned_to || "—"}</td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-slate-400">دستورکاری ثبت نشده است.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* جزئیات دستورکار */}
        {detail && (
          <div className="mt-5 border-t-2 border-slate-100 pt-5">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
              <h3 className="font-bold text-slate-800">
                {detail.wo_number} — {detail.machine_name}
                <span className={`mr-2 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_FLOW[detail.status]}`}>{detail.status}</span>
              </h3>
              <div className="flex gap-2 flex-wrap no-print">
                {["تأیید شده","در حال انجام","تکمیل شده","بسته شده","لغو شده"]
                  .filter((s) => {
                    const cur = orders.find((x) => x.id === detail.id)?.status || detail.status;
                    return (FLOW[cur] || []).includes(s);
                  })
                  .map((s) => (
                    <button key={s} onClick={() => transition(s)} disabled={!canWrite}
                      className="text-xs bg-white border border-slate-200 hover:border-rose-300 hover:text-rose-600 px-3 py-1.5 rounded-lg transition disabled:opacity-40">
                      {NEXT_LABEL[s] || s}
                    </button>
                  ))}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <label className="text-[10px] text-slate-400">علت ریشه‌ای<input className={F} value={form.cause} onChange={(e) => setForm({ ...form, cause: e.target.value })} /></label>
              <label className="text-[10px] text-slate-400">اقدام انجام‌شده<input className={F} value={form.action_taken} onChange={(e) => setForm({ ...form, action_taken: e.target.value })} /></label>
              <label className="text-[10px] text-slate-400">تاریخ شروع<input className={F} type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
              <label className="text-[10px] text-slate-400">تاریخ پایان<input className={F} type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
              <label className="text-[10px] text-slate-400">ساعت کار (نفر-ساعت)<input className={F} type="number" value={form.labor_hours} onChange={(e) => setForm({ ...form, labor_hours: Number(e.target.value) })} /></label>
              <label className="text-[10px] text-slate-400">هزینه (ریال)<input className={F} type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} /></label>
            </div>
            <button onClick={saveDetail} disabled={!canWrite}
              className="text-xs bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-40 no-print">💾 ذخیره اطلاعات تکمیلی</button>

            {/* قطعات مصرفی */}
            <div className="mt-5 bg-slate-50 rounded-2xl p-4">
              <h4 className="font-bold text-sm text-slate-700 mb-3">🔩 قطعات مصرفی</h4>
              <div className="flex gap-2 mb-2 flex-wrap no-print">
                <select className={`${F} !w-52`} value={usage.part_id} onChange={(e) => setUsage({ ...usage, part_id: e.target.value })}>
                  <option value="">انتخاب قطعه...</option>
                  {parts.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                </select>
                <input className={`${F} !w-24`} type="number" placeholder="تعداد" value={usage.quantity} onChange={(e) => setUsage({ ...usage, quantity: e.target.value })} />
                <input className={`${F} !w-32`} type="number" placeholder="قیمت واحد" value={usage.unit_price} onChange={(e) => setUsage({ ...usage, unit_price: e.target.value })} />
                <button onClick={addUsage} disabled={!canWrite} className="bg-indigo-500 text-white px-4 rounded-xl text-xs hover:bg-indigo-600 disabled:opacity-40">+ ثبت مصرف</button>
              </div>
              <div className="flex gap-2 mb-3 flex-wrap no-print">
                <input className={`${F} !w-28`} placeholder="کد قطعه جدید" value={newPart.code} onChange={(e) => setNewPart({ ...newPart, code: e.target.value })} />
                <input className={`${F} !w-40`} placeholder="نام قطعه" value={newPart.name} onChange={(e) => setNewPart({ ...newPart, name: e.target.value })} />
                <input className={`${F} !w-20`} placeholder="واحد" value={newPart.unit} onChange={(e) => setNewPart({ ...newPart, unit: e.target.value })} />
                <button onClick={addPart} disabled={!canWrite} className="bg-slate-200 text-slate-600 px-3 rounded-xl text-xs hover:bg-slate-300 disabled:opacity-40">➕ افزودن به لیست قطعات</button>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-right text-slate-400">
                  <th className="p-1.5">کد</th><th className="p-1.5">نام</th><th className="p-1.5">تعداد</th><th className="p-1.5">قیمت واحد</th><th className="p-1.5">جمع</th><th className="p-1.5"></th>
                </tr></thead>
                <tbody>
                  {woParts.map((p) => (
                    <tr key={p.id} className="border-t border-slate-200">
                      <td className="p-1.5 font-mono">{p.code}</td>
                      <td className="p-1.5">{p.name}</td>
                      <td className="p-1.5">{p.quantity} {p.unit}</td>
                      <td className="p-1.5">{Number(p.unit_price).toLocaleString("fa-IR")}</td>
                      <td className="p-1.5 font-medium">{Number(p.total).toLocaleString("fa-IR")}</td>
                      <td className="p-1.5"><button onClick={async () => { await invoke("remove_work_order_part", { id: p.id }); setWoParts(await invoke("get_work_order_parts", { woId: detail.id })); }}
                        className="text-rose-400 hover:text-rose-600 no-print">✕</button></td>
                    </tr>
                  ))}
                  {woParts.length > 0 && (
                    <tr className="border-t border-slate-300 font-bold">
                      <td colSpan="4" className="p-1.5">جمع کل قطعات</td>
                      <td className="p-1.5">{woParts.reduce((s, p) => s + p.total, 0).toLocaleString("fa-IR")} ریال</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* تاریخچه */}
            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-bold text-sm text-slate-700 mb-2">🕓 چرخه وضعیت</h4>
                <ul className="space-y-2">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-start gap-2 text-xs">
                      <span className="w-2 h-2 rounded-full bg-cyan-500 mt-1 shrink-0"></span>
                      <div>
                        <span className="font-medium">{h.from_status ? `${h.from_status} ← ` : ""}{h.to_status}</span>
                        <span className="text-slate-400"> — {h.changed_by}</span>
                        <span className="block text-slate-400 font-mono">{h.created_at}</span>
                        {h.note && <span className="block text-slate-500">{h.note}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-700 mb-2">📝 تاریخچه فیلدها</h4>
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {fieldHist.map((h) => (
                    <li key={h.id} className="text-xs bg-slate-50 rounded-lg p-2">
                      <span className="font-medium">{h.field_name}:</span>{" "}
                      <span className="text-rose-500 line-through">{h.old_value || "—"}</span> ← <span className="text-emerald-600">{h.new_value || "—"}</span>
                      <span className="block text-slate-400 mt-0.5">{h.changed_by} · {h.created_at}</span>
                    </li>
                  ))}
                  {fieldHist.length === 0 && <li className="text-slate-400 text-xs">تغییری ثبت نشده است.</li>}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
