import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

const WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

export default function MaintenanceCalendar() {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [events, setEvents] = useState([]);
  const [workload, setWorkload] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);

  const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
  const monthFa = new Intl.DateTimeFormat("fa-IR", { month: "long", year: "numeric" }).format(cursor);

  useEffect(() => {
    invoke("get_calendar", { month: monthKey }).then(setEvents).catch(() => {});
    invoke("get_technician_workload").then(setWorkload).catch(() => {});
  }, [monthKey]);

  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const firstOffset = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 1) % 7; // شنبه-first
  const cells = [...Array(firstOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const eventsOf = (day) => day ? events.filter((e) => e.date.endsWith(`-${String(day).padStart(2, "0")}`)) : [];
  const dayEvents = eventsOf(selectedDay);

  const evColor = (e) => e.kind === "pm" ? "bg-amber-100 text-amber-700 border-amber-200"
    : (e.status === "تکمیل شده" || e.status === "بسته شده") ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : e.status === "لغو شده" ? "bg-slate-100 text-slate-400 border-slate-200"
    : "bg-rose-100 text-rose-700 border-rose-200";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <div className="xl:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
        <div className="flex justify-between items-center mb-4">
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition">›</button>
          <h2 className="font-bold text-lg text-slate-800">📆 {monthFa}</h2>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition">‹</button>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map((w) => <div key={w} className="text-center text-[11px] font-bold text-slate-400 py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            const evs = eventsOf(day);
            return (
              <div key={i} onClick={() => day && setSelectedDay(day)}
                className={`min-h-[72px] rounded-xl border p-1.5 transition cursor-pointer
                  ${!day ? "border-transparent" : selectedDay === day ? "border-cyan-400 bg-cyan-50" : "border-slate-100 hover:border-cyan-200 hover:bg-slate-50"}`}>
                {day && (
                  <>
                    <div className="text-xs font-bold text-slate-600 mb-1">{day.toLocaleString("fa-IR")}</div>
                    <div className="space-y-0.5">
                      {evs.slice(0, 3).map((e, j) => (
                        <div key={j} className={`text-[9px] rounded px-1 py-0.5 truncate border ${evColor(e)}`}>{e.title}</div>
                      ))}
                      {evs.length > 3 && <div className="text-[9px] text-slate-400">+{evs.length - 3}</div>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-rose-200 border border-rose-300"></span>دستورکار باز</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-200 border border-emerald-300"></span>تکمیل شده</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-200 border border-amber-300"></span>سررسید PM</span>
        </div>

        {selectedDay !== null && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <h3 className="font-bold text-sm text-slate-700 mb-2">رویدادهای روز {selectedDay.toLocaleString("fa-IR")}</h3>
            {dayEvents.length === 0 && <p className="text-xs text-slate-400">رویدادی نیست.</p>}
            <ul className="space-y-1">
              {dayEvents.map((e, i) => (
                <li key={i} className={`text-xs rounded-lg px-3 py-2 border ${evColor(e)}`}>
                  <span className="font-medium">{e.kind === "pm" ? "📅" : "🔧"} {e.title}</span>
                  <span className="block text-[10px] opacity-70">{e.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* برنامه‌ریزی منابع */}
      <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white h-fit">
        <h3 className="font-bold text-slate-800 mb-4">👷 بار کاری تکنسین‌ها</h3>
        <div className="space-y-3">
          {workload.map((w) => {
            const total = w.open_count + w.in_progress;
            return (
              <div key={w.technician} className="bg-slate-50 rounded-xl p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium text-sm text-slate-700">{w.technician}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${total > 5 ? "bg-rose-100 text-rose-600" : total > 2 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {total > 5 ? "🔴 اشباع" : total > 2 ? "🟡 پر" : "🟢 آزاد"}
                  </span>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden bg-slate-200">
                  <div className="bg-sky-400" style={{ width: `${(w.open_count / Math.max(total, 1)) * 100}%` }}></div>
                  <div className="bg-amber-400" style={{ width: `${(w.in_progress / Math.max(total, 1)) * 100}%` }}></div>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>باز: {w.open_count.toLocaleString("fa-IR")}</span>
                  <span>در حال انجام: {w.in_progress.toLocaleString("fa-IR")}</span>
                  <span>تکمیل: {w.completed.toLocaleString("fa-IR")}</span>
                </div>
              </div>
            );
          })}
          {workload.length === 0 && <p className="text-slate-400 text-sm">داده‌ای نیست.</p>}
        </div>
        <p className="text-[11px] text-slate-400 mt-4 leading-5">
          💡 برای تخصیص منابع، از کارتابل تعمیرات تکنسین موردنظر را روی دستورکارها تعیین کنید.
        </p>
      </div>
    </div>
  );
}
