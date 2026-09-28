import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

const TYPES = [
  { id: "daily", label: "روزانه" },
  { id: "weekly", label: "هفتگی" },
  { id: "monthly", label: "ماهانه" },
];

export default function Checklist({ machine }) {
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
    await invoke("add_checklist_item", { machineId: machine.id, checkType: type, description: newItem });
    setNewItem("");
    load();
  };

  const removeItem = async (id) => { await invoke("remove_checklist_item", { id }); load(); };

  if (!machine) return <p className="text-slate-500">ابتدا از بخش «پروفایل دستگاه‌ها» یک دستگاه انتخاب کنید.</p>;

  return (
    <div className="bg-white rounded-xl shadow p-4 max-w-2xl">
      <h2 className="font-bold text-lg mb-1">چک‌لیست {machine.name} <span className="font-mono text-sm">({machine.code})</span></h2>

      <div className="flex gap-2 my-3">
        {TYPES.map((t) => (
          <button key={t.id} onClick={() => setType(t.id)}
            className={`px-4 py-1 rounded-full ${type === t.id ? "bg-slate-800 text-white" : "bg-slate-100"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-3">
        <input className="flex-1 border rounded-lg p-2" placeholder="آیتم جدید چک‌لیست..."
          value={newItem} onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()} />
        <button onClick={addItem} className="bg-blue-600 text-white px-4 rounded-lg">افزودن</button>
      </div>

      <ul>
        {items.map((it, i) => (
          <li key={it.id} className="flex justify-between items-center border-b p-2">
            <span>{i + 1}. {it.description}</span>
            <button onClick={() => removeItem(it.id)} className="text-red-600 text-sm">حذف</button>
          </li>
        ))}
        {items.length === 0 && <li className="text-slate-400 p-2">آیتمی ثبت نشده است.</li>}
      </ul>
    </div>
  );
}
