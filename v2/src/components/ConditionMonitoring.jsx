import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exportToExcel, printSection } from "../utils/export.js";
import { hasPerm } from "../utils/permissions.js";

const PARAMETERS = [
  { id: "لرزش", unit: "mm/s" }, { id: "دما", unit: "°C" }, { id: "فشار", unit: "bar" },
  { id: "جریان", unit: "A" }, { id: "ولتاژ", unit: "V" }, { id: "صدا", unit: "dB" },
  { id: "کیفیت روغن", unit: "ppm" }, { id: "سایر", unit: "" },
];
const STATUS = {
  ok: { label: "✅ نرمال", cls: "bg-emerald-100 text-emerald-700" },
  warning: { label: "⚠️ هشدار", cls: "bg-amber-100 text-amber-700" },
  alarm: { label: "🚨 آلارم", cls: "bg-rose-100 text-rose-700 animate-pulse" },
  nodata: { label: "⚪ بدون داده", cls: "bg-slate-100 text-slate-400" },
};
const EMPTY = { id: null, asset_id: "", name: "", parameter: "لرزش", unit: "mm/s",
  warning_limit: "", alarm_limit: "", direction: "up", is_active: true };

// نمودار روند SVG با خطوط آستانه
function TrendChart({ readings, warning, alarm }) {
  const data = [...readings].reverse().slice(-30);
  if (data.length < 2) return <p className="text-[11px] text-slate-400 py-4 text-center">حداقل ۲ خواندن برای نمودار لازم است.</p>;
  const W = 500, H = 120, P = 8;
  const vals = data.map((r) => r.value);
  const all = [...vals, ...(warning != null ? [warning] : []), ...(alarm != null ? [alarm] : [])];
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => P + (i / (data.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - min) / (max - min)) * (H - 2 * P);
  const line = data.map((r, i) => `${x(i)},${y(r.value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32 bg-slate-50 rounded-xl">
      {warning != null && <line x1={P} y1={y(warning)} x2={W - P} y2={y(warning)} stroke="#f59e0b" strokeDasharray="5,4" strokeWidth="1.5" />}
      {alarm != null && <line x1={P} y1={y(alarm)} x2={W - P} y2={y(alarm)} stroke="#ef4444" strokeDasharray="5,4" strokeWidth="1.5" />}
      <polyline points={line} fill="none" stroke="#0891b2" strokeWidth="2" strokeLinejoin="round" />
      {data.map((r, i) => <circle key={i} cx={x(i)} cy={y(r.value)} r="2.5" fill="#0891b2" />)}
      <text x={W - P} y={y(max) + 10} textAnchor="end" fontSize="9" fill="#64748b">{max.toFixed(1)}</text>
      <text x={W - P} y={y(min)} textAnchor="end" fontSize="9" fill="#64748b">{min.toFixed(1)}</text>
    </svg>
  );
}

export default function ConditionMonitoring({ user }) {
  const [view, setView] = useState("all");
  const [machines, setMachines] = useState([]);
  const [eq, setEq] = useState("");
  const [points, setPoints] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [selected, setSelected] = useState(null);
  const [readings, setReadings] = useState([]);
  const [reading, setReading] = useState({ value: "", note: "" });
  const [msg, setMsg] = useState("");
  const canWrite = hasPerm(user, "workorders.write");

  const load = async (eqId) => {
    const all = await invoke("get_condition_points", { assetId: eqId ? Number(eqId) : null });
    setPoints(all);
    return all;
  };
  useEffect(() => { invoke("get_machines").then(setMachines); load(""); }, []);
  useEffect(() => { setSelected(null); setReadings([]); load(eq); }, [eq]);

  const savePoint = async () => {
    if (!form.asset_id || !form.name.trim()) return alert("تجهیز و نام نقطه الزامی است.");
    try {
      await invoke("save_condition_point", { point: { ...form, asset_id: Number(form.asset_id),
        warning_limit: form.warning_limit === "" ? null : Number(form.warning_limit),
        alarm_limit: form.alarm_limit === "" ? null : Number(form.alarm_limit) } });
      setForm(EMPTY); load(eq);
    } catch (e) { alert(e); }
  };

  const selectPoint = async (p) => {
    setSelected(p);
    setReadings(await invoke("get_condition_readings", { pointId: p.id }));
  };

  const record = async () => {
    if (!reading.value) return;
    try {
      const m = await invoke("record_condition_reading", { pointId: selected.id, value: Number(reading.value), note: reading.note });
      setMsg(m); setReading({ value: "", note: "" });
      setReadings(await invoke("get_condition_readings", { pointId: selected.id }));
      load(eq);
      setTimeout(() => setMsg(""), 6000);
    } catch (e) { alert(e); }
  };

  const autoGen = async () => {
    try {
      const n = await invoke("generate_condition_work_orders");
      setMsg(n > 0 ? `✅ ${n} دستورکار پیش‌بینانه ایجاد شد` : "دستورکار جدیدی لازم نبود");
    } catch (e) { setMsg("❌ " + e); }
  };

  const F = "w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400";
  const filtered = view === "all" ? points : points.filter((p) => p.status === view);

  return (
    <div className="space-y-5">
      {/* سربرگ و وضعیت کلی */}
      <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-4 border border-white flex flex-wrap justify-between items-center gap-3">
        <div className="flex gap-2">
          {[["all", `همه (${points.length})`], ["alarm", `🚨 آلارم (${points.filter((p) => p.status === "alarm").length})`],
            ["warning", `⚠️ هشدار (${points.filter((p) => p.status === "warning").length})`],
            ["ok", `✅ نرمال (${points.filter((p) => p.status === "ok").length})`]].map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${view === id ? "bg-gradient-to-l from-cyan-500 to-blue-600 text-white shadow" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-slate-500">{msg}</span>}
          <button onClick={autoGen} className="text-xs bg-gradient-to-l from-rose-500 to-orange-500 text-white px-4 py-2 rounded-xl font-medium shadow hover:opacity-90">
            ⚡ ایجاد دستورکارهای پیش‌بینانه
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* تعریف نقطه */}
        <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white h-fit">
          <h2 className="font-bold text-lg mb-4 text-slate-800">{form.id ? "✏️ ویرایش نقطه" : "➕ نقطه اندازه‌گیری جدید"}</h2>
          <select className={`${F} mb-2`} value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })}>
            <option value="">تجهیز *</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.code} - {m.name}</option>)}
          </select>
          <input className={`${F} mb-2`} placeholder="نام نقطه * (مثل لرزش یاتاقان درایو)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2 mb-2">
            <select className={F} value={form.parameter} onChange={(e) => {
              const p = PARAMETERS.find((x) => x.id === e.target.value);
              setForm({ ...form, parameter: e.target.value, unit: p?.unit || "" });
            }}>
              {PARAMETERS.map((p) => <option key={p.id}>{p.id}</option>)}
            </select>
            <input className={F} placeholder="واحد" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input className={F} type="number" step="any" placeholder="آستانه هشدار" value={form.warning_limit} onChange={(e) => setForm({ ...form, warning_limit: e.target.value })} />
            <input className={F} type="number" step="any" placeholder="آستانه آلارم" value={form.alarm_limit} onChange={(e) => setForm({ ...form, alarm_limit: e.target.value })} />
          </div>
          <select className={`${F} mb-3`} value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
            <option value="up">↑ بالا رفتن = بدتر (لرزش، دما...)</option>
            <option value="down">↓ پایین آمدن = بدتر (فشار روغن...)</option>
          </select>
          <div className="flex gap-2">
            <button onClick={savePoint} disabled={!canWrite}
              className="flex-1 bg-gradient-to-l from-cyan-500 to-blue-600 text-white py-2.5 rounded-xl font-medium shadow disabled:opacity-40">ذخیره نقطه</button>
            {form.id && <button onClick={() => setForm(EMPTY)} className="bg-slate-100 px-4 rounded-xl text-slate-600">انصراف</button>}
          </div>

          {/* ثبت خواندن */}
          {selected && (
            <div className="mt-5 pt-4 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-700 mb-2">📈 ثبت خواندن — {selected.name}</h3>
              <div className="flex gap-2 mb-2">
                <input className={F} type="number" step="any" placeholder={`مقدار (${selected.unit})`} value={reading.value}
                  onChange={(e) => setReading({ ...reading, value: e.target.value })} />
                <input className={F} placeholder="یادداشت" value={reading.note} onChange={(e) => setReading({ ...reading, note: e.target.value })} />
              </div>
              <button onClick={record} disabled={!canWrite}
                className="w-full bg-gradient-to-l from-emerald-500 to-teal-600 text-white py-2 rounded-xl text-sm shadow disabled:opacity-40">ثبت خواندن</button>
              <div className="mt-3">
                <TrendChart readings={readings} warning={selected.warning_limit} alarm={selected.alarm_limit} />
                <div className="flex gap-4 mt-1 text-[10px] text-slate-400 justify-center">
                  {selected.warning_limit != null && <span className="flex items-center gap-1"><span className="w-4 border-t-2 border-dashed border-amber-400"></span>هشدار: {selected.warning_limit}</span>}
                  {selected.alarm_limit != null && <span className="flex items-center gap-1"><span className="w-4 border-t-2 border-dashed border-rose-400"></span>آلارم: {selected.alarm_limit}</span>}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* لیست نقاط */}
        <div className="lg:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-bold text-lg text-slate-800">نقاط پایش ({filtered.length})</h2>
            <div className="flex gap-2 no-print">
              <button onClick={() => exportToExcel(filtered, "CM", "condition-points")}
                className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600">📊 اکسل</button>
              <button onClick={() => printSection("cm-table", "نقاط پایش وضعیت")}
                className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800">🖨️ چاپ</button>
            </div>
          </div>
          <select className={`${F} mb-3 !w-72`} value={eq} onChange={(e) => setEq(e.target.value)}>
            <option value="">همه تجهیزات</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.code} - {m.name}</option>)}
          </select>
          <div id="cm-table" className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
                <th className="p-2">تجهیز</th><th className="p-2">نقطه</th><th className="p-2">آخرین مقدار</th>
                <th className="p-2">آستانه‌ها</th><th className="p-2">وضعیت</th><th className="p-2"></th>
              </tr></thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} onClick={() => selectPoint(p)}
                    className={`border-b border-slate-50 cursor-pointer transition ${selected?.id === p.id ? "bg-cyan-50" : "hover:bg-slate-50"}`}>
                    <td className="p-2 text-xs text-slate-500"><span className="font-mono">{p.asset_code}</span><br />{p.asset_name}</td>
                    <td className="p-2"><div className="font-medium">{p.name}</div><div className="text-[10px] text-slate-400">{p.parameter}</div></td>
                    <td className="p-2 font-mono font-bold">
                      {p.latest_value != null ? <span className={p.status === "alarm" ? "text-rose-600" : p.status === "warning" ? "text-amber-600" : "text-emerald-600"}>{p.latest_value} {p.unit}</span> : "—"}
                      {p.latest_at && <span className="block text-[9px] text-slate-400 font-normal">{p.latest_at}</span>}
                    </td>
                    <td className="p-2 text-[10px] text-slate-400 font-mono">
                      {p.warning_limit != null && <span>⚠ {p.warning_limit}<br /></span>}
                      {p.alarm_limit != null && <span>🚨 {p.alarm_limit}</span>}
                    </td>
                    <td className="p-2"><span className={`px-2 py-1 rounded-full text-[11px] font-medium ${STATUS[p.status]?.cls}`}>{STATUS[p.status]?.label}</span></td>
                    <td className="p-2">
                      <div className="flex gap-2 text-xs no-print">
                        <button onClick={(e) => { e.stopPropagation(); setForm({ id: p.id, asset_id: String(p.asset_id), name: p.name,
                          parameter: p.parameter, unit: p.unit, warning_limit: p.warning_limit ?? "", alarm_limit: p.alarm_limit ?? "",
                          direction: p.direction, is_active: p.is_active }); }}
                          className="text-blue-600 hover:underline">ویرایش</button>
                        <button onClick={async (e) => { e.stopPropagation(); if (confirm("حذف این نقطه و تمام خواند‌هایش؟")) {
                          await invoke("delete_condition_point", { id: p.id }); if (selected?.id === p.id) setSelected(null); load(eq); } }}
                          className="text-rose-500 hover:underline">حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-slate-400">نقطه‌ای یافت نشد.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* تاریخچه خواند‌های نقطه انتخابی */}
          {selected && readings.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <h3 className="font-bold text-sm text-slate-700 mb-2">🕓 آخرین خواند‌های «{selected.name}»</h3>
              <ul className="max-h-40 overflow-y-auto space-y-1">
                {readings.slice(0, 15).map((r) => (
                  <li key={r.id} className="flex justify-between items-center bg-slate-50 rounded-lg p-2 text-xs">
                    <span className="font-mono font-bold">{r.value} {selected.unit}</span>
                    <span className="text-slate-400">{r.note} · {r.measured_by} · {r.created_at}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
