import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

const fmt = (n) => Number(n || 0).toLocaleString("fa-IR");

function Card({ title, value, sub, icon, gradient }) {
  return (
    <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-5 border border-white relative overflow-hidden">
      <div className={`absolute -left-4 -top-4 w-20 h-20 rounded-full opacity-20 bg-gradient-to-l ${gradient}`}></div>
      <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
        <span className="text-lg">{icon}</span>{title}
      </div>
      <div className="text-3xl font-bold text-slate-800 mt-2">{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [k, setK] = useState(null);
  useEffect(() => { invoke("get_kpis").then(setK).catch((e) => alert(e)); }, []);
  if (!k) return <div className="text-center text-white py-20">⏳ در حال بارگذاری...</div>;

  const maxTrend = Math.max(...k.monthly_trend.map(([, c]) => c), 1);
  const maxFm = Math.max(...k.top_failure_modes.map(([, c]) => c), 1);

  return (
    <div className="space-y-5">
      {/* ردیف ۱: وضعیت کلی */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="کل دارایی‌ها" value={fmt(k.assets_total)} sub={`${fmt(k.equipment_count)} تجهیز`} icon="🏭" gradient="from-slate-400 to-slate-600" />
        <Card title="دستورکار باز" value={fmt(k.wo_open)} sub={`${fmt(k.wo_emergency)} مورد اورژانسی`} icon="📋" gradient="from-sky-400 to-blue-600" />
        <Card title="در حال انجام" value={fmt(k.wo_in_progress)} sub={`مجموع: ${fmt(k.wo_total)}`} icon="🔧" gradient="from-amber-400 to-orange-500" />
        <Card title="تکمیل شده" value={fmt(k.wo_completed)} icon="✅" gradient="from-emerald-400 to-teal-600" />
      </div>

      {/* ردیف ۲: PM و انبار و شاخص‌ها */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="برنامه‌های PM" value={fmt(k.pm_total)} sub={k.pm_overdue > 0 ? `🔴 ${fmt(k.pm_overdue)} سررسید گذشته` : "همه در برنامه"} icon="📅" gradient="from-indigo-400 to-purple-600" />
        <Card title="PM نزدیک سررسید" value={fmt(k.pm_near)} sub="کمتر از ۷ روز" icon="⏰" gradient="from-amber-400 to-yellow-500" />
        <Card title="MTTR" value={`${fmt(k.mttr_days)} روز`} sub="میانگین زمان تعمیر" icon="⏱️" gradient="from-cyan-400 to-blue-500" />
        <Card title="انطباق PM" value={`${fmt(k.pm_compliance)}٪`} sub="دستورکارهای PM تکمیل‌شده" icon="🎯" gradient="from-violet-400 to-fuchsia-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ترند ماهانه */}
        <div className="lg:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
          <h3 className="font-bold text-slate-800 mb-4">📊 روند ثبت دستورکار (۶ ماه اخیر)</h3>
          <div className="flex items-end gap-3 h-40">
            {k.monthly_trend.map(([m, c]) => (
              <div key={m} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs font-bold text-slate-600">{fmt(c)}</span>
                <div className="w-full rounded-t-xl bg-gradient-to-t from-cyan-500 to-blue-400 transition-all"
                  style={{ height: `${Math.max((c / maxTrend) * 100, 4)}%` }}></div>
                <span className="text-[10px] text-slate-400">{m}</span>
              </div>
            ))}
          </div>
        </div>

        {/* حالت‌های خرابی برتر */}
        <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
          <h3 className="font-bold text-slate-800 mb-4">⚠️ شایع‌ترین حالت‌های خرابی</h3>
          <div className="space-y-3">
            {k.top_failure_modes.map(([mode, count]) => (
              <div key={mode}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium text-slate-600">{mode}</span>
                  <span className="text-slate-400">{fmt(count)}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-l from-rose-400 to-orange-400"
                    style={{ width: `${(count / maxFm) * 100}%` }}></div>
                </div>
              </div>
            ))}
            {k.top_failure_modes.length === 0 && <p className="text-slate-400 text-xs">داده‌ای نیست.</p>}
          </div>
        </div>
      </div>

      {/* ردیف ۳: انبار */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card title="ارزش قطعات مصرف‌شده" value={`${fmt(k.parts_consumed_cost)} ریال`} icon="💰" gradient="from-emerald-400 to-green-600" />
        <Card title="اقلام کم‌موجودی" value={fmt(k.parts_low_stock)} sub={`از ${fmt(k.parts_total)} قلم`} icon="⚠️" gradient="from-rose-400 to-red-600" />
        <Card title="کل اقلام انبار" value={fmt(k.parts_total)} icon="🏪" gradient="from-slate-400 to-slate-600" />
      </div>
    </div>
  );
}
