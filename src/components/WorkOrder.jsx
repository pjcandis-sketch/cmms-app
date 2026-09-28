import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

const STATUS = ["باز", "در حال انجام", "تکمیل شده"];

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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="font-bold text-lg mb-3">ثبت سفارش تعمیر</h2>
        <p className="text-sm text-slate-500 mb-2">دستگاه: {machine ? `${machine.name} (${machine.code})` : "—"}</p>
        <textarea className="w-full border rounded-lg p-2 mb-2" rows="3" placeholder="شرح خرابی / تعمیر..."
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <select className="w-full border rounded-lg p-2 mb-2" value={form.priority}
          onChange={(e) => setForm({ ...form, priority: e.target.value })}>
          <option>پایین</option><option>متوسط</option><option>بالا</option><option>اورژانسی</option>
        </select>
        <input className="w-full border rounded-lg p-2 mb-2" placeholder="تکنسین مسئول"
          value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} />
        <button onClick={create} className="bg-blue-600 text-white px-4 py-2 rounded-lg w-full">ثبت</button>
      </div>

      <div className="lg:col-span-2 bg-white rounded-xl shadow p-4">
        <h2 className="font-bold text-lg mb-3">کارتابل ({orders.length})</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-right">
            <th className="p-2">شماره</th><th className="p-2">دستگاه</th><th className="p-2">شرح</th><th className="p-2">اولویت</th><th className="p-2">وضعیت</th>
          </tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b hover:bg-slate-50">
                <td className="p-2 font-mono">{o.wo_number}</td>
                <td className="p-2">{o.machine_name}</td>
                <td className="p-2 max-w-48 truncate">{o.description}</td>
                <td className="p-2">{o.priority}</td>
                <td className="p-2">
                  <select value={o.status} onChange={(e) => setStatus(o.id, e.target.value)}
                    className="border rounded p-1 text-xs">
                    {STATUS.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
