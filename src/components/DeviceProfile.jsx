import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

const EMPTY = {
  code: "", name: "", model: "", serial_number: "",
  manufacturer: "", manufacturer_phone: "", manufacturer_email: "", manufacturer_website: "",
  purchase_date: "", warranty_months: "", location: "", description: "",
};

export default function DeviceProfile({ selected, onSelect }) {
  const [machines, setMachines] = useState([]);
  const [form, setForm] = useState(EMPTY);

  const load = async () => setMachines(await invoke("get_machines"));
  useEffect(() => { load(); }, []);

  useEffect(() => { if (selected) setForm({ ...EMPTY, ...selected }); }, [selected]);

  const save = async () => {
    await invoke("save_machine", { machine: form });
    setForm(EMPTY);
    load();
  };

  const del = async (id) => { await invoke("delete_machine", { id }); load(); };

  const F = "w-full border rounded-lg p-2 mb-2";
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* فرم */}
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="font-bold text-lg mb-3">مشخصات دستگاه</h2>
        <div className="grid grid-cols-2 gap-2">
          <input className={F} placeholder="کد دستگاه *" value={form.code} onChange={set("code")} />
          <input className={F} placeholder="نام دستگاه *" value={form.name} onChange={set("name")} />
          <input className={F} placeholder="مدل" value={form.model} onChange={set("model")} />
          <input className={F} placeholder="شماره سریال" value={form.serial_number} onChange={set("serial_number")} />
          <input className={F} placeholder="سازنده" value={form.manufacturer} onChange={set("manufacturer")} />
          <input className={F} placeholder="تلفن سازنده" value={form.manufacturer_phone} onChange={set("manufacturer_phone")} />
          <input className={F} placeholder="ایمیل سازنده" value={form.manufacturer_email} onChange={set("manufacturer_email")} />
          <input className={F} placeholder="وب‌سایت سازنده" value={form.manufacturer_website} onChange={set("manufacturer_website")} />
          <input className={F} type="date" title="تاریخ خرید" value={form.purchase_date} onChange={set("purchase_date")} />
          <input className={F} type="number" placeholder="مدت گارانتی (ماه)" value={form.warranty_months} onChange={set("warranty_months")} />
          <input className={F} placeholder="محل نصب" value={form.location} onChange={set("location")} />
        </div>
        <textarea className={F} rows="2" placeholder="توضیحات" value={form.description} onChange={set("description")} />
        <div className="flex gap-2">
          <button onClick={save} className="bg-blue-600 text-white px-4 py-2 rounded-lg">ذخیره</button>
          <button onClick={() => setForm(EMPTY)} className="bg-slate-300 px-4 py-2 rounded-lg">جدید</button>
        </div>
      </div>

      {/* لیست */}
      <div className="bg-white rounded-xl shadow p-4">
        <h2 className="font-bold text-lg mb-3">دستگاه‌ها ({machines.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-right">
              <th className="p-2">کد</th><th className="p-2">نام</th><th className="p-2">گارانتی</th><th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => (
              <tr key={m.id} className="border-b hover:bg-slate-50">
                <td className="p-2 font-mono">{m.code}</td>
                <td className="p-2">{m.name}</td>
                <td className="p-2">
                  <span className={`px-2 py-1 rounded-full text-xs ${m.warranty_status === "معتبر" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {m.warranty_status}
                  </span>
                </td>
                <td className="p-2 flex gap-1">
                  <button onClick={() => onSelect(m)} className="text-blue-600">انتخاب</button>
                  <button onClick={() => del(m.id)} className="text-red-600">حذف</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
