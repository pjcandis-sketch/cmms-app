import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import AssetManager from "./components/AssetManager.jsx";
import Checklist from "./components/Checklist.jsx";
import WorkOrder from "./components/WorkOrder.jsx";
import Users from "./components/Users.jsx";
import Approvals from "./components/Approvals.jsx";
import AuditLog from "./components/AuditLog.jsx";
import PM from "./components/PM.jsx";
import Inventory from "./components/Inventory.jsx";
import RCA from "./components/RCA.jsx";
import Dashboard from "./components/Dashboard.jsx";
import MaintenanceCalendar from "./components/MaintenanceCalendar.jsx";
import ConditionMonitoring from "./components/ConditionMonitoring.jsx";
import Login from "./components/Login.jsx";
import { hasPerm } from "./utils/permissions.js";
import logo from "./assets/logo.png";

const TABS = [
  { id: "dashboard", label: "داشبورد", icon: "📊", perm: null },
  { id: "calendar", label: "تقویم تعمیرات", icon: "📆", perm: null },
  { id: "assets", label: "مدیریت دارایی‌ها", icon: "🏭", perm: null },
  { id: "checklist", label: "چک‌لیست‌ها", icon: "✅", perm: null },
  { id: "workorders", label: "کارتابل تعمیرات", icon: "🔧", perm: null },
  { id: "pm", label: "برنامه‌های PM", icon: "📅", perm: null },
  { id: "inventory", label: "انبار و قطعات", icon: "🏪", perm: null },
  { id: "rca", label: "تحلیل علت ریشه‌ای", icon: "🔬", perm: null },
  { id: "cm", label: "پایش وضعیت (CM)", icon: "📈", perm: null },
  { id: "approvals", label: "تأییدها", icon: "🔐", perm: "approvals.decide" },
  { id: "users", label: "کاربران و نقش‌ها", icon: "👥", perm: "users.manage" },
  { id: "audit", label: "گزارش فعالیت", icon: "📝", perm: "audit.view" },
];

export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cmms_user")); } catch { return null; }
  });
  const [tab, setTab] = useState("dashboard");
  const [selectedMachine, setSelectedMachine] = useState(null);

  if (!user) return <Login onLogin={setUser} />;

  const visibleTabs = TABS.filter((t) => !t.perm || hasPerm(user, t.perm));
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : "dashboard";

  const doLogout = async () => {
    try { await invoke("logout"); } catch {}
    localStorage.removeItem("cmms_user");
    setUser(null);
  };

  return (
    <div className="min-h-screen flex" dir="rtl">
      <aside className="w-64 bg-slate-900/80 backdrop-blur border-l border-slate-700/50 flex flex-col no-print">
        <div className="flex items-center gap-3 p-5 border-b border-slate-700/50">
          <img src={logo} alt="logo" className="w-12 h-12 rounded-2xl shadow-lg ring-2 ring-cyan-400/40" />
          <h1 className="text-white font-bold text-sm leading-5">سامانه مدیریت تعمیر<br />ونگهداری (CMMS)</h1>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {visibleTabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium
                ${activeTab === t.id
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
        <div className="p-4 border-t border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-full bg-gradient-to-l from-cyan-400 to-blue-500 flex items-center justify-center text-white font-bold text-sm">
              {(user.full_name || user.username).charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-xs font-medium truncate">{user.full_name || user.username}</div>
              <div className="text-cyan-400/70 text-[10px]">{user.role_name}</div>
            </div>
          </div>
          <button onClick={doLogout} className="w-full text-xs bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white py-2 rounded-lg transition">
            خروج از حساب
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          {activeTab === "assets" && (
            <AssetManager user={user} selected={selectedMachine}
              onSelect={(m) => { setSelectedMachine(m); setTab("checklist"); }} />
          )}
          {activeTab === "checklist" && <Checklist user={user} machine={selectedMachine} />}
          {activeTab === "workorders" && <WorkOrder user={user} machine={selectedMachine} />}
          {activeTab === "approvals" && <Approvals user={user} />}
          {activeTab === "users" && <Users user={user} />}
          {activeTab === "pm" && <PM user={user} />}
          {activeTab === "inventory" && <Inventory user={user} />}
          {activeTab === "rca" && <RCA user={user} />}
          {activeTab === "dashboard" && <Dashboard />}
          {activeTab === "calendar" && <MaintenanceCalendar />}
          {activeTab === "cm" && <ConditionMonitoring user={user} />}
          {activeTab === "audit" && <AuditLog />}
        </div>
      </main>
    </div>
  );
}
