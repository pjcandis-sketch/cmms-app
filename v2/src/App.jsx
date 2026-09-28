import { useState } from "react";
import DeviceProfile from "./components/DeviceProfile.jsx";
import Checklist from "./components/Checklist.jsx";
import WorkOrder from "./components/WorkOrder.jsx";
import logo from "./assets/logo.png";

const TABS = [
  { id: "devices", label: "پروفایل دستگاه‌ها", icon: "⚙️" },
  { id: "checklist", label: "چک‌لیست‌ها", icon: "✅" },
  { id: "workorders", label: "کارتابل تعمیرات", icon: "🔧" },
];

export default function App() {
  const [tab, setTab] = useState("devices");
  const [selectedMachine, setSelectedMachine] = useState(null);

  return (
    <div className="min-h-screen flex" dir="rtl">
      {/* سایدبار */}
      <aside className="w-64 bg-slate-900/80 backdrop-blur border-l border-slate-700/50 flex flex-col no-print">
        <div className="flex items-center gap-3 p-5 border-b border-slate-700/50">
          <img src={logo} alt="logo" className="w-12 h-12 rounded-2xl shadow-lg ring-2 ring-cyan-400/40" />
          <div>
            <h1 className="text-white font-bold text-sm leading-5">سامانه مدیریت تعمیر<br />ونگهداری (CMMS)</h1>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium
                ${tab === t.id
                  ? "bg-gradient-to-l from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/30"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}>
              <span className="text-lg">{t.icon}</span>
              {t.label}
              {t.id === "checklist" && selectedMachine && (
                <span className="mr-auto text-[10px] bg-white/20 rounded-full px-2 py-0.5">{selectedMachine.code}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="p-4 text-[11px] text-slate-500 border-t border-slate-700/50">نسخه 0.1.0</div>
      </aside>

      {/* محتوای اصلی */}
      <main className="flex-1 p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          {tab === "devices" && (
            <DeviceProfile selected={selectedMachine}
              onSelect={(m) => { setSelectedMachine(m); setTab("checklist"); }} />
          )}
          {tab === "checklist" && <Checklist machine={selectedMachine} />}
          {tab === "workorders" && <WorkOrder machine={selectedMachine} />}
        </div>
      </main>
    </div>
  );
}
