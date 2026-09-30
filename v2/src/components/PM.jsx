import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exportToExcel, printSection } from "../utils/export.js";
import { hasPerm } from "../utils/permissions.js";

const TIME_UNITS = [
  { id: "day", label: "روز" }, { id: "week", label: "هفته" },
  { id: "month", label: "ماه" }, { id: "year", label: "سال" },
];
const METER_UNITS = [
  { id: "operating_hour", label: "ساعت کارکرد" },
  { id: "kilometer", label: "کیلومتر" },
  { id: "meter", label: "متر" },
];
const DUE_STATUS = {
  overdue: { label: "🔴 سررسید گذشته", cls: "bg-rose-100 text-rose-700" },
  near: { label: "🟡 نزدیک سررسید", cls: "bg-amber-100 text-amber-700" },
  ok: { label: "🟢 در برنامه", cls: "bg-emerald-100 text-emerald-700" },
  nodata: { label: "⚪ بدون داده", cls: "bg-slate-100 text-slate-500" },
};
const EMPTY_PM = { id: null, code: "", title: "", asset_id: "", job_plan_id: null,
  interval_value: 1, interval_unit: "month", assignee: "", priority: "متوسط", is_active: true };
const EMPTY_JP = { id: null, code: "", title: "", description: "", estimated_hours: 0, safety_notes: "", tools: "" };

