import { useState } from "react";
import DeviceProfile from "./components/DeviceProfile.jsx";
import Checklist from "./components/Checklist.jsx";
import WorkOrder from "./components/WorkOrder.jsx";

const TABS = [
  { id: "devices", label: "پروفایل دستگاه‌ها" },
  { id: "checklist", label: "چک‌لیست‌ها" },
  { id: "workorders", label: "کارتابل تعمیرات" },
];

export default function App() {
  const [tab, setTab] = useState("devices");
  const [selectedMachine, setSelectedMachine] = useState(null);

  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white p-4 shadow">
        <h1 className="text-xl font-bold">سامانه مدیریت تعمیر و نگهداری (CMMS)</h1>
      </header>

      <nav className="flex gap-2 bg-white p-2 shadow-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg transition ${
              tab === t.id ? "bg-slate-800 text-white" : "bg-slate-100 hover:bg-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="p-4">
        {tab === "devices" && (
          <DeviceProfile
            selected={selectedMachine}
            onSelect={(m) => {
              setSelectedMachine(m);
              setTab("checklist");
            }}
          />
        )}
        {tab === "checklist" && <Checklist machine={selectedMachine} />}
        {tab === "workorders" && <WorkOrder machine={selectedMachine} />}
      </main>
    </div>
  );
}
