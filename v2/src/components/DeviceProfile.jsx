import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exportToExcel, printSection } from "../utils/export.js";

const EMPTY = {
  code: "", name: "", model: "", serial_number: "",
  manufacturer: "", manufacturer_phone: "", manufacturer_email: "", manufacturer_website: "",
  purchase_date: "", warranty_months: "", location: "", description: "",
};

const warrantyColor = { "معتبر": "bg-emerald-100 text-emerald-700", "منقضی": "bg-rose-100 text-rose-700", "نامشخص": "bg-slate-100 text-slate-500" };

export default function DeviceProfile({ selected, onSelect }) {
  const [machines, setMachines] = useState([]);
  const [form, setForm] = useState(EMPTY);

  const load = async () => setMachines(await invoke("get_machines"));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (selected) setForm({ ...EMPTY, ...selected }); }, [selected]);

  const save = async () => { await invoke("save_machine", { machine: form }); setForm(EMPTY); load(); };
  const del = async (id) => { if (confirm("این دستگاه حذف شود؟")) { await invoke("delete_machine", { id }); load(); } };

  const F = "w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 mb-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-transparent transition";
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* فرم */}
      <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl shadow-slate-900/10 p-6 border border-white">
        <h2 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2">
          <span className="w-1.5 h-6 rounded-full bg-gradient-to-b from-cyan-400 to-blue-600 inline-block"></span>
          مشخصات دستگاه
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <input className={F} placeholder="کد دستگاه *" value={form.code} onChange={set("code")} />
          <input className={F} placeholder="نام دستگاه *" value={form.name} onChange={set("name")} />
          <input className={F} placeholder="مدل" value={form.model} onChange={set("model")} />
          <input className={F} placeholder="شماره سریال" value={form.serial_number} onChange={set("serial_number")} />
          <input className={F} placeholder="سازنده" value={form.manufacturer} onChange={set("manufacturer")} />
          <input className={F} placeholder="تلفن سازنده" value={form.manufacturer_phone} onChange={set("manufacturer_phone")} />
          <input className={F} placeholder="ایمیل سازنده" value={form.manufacturer_email} onChange={set("manufacturer_email")} />
          <input className={F} placeholder="وب‌سایت سازنده" value={form.manufacturer_website} onChange={set("manufacturer_website")} />
          <label className="text-[11px] text-slate-500 -mb-1 col-span-2">تاریخ خرید</label>
          <input className={F} type="date" value={form.purchase_date} onChange={set("purchase_date")} />
          <input className={F} type="number" placeholder="مدت گارانتی (ماه)" value={form.warranty_months} onChange={set("warranty_months")} />
          <input className={F} placeholder="محل نصب" value={form.location} onChange={set("location")} />
        </div>
        <textarea className={F} rows="2" placeholder="توضیحات" value={form.description} onChange={set("description")} />
        <div className="flex gap-2 no-print">
          <button onClick={save} className="flex-1 bg-gradient-to-l from-cyan-500 to-blue-600 text-white px-4 py-2.5 rounded-xl font-medium shadow-lg shadow-cyan-500/30 hover:opacity-90 transition">ذخیره</button>
          <button onClick={() => setForm(EMPTY)} className="bg-slate-100 px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-200 transition">جدید</button>
        </div>
      </div>

      {/* لیست */}
      <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl shadow-slate-900/10 p-6 border border-white">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-lg text-slate-800">دستگاه‌ها ({machines.length})</h2>
          <div className="flex gap-2 no-print">
            <button onClick={() => exportToExcel(machines, "دستگاه‌ها", "devices")}
              className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600 transition">📊 اکسل</button>
            <button onClick={() => printSection("devices-table", "لیست دستگاه‌ها")}
              className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">🖨️ چاپ</button>
          </div>
        </div>
        <div id="devices-table" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
                <th className="p-2.5">کد</th><th className="p-2.5">نام</th><th className="p-2.5">سازنده</th><th className="p-2.5">گارانتی</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.id} className="border-b border-slate-50 hover:bg-cyan-50/50 transition">
                  <td className="p-2.5 font-mono text-cyan-700 font-semibold">{m.code}</td>
                  <td className="p-2.5 font-medium">{m.name}</td>
                  <td className="p-2.5 text-slate-500">{m.manufacturer || "—"}</td>
                  <td className="p-2.5">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${warrantyColor[m.warranty_status] || warrantyColor["نامشخص"]}`}>{m.warranty_status}</span>
                  </td>
                  <td className="p-2 no-print">
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => onSelect(m)} className="text-blue-600 hover:underline">انتخاب</button>
                      <button onClick={() => del(m.id)} className="text-rose-500 hover:underline">حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