export default function PM({ user }) {
  const [sub, setSub] = useState("programs");
  const [programs, setPrograms] = useState([]);
  const [plans, setPlans] = useState([]);
  const [machines, setMachines] = useState([]);
  const [parts, setParts] = useState([]);
  const [pmForm, setPmForm] = useState(EMPTY_PM);
  const [jpForm, setJpForm] = useState(EMPTY_JP);
  const [jpSteps, setJpSteps] = useState([]);
  const [jpParts, setJpParts] = useState([]);
  const [newStep, setNewStep] = useState({ description: "", estimated_minutes: 15 });
  const [newJpPart, setNewJpPart] = useState({ part_id: "", quantity: 1 });
  const [meter, setMeter] = useState({ value: "", note: "" });
  const [readings, setReadings] = useState([]);
  const [genMsg, setGenMsg] = useState("");
  const canWrite = hasPerm(user, "workorders.write");

  const load = async () => {
    setPrograms(await invoke("get_pm_programs"));
    setPlans(await invoke("get_job_plans"));
    setMachines(await invoke("get_machines"));
    setParts(await invoke("get_parts"));
  };
  useEffect(() => { load(); }, []);

  const autoGenerate = async () => {
    try {
      const n = await invoke("generate_pm_work_orders");
      setGenMsg(n > 0 ? `✅ ${n} دستورکار PM ایجاد شد — در کارتابل تعمیرات مشاهده کنید` : "دستورکار جدیدی لازم نبود");
      load();
    } catch (e) { setGenMsg("❌ " + e); }
  };

  const savePm = async () => {
    if (!pmForm.asset_id) return alert("تجهیز را انتخاب کنید");
    try {
      await invoke("save_pm_program", { program: { ...pmForm, asset_id: Number(pmForm.asset_id),
        job_plan_id: pmForm.job_plan_id ? Number(pmForm.job_plan_id) : null } });
      setPmForm(EMPTY_PM); load();
    } catch (e) { alert(e); }
  };

  const saveJp = async () => {
    try {
      const id = await invoke("save_job_plan", { plan: jpForm });
      setJpForm({ ...jpForm, id }); load();
    } catch (e) { alert(e); }
  };

  const openJp = async (p) => {
    setJpForm({ id: p.id, code: p.code, title: p.title, description: p.description,
      estimated_hours: p.estimated_hours, safety_notes: p.safety_notes, tools: p.tools });
    setJpSteps(await invoke("get_job_plan_steps", { jobPlanId: p.id }));
    setJpParts(await invoke("get_job_plan_parts", { jobPlanId: p.id }));
  };

  const F = "w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400";

  return (
    <div className="space-y-5">
      {/* سربرگ */}
      <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-4 border border-white flex flex-wrap justify-between items-center gap-3">
        <div className="flex gap-2">
          <button onClick={() => setSub("programs")}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${sub === "programs" ? "bg-gradient-to-l from-cyan-500 to-blue-600 text-white shadow-lg" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
            📅 برنامه‌های PM
          </button>
          <button onClick={() => setSub("jobplans")}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${sub === "jobplans" ? "bg-gradient-to-l from-violet-500 to-purple-600 text-white shadow-lg" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
            📋 Job Plan (طرح کار)
          </button>
        </div>
        <div className="flex items-center gap-2">
          {genMsg && <span className="text-xs text-slate-500">{genMsg}</span>}
          <button onClick={autoGenerate} className="text-xs bg-gradient-to-l from-emerald-500 to-teal-600 text-white px-4 py-2 rounded-xl font-medium shadow hover:opacity-90">
            ⚡ بررسی و ایجاد دستورکارهای سررسید
          </button>
        </div>
      </div>

      {sub === "programs" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* فرم PM */}
          <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white h-fit">
            <h2 className="font-bold text-lg mb-4 text-slate-800">{pmForm.id ? "✏️ ویرایش برنامه" : "➕ برنامه PM جدید"}</h2>
            <input className={`${F} mb-2 font-mono`} placeholder="کد برنامه * (مثل PM-P101-01)" value={pmForm.code} onChange={(e) => setPmForm({ ...pmForm, code: e.target.value })} />
            <input className={`${F} mb-2`} placeholder="عنوان برنامه * (مثل سرویس دوره‌ای پمپ)" value={pmForm.title} onChange={(e) => setPmForm({ ...pmForm, title: e.target.value })} />
            <select className={`${F} mb-2`} value={pmForm.asset_id} onChange={(e) => setPmForm({ ...pmForm, asset_id: e.target.value })}>
              <option value="">تجهیز *</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.code} - {m.name}</option>)}
            </select>
            <select className={`${F} mb-2`} value={pmForm.job_plan_id ?? ""} onChange={(e) => setPmForm({ ...pmForm, job_plan_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">بدون طرح کار (Job Plan)</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.title}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input className={F} type="number" min="1" placeholder="بازه" value={pmForm.interval_value} onChange={(e) => setPmForm({ ...pmForm, interval_value: Number(e.target.value) })} />
              <select className={F} value={pmForm.interval_unit} onChange={(e) => setPmForm({ ...pmForm, interval_unit: e.target.value })}>
                <optgroup label="بر اساس زمان">{TIME_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</optgroup>
                <optgroup label="بر اساس کنتور">{METER_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</optgroup>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input className={F} placeholder="تکنسین" value={pmForm.assignee} onChange={(e) => setPmForm({ ...pmForm, assignee: e.target.value })} />
              <select className={F} value={pmForm.priority} onChange={(e) => setPmForm({ ...pmForm, priority: e.target.value })}>
                {["پایین","متوسط","بالا","اورژانسی"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 mb-3">
              <input type="checkbox" checked={pmForm.is_active} onChange={(e) => setPmForm({ ...pmForm, is_active: e.target.checked })} />
              برنامه فعال است
            </label>
            <div className="flex gap-2">
              <button onClick={savePm} disabled={!canWrite}
                className="flex-1 bg-gradient-to-l from-cyan-500 to-blue-600 text-white py-2.5 rounded-xl font-medium shadow-lg shadow-cyan-500/30 hover:opacity-90 disabled:opacity-40">
                ذخیره برنامه
              </button>
              {pmForm.id && <button onClick={() => setPmForm(EMPTY_PM)} className="bg-slate-100 px-4 rounded-xl text-slate-600">انصراف</button>}
            </div>

            {/* ثبت رکورد کنتوری */}
            {pmForm.asset_id && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-2">⏱️ ثبت رکورد کنتور تجهیز</h3>
                <div className="flex gap-2 mb-2">
                  <input className={F} type="number" placeholder="مقدار کنتور (ساعت/کیلومتر...)" value={meter.value}
                    onChange={(e) => setMeter({ ...meter, value: e.target.value })} />
                  <input className={F} placeholder="یادداشت" value={meter.note} onChange={(e) => setMeter({ ...meter, note: e.target.value })} />
                  <button onClick={async () => {
                    if (!meter.value) return;
                    try {
                      await invoke("record_meter_reading", { assetId: Number(pmForm.asset_id), value: Number(meter.value), note: meter.note });
                      setMeter({ value: "", note: "" });
                      setReadings(await invoke("get_meter_readings", { assetId: Number(pmForm.asset_id) }));
                      load();
                    } catch (e) { alert(e); }
                  }} disabled={!canWrite} className="bg-indigo-500 text-white px-3 rounded-xl text-xs hover:bg-indigo-600 disabled:opacity-40">ثبت</button>
                </div>
                {readings.length > 0 && (
                  <ul className="text-[11px] text-slate-500 max-h-28 overflow-y-auto">
                    {readings.slice(0, 5).map((r) => (
                      <li key={r.id} className="flex justify-between border-b border-slate-100 py-1">
                        <span className="font-mono">{Number(r.value).toLocaleString("fa-IR")}</span>
                        <span>{r.recorded_by} · {r.created_at}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* لیست برنامه‌ها */}
          <div className="lg:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-lg text-slate-800">برنامه‌ها ({programs.length})</h2>
              <div className="flex gap-2 no-print">
                <button onClick={() => exportToExcel(programs, "PM", "pm-programs")}
                  className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600">📊 اکسل</button>
                <button onClick={() => printSection("pm-table", "برنامه‌های نگهداشت پیشگیرانه")}
                  className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800">🖨️ چاپ</button>
              </div>
            </div>
            <div id="pm-table" className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
                  <th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">تجهیز</th>
                  <th className="p-2">بازه</th><th className="p-2">سررسید بعدی</th><th className="p-2">وضعیت</th><th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {programs.map((p) => (
                    <tr key={p.id} className={`border-b border-slate-50 hover:bg-cyan-50/40 ${!p.is_active ? "opacity-40" : ""}`}>
                      <td className="p-2 font-mono text-cyan-700 font-semibold">{p.code}</td>
                      <td className="p-2 font-medium">{p.title}</td>
                      <td className="p-2 text-xs text-slate-500">{p.asset_code}</td>
                      <td className="p-2 text-xs">هر {p.interval_value} {p.interval_fa}</td>
                      <td className="p-2 text-xs font-mono">
                        {p.is_meter_based
                          ? `${Number(p.current_meter || 0).toLocaleString("fa-IR")} / ${Number(p.next_due_meter || 0).toLocaleString("fa-IR")}`
                          : p.next_due_date || "—"}
                      </td>
                      <td className="p-2">
                        <span className={`px-2 py-1 rounded-full text-[11px] font-medium ${DUE_STATUS[p.due_status]?.cls}`}>
                          {DUE_STATUS[p.due_status]?.label}
                          {p.days_until != null && p.due_status !== "overdue" && ` (${p.days_until} روز)`}
                          {p.due_status === "overdue" && p.days_until != null && ` (${Math.abs(p.days_until)} روز گذشته)`}
                        </span>
                      </td>
                      <td className="p-2">
                        <div className="flex gap-2 text-xs no-print">
                          <button onClick={() => setPmForm({ id: p.id, code: p.code, title: p.title, asset_id: String(p.asset_id),
                            job_plan_id: p.job_plan_id, interval_value: p.interval_value, interval_unit: p.interval_unit,
                            assignee: p.assignee, priority: p.priority, is_active: p.is_active })}
                            className="text-blue-600 hover:underline">ویرایش</button>
                          <button onClick={async () => { if (confirm("حذف این برنامه؟")) { await invoke("delete_pm_program", { id: p.id }); load(); } }}
                            className="text-rose-500 hover:underline">حذف</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {programs.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-slate-400">برنامه‌ای ثبت نشده است.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {sub === "jobplans" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* فرم Job Plan */}
          <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white h-fit">
            <h2 className="font-bold text-lg mb-4 text-slate-800">{jpForm.id ? "✏️ ویرایش طرح کار" : "➕ طرح کار جدید"}</h2>
            <input className={`${F} mb-2 font-mono`} placeholder="کد طرح کار * (مثل JP-PMP-01)" value={jpForm.code} onChange={(e) => setJpForm({ ...jpForm, code: e.target.value })} />
            <input className={`${F} mb-2`} placeholder="عنوان طرح کار *" value={jpForm.title} onChange={(e) => setJpForm({ ...jpForm, title: e.target.value })} />
            <textarea className={`${F} mb-2`} rows="2" placeholder="شرح کلی کار..." value={jpForm.description} onChange={(e) => setJpForm({ ...jpForm, description: e.target.value })} />
            <input className={`${F} mb-2`} type="number" step="0.5" placeholder="ساعت تخمینی" value={jpForm.estimated_hours} onChange={(e) => setJpForm({ ...jpForm, estimated_hours: Number(e.target.value) })} />
            <textarea className={`${F} mb-2`} rows="2" placeholder="⚠️ نکات ایمنی (LOTO، مجوز کار گرم...)" value={jpForm.safety_notes} onChange={(e) => setJpForm({ ...jpForm, safety_notes: e.target.value })} />
            <input className={`${F} mb-3`} placeholder="🔧 ابزارهای مورد نیاز" value={jpForm.tools} onChange={(e) => setJpForm({ ...jpForm, tools: e.target.value })} />
            <div className="flex gap-2">
              <button onClick={saveJp} disabled={!canWrite}
                className="flex-1 bg-gradient-to-l from-violet-500 to-purple-600 text-white py-2.5 rounded-xl font-medium shadow-lg shadow-violet-500/30 hover:opacity-90 disabled:opacity-40">
                {jpForm.id ? "ذخیره تغییرات" : "ایجاد طرح کار"}
              </button>
              {jpForm.id && <button onClick={() => { setJpForm(EMPTY_JP); setJpSteps([]); setJpParts([]); }} className="bg-slate-100 px-4 rounded-xl text-slate-600">جدید</button>}
            </div>

            {/* مراحل اجرایی */}
            {jpForm.id && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-2">مراحل اجرایی</h3>
                <div className="flex gap-2 mb-2">
                  <input className={F} placeholder="شرح مرحله..." value={newStep.description}
                    onChange={(e) => setNewStep({ ...newStep, description: e.target.value })} />
                  <input className={`${F} !w-20`} type="number" placeholder="دقیقه" value={newStep.estimated_minutes}
                    onChange={(e) => setNewStep({ ...newStep, estimated_minutes: Number(e.target.value) })} />
                </div>
                <button onClick={async () => {
                  if (!newStep.description.trim()) return;
                  await invoke("add_job_plan_step", { jobPlanId: jpForm.id, description: newStep.description, estimatedMinutes: newStep.estimated_minutes });
                  setNewStep({ description: "", estimated_minutes: 15 });
                  setJpSteps(await invoke("get_job_plan_steps", { jobPlanId: jpForm.id }));
                }} disabled={!canWrite} className="text-xs bg-violet-500 text-white px-3 py-1.5 rounded-lg hover:bg-violet-600 disabled:opacity-40">+ افزودن مرحله</button>
                <ul className="mt-2 space-y-1">
                  {jpSteps.map((s) => (
                    <li key={s.id} className="flex justify-between items-center bg-slate-50 rounded-lg p-2 text-xs">
                      <span><span className="font-bold text-violet-600 ml-1">{s.order_index}.</span>{s.description} <span className="text-slate-400">({s.estimated_minutes} دقیقه)</span></span>
                      <button onClick={async () => { await invoke("remove_job_plan_step", { id: s.id }); setJpSteps(await invoke("get_job_plan_steps", { jobPlanId: jpForm.id })); }}
                        className="text-rose-400 hover:text-rose-600">✕</button>
                    </li>
                  ))}
                </ul>

                <h3 className="text-sm font-bold text-slate-700 mb-2 mt-4">قطعات پیش‌بینی‌شده</h3>
                <div className="flex gap-2 mb-2">
                  <select className={F} value={newJpPart.part_id} onChange={(e) => setNewJpPart({ ...newJpPart, part_id: e.target.value })}>
                    <option value="">انتخاب قطعه...</option>
                    {parts.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                  </select>
                  <input className={`${F} !w-20`} type="number" placeholder="تعداد" value={newJpPart.quantity}
                    onChange={(e) => setNewJpPart({ ...newJpPart, quantity: e.target.value })} />
                </div>
                <button onClick={async () => {
                  if (!newJpPart.part_id) return;
                  await invoke("add_job_plan_part", { jobPlanId: jpForm.id, partId: Number(newJpPart.part_id), quantity: Number(newJpPart.quantity) });
                  setJpParts(await invoke("get_job_plan_parts", { jobPlanId: jpForm.id }));
                }} disabled={!canWrite} className="text-xs bg-purple-500 text-white px-3 py-1.5 rounded-lg hover:bg-purple-600 disabled:opacity-40">+ افزودن قطعه</button>
                <ul className="mt-2 space-y-1">
                  {jpParts.map((p) => (
                    <li key={p.id} className="flex justify-between items-center bg-slate-50 rounded-lg p-2 text-xs">
                      <span className="font-mono">{p.code}</span><span>{p.name} × {p.quantity} {p.unit}</span>
                      <button onClick={async () => { await invoke("remove_job_plan_part", { id: p.id }); setJpParts(await invoke("get_job_plan_parts", { jobPlanId: jpForm.id })); }}
                        className="text-rose-400 hover:text-rose-600">✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* لیست طرح‌های کار */}
          <div className="lg:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-lg text-slate-800">طرح‌های کار ({plans.length})</h2>
              <div className="flex gap-2 no-print">
                <button onClick={() => exportToExcel(plans, "JobPlan", "job-plans")}
                  className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600">📊 اکسل</button>
                <button onClick={() => printSection("jp-table", "طرح‌های کار (Job Plans)")}
                  className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800">🖨️ چاپ</button>
              </div>
            </div>
            <div id="jp-table" className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
                  <th className="p-2">کد</th><th className="p-2">عنوان</th><th className="p-2">زمان تخمینی</th>
                  <th className="p-2">مراحل</th><th className="p-2">قطعات</th><th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id} className={`border-b border-slate-50 cursor-pointer transition ${jpForm.id === p.id ? "bg-violet-50" : "hover:bg-purple-50/40"}`}
                      onClick={() => openJp(p)}>
                      <td className="p-2 font-mono text-purple-700 font-semibold">{p.code}</td>
                      <td className="p-2 font-medium">{p.title}</td>
                      <td className="p-2 text-xs text-slate-500">{p.estimated_hours} ساعت</td>
                      <td className="p-2"><span className="bg-violet-100 text-violet-700 text-xs px-2 py-0.5 rounded-full">{p.steps_count} مرحله</span></td>
                      <td className="p-2"><span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full">{p.parts_count} قطعه</span></td>
                      <td className="p-2">
                        <button onClick={async (e) => { e.stopPropagation(); if (confirm("حذف این طرح کار؟")) { try { await invoke("delete_job_plan", { id: p.id }); load(); } catch (err) { alert(err); } } }}
                          className="text-rose-500 hover:underline text-xs">حذف</button>
                      </td>
                    </tr>
                  ))}
                  {plans.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-slate-400">طرح کاری ثبت نشده است.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
