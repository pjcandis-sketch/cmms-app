import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hasPerm } from "../utils/permissions.js";

const statusColor = {
  "در انتظار": "bg-amber-100 text-amber-700",
  "تأیید شده": "bg-emerald-100 text-emerald-700",
  "رد شده": "bg-rose-100 text-rose-700",
};

export default function Approvals({ user }) {
  const [items, setItems] = useState([]);
  const canDecide = hasPerm(user, "approvals.decide");

  const load = async () => setItems(await invoke("get_approvals"));
  useEffect(() => { load(); }, []);

  const decide = async (id, approve) => {
    const note = prompt(approve ? "یادداشت تأیید (اختیاری):" : "دلیل رد (اختیاری):") || "";
    try { alert(await invoke("decide_approval", { id, approve, note })); load(); }
    catch (e) { alert(e); }
  };

  return (
    <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
      <h2 className="font-bold text-lg mb-4 text-slate-800">🔐 کارتابل تأییدها ({items.filter((i) => i.status === "در انتظار").length} در انتظار)</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
            <th className="p-2.5">عملیات</th><th className="p-2.5">مورد</th><th className="p-2.5">درخواست‌کننده</th>
            <th className="p-2.5">تاریخ</th><th className="p-2.5">وضعیت</th><th className="p-2.5">بررسی‌کننده</th><th className="p-2.5"></th>
          </tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-slate-50 hover:bg-violet-50/40">
                <td className="p-2.5"><span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full">{a.action}</span></td>
                <td className="p-2.5 font-medium">{a.entity_label || `${a.entity_type} #${a.entity_id}`}</td>
                <td className="p-2.5 text-slate-500 text-xs">{a.requested_by}</td>
                <td className="p-2.5 text-slate-400 text-xs font-mono">{a.created_at}</td>
                <td className="p-2.5"><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColor[a.status]}`}>{a.status}</span></td>
                <td className="p-2.5 text-xs text-slate-500">{a.decided_by ? `${a.decided_by} ${a.note ? "(" + a.note + ")" : ""}` : "—"}</td>
                <td className="p-2.5">
                  {a.status === "در انتظار" && canDecide && (
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => decide(a.id, true)} className="bg-emerald-500 text-white px-3 py-1 rounded-lg hover:bg-emerald-600">تأیید</button>
                      <button onClick={() => decide(a.id, false)} className="bg-rose-500 text-white px-3 py-1 rounded-lg hover:bg-rose-600">رد</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-slate-400">درخواستی وجود ندارد.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
