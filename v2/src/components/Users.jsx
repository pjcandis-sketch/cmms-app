import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PERMISSIONS } from "../utils/permissions.js";

const EMPTY_USER = { id: null, username: "", full_name: "", password: "", role_id: 1, is_active: true };
const EMPTY_ROLE = { id: null, name: "", permissions: [] };

export default function Users({ user }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [uForm, setUForm] = useState(EMPTY_USER);
  const [rForm, setRForm] = useState(EMPTY_ROLE);
  const [msg, setMsg] = useState("");

  const load = async () => {
    try { setUsers(await invoke("get_users")); } catch (e) { setMsg(String(e)); }
    setRoles(await invoke("get_roles"));
  };
  useEffect(() => { load(); }, []);

  const act = async (fn) => {
    try { await fn(); setMsg("✅ انجام شد"); load(); }
    catch (e) { setMsg("❌ " + e); }
  };

  const F = "w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 mb-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400";
  const togglePerm = (p) => setRForm({ ...rForm, permissions: rForm.permissions.includes(p) ? rForm.permissions.filter((x) => x !== p) : [...rForm.permissions, p] });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* کاربران */}
      <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
        <h2 className="font-bold text-lg mb-4 text-slate-800">👥 کاربران</h2>
        <div className="grid grid-cols-2 gap-2">
          <input className={F} placeholder="نام کاربری *" value={uForm.username} onChange={(e) => setUForm({ ...uForm, username: e.target.value })} />
          <input className={F} placeholder="نام و نام خانوادگی" value={uForm.full_name} onChange={(e) => setUForm({ ...uForm, full_name: e.target.value })} />
          <input className={F} type="password" placeholder={uForm.id ? "رمز جدید (خالی = بدون تغییر)" : "رمز عبور *"} value={uForm.password} onChange={(e) => setUForm({ ...uForm, password: e.target.value })} />
          <select className={F} value={uForm.role_id} onChange={(e) => setUForm({ ...uForm, role_id: Number(e.target.value) })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 mb-3">
          <input type="checkbox" checked={uForm.is_active} onChange={(e) => setUForm({ ...uForm, is_active: e.target.checked })} />
          کاربر فعال است
        </label>
        <div className="flex gap-2">
          <button onClick={() => act(async () => { await invoke("save_user", { user: uForm }); setUForm(EMPTY_USER); })}
            className="flex-1 bg-gradient-to-l from-cyan-500 to-blue-600 text-white py-2.5 rounded-xl font-medium shadow-lg shadow-cyan-500/30 hover:opacity-90 transition">
            {uForm.id ? "ویرایش کاربر" : "ایجاد کاربر"}
          </button>
          {uForm.id && <button onClick={() => setUForm(EMPTY_USER)} className="bg-slate-100 px-4 rounded-xl text-slate-600">انصراف</button>}
        </div>
        {msg && <p className="text-xs mt-3 text-slate-500">{msg}</p>}

        <table className="w-full text-sm mt-4">
          <thead><tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
            <th className="p-2">کاربر</th><th className="p-2">نقش</th><th className="p-2">وضعیت</th><th className="p-2"></th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-50 hover:bg-cyan-50/50">
                <td className="p-2">
                  <div className="font-medium">{u.full_name || u.username}</div>
                  <div className="text-xs text-slate-400 font-mono">{u.username}</div>
                </td>
                <td className="p-2"><span className="bg-blue-50 text-blue-600 text-xs px-2 py-1 rounded-full">{u.role_name}</span></td>
                <td className="p-2"><span className={`text-xs px-2 py-1 rounded-full ${u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{u.is_active ? "فعال" : "غیرفعال"}</span></td>
                <td className="p-2">
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => setUForm({ id: u.id, username: u.username, full_name: u.full_name, password: "", role_id: u.role_id, is_active: u.is_active })}
                      className="text-blue-600 hover:underline">ویرایش</button>
                    <button onClick={() => act(async () => { alert(await invoke("delete_user", { id: u.id })); })}
                      className="text-rose-500 hover:underline">حذف</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* نقش‌ها */}
      <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
        <h2 className="font-bold text-lg mb-4 text-slate-800">🛡️ نقش‌ها و دسترسی‌ها</h2>
        <input className={F} placeholder="نام نقش *" value={rForm.name} onChange={(e) => setRForm({ ...rForm, name: e.target.value })} />
        <div className="space-y-2 mb-3 bg-slate-50 rounded-xl p-3">
          {PERMISSIONS.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={rForm.permissions.includes(p.id) || rForm.permissions.includes("*")} onChange={() => togglePerm(p.id)} />
              {p.label} <span className="text-[10px] text-slate-400 font-mono">{p.id}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => act(async () => { await invoke("save_role", { role: rForm }); setRForm(EMPTY_ROLE); })}
            className="flex-1 bg-gradient-to-l from-violet-500 to-purple-600 text-white py-2.5 rounded-xl font-medium shadow-lg shadow-violet-500/30 hover:opacity-90 transition">
            {rForm.id ? "ویرایش نقش" : "ایجاد نقش"}
          </button>
          {rForm.id && <button onClick={() => setRForm(EMPTY_ROLE)} className="bg-slate-100 px-4 rounded-xl text-slate-600">انصراف</button>}
        </div>

        <ul className="mt-4 space-y-2">
          {roles.map((r) => (
            <li key={r.id} className="flex justify-between items-center bg-slate-50 border border-slate-100 rounded-xl p-3">
              <div>
                <div className="font-medium text-sm">{r.name}</div>
                <div className="text-[11px] text-slate-400">{r.permissions.includes("*") ? "دسترسی کامل" : r.permissions.length + " دسترسی"}</div>
              </div>
              <button onClick={() => setRForm({ id: r.id, name: r.name, permissions: r.permissions.filter((p) => p !== "*") })}
                className="text-xs text-blue-600 hover:underline">ویرایش</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
