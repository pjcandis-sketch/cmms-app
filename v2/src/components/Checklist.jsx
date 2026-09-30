import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exportToExcel, printSection } from "../utils/export.js";
import { hasPerm } from "../utils/permissions.js";

const TYPES = [
  { id: "daily", label: "روزانه", color: "from-sky-400 to-blue-500", bg: "bg-blue-500" },
  { id: "weekly", label: "هفتگی", color: "from-violet-400 to-purple-500", bg: "bg-purple-500" },
  { id: "monthly", label: "ماهانه", color: "from-amber-400 to-orange-500", bg: "bg-orange-500" },
];

export default function Checklist({ user, machine }) {
  const [type, setType] = useState("daily");
  const [items, setItems] = useState([]);
  const [newItem, setNewItem] = useState("");

  const load = async () => {
    if (!machine) return;
    setItems(await invoke("get_checklist_items", { machineId: machine.id, checkType: type }));
  };
  useEffect(() => { load(); }, [machine, type]);

  const addItem = async () => {
    if (!newItem.trim()) return;
    try {
      await invoke("add_checklist_item", { machineId: machine.id, checkType: type, description: newItem });
      setNewItem(""); load();
    } catch (e) {
      alert("خطا در افزودن آیتم: " + e);
    }
  };
  const removeItem = async (id) => { await invoke("remove_checklist_item", { id }); load(); };

  if (!machine) return (
    <div className="bg-white/90 rounded-2xl p-10 text-center text-slate-400 shadow-xl max-w-lg mx-auto mt-10">
      <div className="text-5xl mb-3">⚙️</div>ابتدا از بخش «پروفایل دستگاه‌ها» یک دستگاه انتخاب کنید.
    </div>
  );

  const activeType = TYPES.find((t) => t.id === type);

  return (
    <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl shadow-slate-900/10 p-6 border border-white max-w-2xl">
      <div className="flex justify-between items-center mb-1">
        <h2 className="font-bold text-lg text-slate-800">
          چک‌لیست <span className="text-cyan-600">{machine.name}</span> <span className="font-mono text-sm text-slate-400">({machine.code})</span>
        </h2>
        <div className="flex gap-2 no-print">
          <button onClick={() => exportToExcel(items, "چک‌لیست", `checklist-${type}`)}
            className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600 transition">📊 اکسل</button>
          <button onClick={() => printSection("checklist-body", `چک‌لیست ${activeType.label} - ${machine.name}`)}
            className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">🖨️ چاپ</button>
        </div>
      </div>

      <div className="flex gap-2 my-4 no-print">
        {TYPES.map((t) => (
          <button key={t.id} onClick={() => setType(t.id)}
            className={`px-5 py-2 rounded-xl text-sm font-medium transition-all
              ${type === t.id ? `bg-gradient-to-l ${t.color} text-white shadow-lg` : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-4 no-print">
        <input className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
          placeholder="آیتم جدید چک‌لیست..."
          value={newItem} onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()} />
        <button onClick={addItem} disabled={!hasPerm(user, "checklist.write")}
          className="bg-gradient-to-l from-cyan-500 to-blue-600 text-white px-5 rounded-xl font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed">افزودن</button>
      </div>

      <div id="checklist-body">
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={it.id} className="flex justify-between items-center bg-slate-50 hover:bg-cyan-50/60 border border-slate-100 rounded-xl p-3 transition">
              <span className="text-sm"><span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-white text-xs font-bold ml-2 ${activeType.bg}`}>{i + 1}</span>{it.description}</span>
              <button onClick={() => removeItem(it.id)} className="text-rose-400 hover:text-rose-600 text-xs no-print">حذف</button>
            </li>
          ))}
          {items.length === 0 && <li className="text-slate-400 p-4 text-center text-sm">آیتمی ثبت نشده است.</li>}
        </ul>
      </div>
    </div>
  );
}
