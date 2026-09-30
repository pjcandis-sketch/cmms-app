import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { exportToExcel, printSection } from "../utils/export.js";
import { hasPerm } from "../utils/permissions.js";

const LEVELS = [
  { id: "site", label: "موقعیت / کارخانه", icon: "🏭", color: "bg-slate-600" },
  { id: "system", label: "سیستم / بخش", icon: "🧩", color: "bg-indigo-500" },
  { id: "equipment", label: "تجهیز", icon: "⚙️", color: "bg-cyan-500" },
  { id: "component", label: "قطعه / زیرمجموعه", icon: "🔩", color: "bg-teal-500" },
];
const CRITS = [
  { id: "A", label: "A - حیاتی", color: "bg-rose-500" },
  { id: "B", label: "B - مهم", color: "bg-orange-500" },
  { id: "C", label: "C - معمولی", color: "bg-amber-400" },
  { id: "D", label: "D - کم‌اهمیت", color: "bg-slate-400" },
];
const STATUSES = ["در حال بهره‌برداری", "تحت تعمیر", "خارج از سرویس", "استندبای", "اسقاط"];
const DOC_TYPES = ["کاتالوگ", "نقشه", "دفترچه راهنما", "گواهینامه", "دیتاشیت", "سایر"];

const EMPTY = {
  id: null, code: "", name: "", parent_id: null, level: "equipment",
  class_id: null, criticality: "C", status: STATUSES[0], location: "",
  serial_number: "", model: "", manufacturer: "", manufacturer_phone: "",
  manufacturer_email: "", manufacturer_website: "", purchase_date: "",
  warranty_months: "", commission_date: "", description: "", sort_order: 0,
};

export default function AssetManager({ user, selected, onSelect }) {
  const [assets, setAssets] = useState([]);
  const [classes, setClasses] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [specRows, setSpecRows] = useState([]);
  const [docs, setDocs] = useState([]);
  const [fieldHist, setFieldHist] = useState([]);
  const [docForm, setDocForm] = useState({ title: "", doc_type: DOC_TYPES[0], file_path: "" });
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});
  const canWrite = hasPerm(user, "devices.write");

  const load = async () => {
    setAssets(await invoke("get_assets"));
    setClasses(await invoke("get_asset_classes"));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (selected) fillForm(selected); }, [selected]);

  const fillForm = (a) => {
    setForm({ ...EMPTY, ...a, warranty_months: String(a.warranty_months ?? "") });
    setSpecRows(Object.entries(a.specs || {}).map(([k, v]) => ({ k, v: String(v) })));
    if (a.id) {
      invoke("get_asset_documents", { assetId: a.id }).then(setDocs).catch(() => {});
      invoke("get_field_history", { entityType: "asset", entityId: a.id }).then(setFieldHist).catch(() => {});
    } else { setDocs([]); setFieldHist([]); }
  };

  const save = async () => {
    const specs = {};
    specRows.forEach((r) => { if (r.k.trim()) specs[r.k.trim()] = r.v; });
    try {
      const id = await invoke("save_asset", { asset: { ...form, specs: JSON.stringify(specs) } });
      const newForm = { ...form, id };
      setForm(newForm);
      await load();
      alert("✅ ذخیره شد");
    } catch (e) { alert("خطا: " + e); }
  };

  const del = async () => {
    if (!form.id) return;
    if (!confirm("حذف این دارایی؟")) return;
    try { alert(await invoke("delete_asset", { id: form.id })); setForm(EMPTY); setDocs([]); load(); }
    catch (e) { alert(e); }
  };

  const pickDocFile = async () => {
    const p = await open({ multiple: false });
    if (p) setDocForm({ ...docForm, file_path: p });
  };
  const addDoc = async () => {
    if (!form.id) return alert("ابتدا دارایی را ذخیره کنید.");
    try {
      await invoke("save_asset_document", { doc: { ...docForm, asset_id: form.id, id: null } });
      setDocForm({ title: "", doc_type: DOC_TYPES[0], file_path: "" });
      setDocs(await invoke("get_asset_documents", { assetId: form.id }));
    } catch (e) { alert(e); }
  };
  const removeDoc = async (id) => {
    await invoke("delete_asset_document", { id });
    setDocs(await invoke("get_asset_documents", { assetId: form.id }));
  };

  // ساخت درخت + فیلتر جستجو
  const tree = useMemo(() => {
    const byParent = {};
    assets.forEach((a) => {
      const key = a.parent_id ?? 0;
      (byParent[key] = byParent[key] || []).push(a);
    });
    const match = (a) => !search || a.code.includes(search) || a.name.includes(search);
    const build = (pid, depth, ancestorMatch) => {
      const nodes = (byParent[pid] || []).map((a) => {
        const self = match(a);
        const children = build(a.id, depth + 1, ancestorMatch || self);
        const visible = self || children.length > 0;
        return { ...a, children, visible, selfMatch: self };
      });
      return nodes.filter((n) => n.visible);
    };
    return build(0, 0, false);
  }, [assets, search]);

  const parentOptions = assets.filter((a) => {
    const li = LEVELS.findIndex((l) => l.id === form.level);
    return LEVELS.findIndex((l) => l.id === a.level) === li - 1;
  });

  const F = "w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 transition";
  const critColor = (c) => (CRITS.find((x) => x.id === c)?.color) || "bg-slate-400";

  const renderNode = (n, depth) => (
    <div key={n.id}>
      <div
        onClick={() => { setExpanded({ ...expanded, [n.id]: !expanded[n.id] }); fillForm(n); }}
        className={`flex items-center gap-2 rounded-xl px-2 py-2 cursor-pointer transition text-sm
          ${form.id === n.id ? "bg-cyan-100 ring-1 ring-cyan-400" : "hover:bg-slate-100"}
          ${n.selfMatch ? "bg-amber-50" : ""}`}
        style={{ paddingRight: 8 + depth * 18 }}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${LEVELS.find((l) => l.id === n.level)?.color}`}></span>
        <span className="font-mono text-xs text-slate-400">{n.code}</span>
        <span className="font-medium truncate">{n.name}</span>
        {n.level === "equipment" && (
          <>
            <span className={`w-5 h-5 rounded-md text-white text-[10px] flex items-center justify-center font-bold ${critColor(n.criticality)}`}>{n.criticality}</span>
            <span className={`text-[10px] px-1.5 rounded-full ${n.warranty_status === "معتبر" ? "bg-emerald-100 text-emerald-700" : n.warranty_status === "منقضی" ? "bg-rose-100 text-rose-600" : "bg-slate-100 text-slate-400"}`}>{n.warranty_status}</span>
          </>
        )}
        {n.children_count > 0 && (
          <span className="mr-auto text-[10px] bg-slate-200 text-slate-500 rounded-full px-2">{n.children_count}</span>
        )}
      </div>
      {(expanded[n.id] || search) && n.children.map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
      {/* درخت دارایی‌ها */}
      <div className="xl:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-5 border border-white max-h-[78vh] flex flex-col">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-bold text-slate-800">🌳 سلسله‌مراتب دارایی‌ها</h2>
          <div className="flex gap-1.5 no-print">
            <button onClick={() => exportToExcel(assets, "دارایی‌ها", "assets")}
              className="text-[11px] bg-emerald-500 text-white px-2.5 py-1.5 rounded-lg hover:bg-emerald-600">📊 اکسل</button>
            <button onClick={() => printSection("asset-tree-print", "سلسله‌مراتب دارایی‌ها")}
              className="text-[11px] bg-slate-700 text-white px-2.5 py-1.5 rounded-lg hover:bg-slate-800">🖨️ چاپ</button>
          </div>
        </div>
        <input className={`${F} mb-3`} placeholder="🔍 جستجو (کد یا نام)..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div id="asset-tree-print" className="overflow-y-auto flex-1 space-y-0.5">
          {tree.map((n) => renderNode(n, 0))}
          {tree.length === 0 && <p className="text-slate-400 text-sm text-center py-6">دارایی‌ای یافت نشد.</p>}
        </div>
        <div className="flex gap-3 mt-3 pt-3 border-t border-slate-100 text-[10px] text-slate-500 flex-wrap">
          {LEVELS.map((l) => (
            <span key={l.id} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${l.color}`}></span>{l.label}</span>
          ))}
        </div>
      </div>

      {/* فرم */}
      <div className="xl:col-span-3 space-y-5 max-h-[78vh] overflow-y-auto pl-1">
        <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-lg text-slate-800">
              {form.id ? "✏️ ویرایش دارایی" : "➕ دارایی جدید"}
            </h2>
            {form.level === "equipment" && form.id && (
              <button onClick={() => onSelect(assets.find((a) => a.id === form.id))}
                className="text-xs bg-gradient-to-l from-cyan-500 to-blue-600 text-white px-3 py-1.5 rounded-lg shadow">
                انتخاب برای چک‌لیست / تعمیرات ←
              </button>
            )}
          </div>

          {/* سطح و کددهی */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <select className={F} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value, parent_id: null })}>
              {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.icon} {l.label}</option>)}
            </select>
            <input className={`${F} font-mono`} placeholder="کد دارایی * (مثل P-101)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <input className={F} placeholder="نام دارایی *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className={F} value={form.parent_id ?? ""} onChange={(e) => setForm({ ...form, parent_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{LEVELS.find((l) => l.id === form.level)?.id === "site" ? "(بدون والد)" : `والد (${LEVELS[Math.max(0, LEVELS.findIndex((l) => l.id === form.level) - 1)]?.label}) *`}</option>
              {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
            </select>
          </div>

          {/* طبقه‌بندی و وضعیت */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <select className={F} value={form.class_id ?? ""} onChange={(e) => setForm({ ...form, class_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">کلاس تجهیز (ISO 14224)</option>
              {[...new Set(classes.map((c) => c.category))].map((cat) => (
                <optgroup key={cat} label={cat}>
                  {classes.filter((c) => c.category === cat).map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
                </optgroup>
              ))}
            </select>
            <select className={F} value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })}>
              {CRITS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <select className={F} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <input className={F} type="number" placeholder="ترتیب نمایش" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
          </div>

          {/* مشخصات فنی */}
          <p className="text-xs font-bold text-slate-400 mt-3 mb-2">مشخصات فنی</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input className={F} placeholder="مدل" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input className={F} placeholder="شماره سریال" value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} />
            <input className={F} placeholder="محل نصب" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <label className="text-[11px] text-slate-400 flex items-center">کمیسیونینگ<input className={`${F} mr-2`} type="date" value={form.commission_date} onChange={(e) => setForm({ ...form, commission_date: e.target.value })} /></label>
            <label className="text-[11px] text-slate-400 flex items-center">تاریخ خرید<input className={`${F} mr-2`} type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></label>
            <input className={F} type="number" placeholder="گارانتی (ماه)" value={form.warranty_months} onChange={(e) => setForm({ ...form, warranty_months: e.target.value })} />
          </div>

          {/* سازنده */}
          <p className="text-xs font-bold text-slate-400 mt-3 mb-2">سازنده</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input className={F} placeholder="نام شرکت سازنده" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
            <input className={F} placeholder="تلفن" value={form.manufacturer_phone} onChange={(e) => setForm({ ...form, manufacturer_phone: e.target.value })} />
            <input className={F} placeholder="ایمیل" value={form.manufacturer_email} onChange={(e) => setForm({ ...form, manufacturer_email: e.target.value })} />
            <input className={F} placeholder="وب‌سایت" value={form.manufacturer_website} onChange={(e) => setForm({ ...form, manufacturer_website: e.target.value })} />
          </div>

          {/* مشخصات اضافی پویا */}
          <div className="flex justify-between items-center mt-3 mb-2">
            <p className="text-xs font-bold text-slate-400">مشخصات اضافی (کلید / مقدار)</p>
            <button onClick={() => setSpecRows([...specRows, { k: "", v: "" }])}
              className="text-[11px] bg-indigo-100 text-indigo-600 px-2.5 py-1 rounded-lg hover:bg-indigo-200">+ افزودن ویژگی</button>
          </div>
          {specRows.map((r, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input className={`${F} !mb-0`} placeholder="نام ویژگی (مثل توان، ظرفیت...)" value={r.k}
                onChange={(e) => setSpecRows(specRows.map((x, j) => j === i ? { ...x, k: e.target.value } : x))} />
              <input className={`${F} !mb-0`} placeholder="مقدار" value={r.v}
                onChange={(e) => setSpecRows(specRows.map((x, j) => j === i ? { ...x, v: e.target.value } : x))} />
              <button onClick={() => setSpecRows(specRows.filter((_, j) => j !== i))}
                className="text-rose-400 hover:text-rose-600 px-2 shrink-0">✕</button>
            </div>
          ))}

          <textarea className={F} rows="2" placeholder="توضیحات" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

          <div className="flex gap-2 mt-2 no-print">
            <button onClick={save} disabled={!canWrite}
              className="flex-1 bg-gradient-to-l from-cyan-500 to-blue-600 text-white py-2.5 rounded-xl font-medium shadow-lg shadow-cyan-500/30 hover:opacity-90 transition disabled:opacity-40">
              {form.id ? "ذخیره تغییرات" : "ایجاد دارایی"}
            </button>
            <button onClick={() => { setForm(EMPTY); setSpecRows([]); setDocs([]); setFieldHist([]); }} className="bg-slate-100 px-4 rounded-xl text-slate-600 hover:bg-slate-200">جدید</button>
            {form.id && (
              <button onClick={del} className="bg-rose-50 text-rose-600 px-4 rounded-xl hover:bg-rose-100 border border-rose-200">🗑 حذف</button>
            )}
          </div>
        </div>

        {/* مدارک فنی */}
        {form.id && (
          <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
            <h3 className="font-bold text-slate-800 mb-3">📎 مدارک فنی</h3>
            <div className="flex gap-2 mb-3">
              <input className={F} placeholder="عنوان مدرک" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} />
              <select className={`${F} !w-36`} value={docForm.doc_type} onChange={(e) => setDocForm({ ...docForm, doc_type: e.target.value })}>
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <button onClick={pickDocFile} className="bg-slate-200 text-slate-600 px-3 rounded-xl text-xs whitespace-nowrap hover:bg-slate-300">📁 انتخاب فایل</button>
            </div>
            {docForm.file_path && <p className="text-[11px] text-slate-400 mb-2 font-mono" dir="ltr">{docForm.file_path}</p>}
            <button onClick={addDoc} className="bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm hover:bg-indigo-600 transition">افزودن مدرک</button>
            <ul className="mt-3 space-y-1.5">
              {docs.map((d) => (
                <li key={d.id} className="flex justify-between items-center bg-slate-50 rounded-xl p-2.5 text-sm">
                  <div>
                    <span className="font-medium">{d.title}</span>
                    <span className="text-[10px] bg-indigo-100 text-indigo-600 rounded-full px-2 py-0.5 mr-2">{d.doc_type}</span>
                    {d.file_path && <span className="block text-[10px] text-slate-400 font-mono" dir="ltr">{d.file_path}</span>}
                  </div>
                  <button onClick={() => removeDoc(d.id)} className="text-rose-400 hover:text-rose-600 text-xs">حذف</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

        {/* تاریخچه تغییرات */}
        {form.id && fieldHist.length > 0 && (
          <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
            <h3 className="font-bold text-slate-800 mb-3">🕓 تاریخچه تغییرات</h3>
            <ul className="space-y-2 max-h-56 overflow-y-auto">
              {fieldHist.map((h) => (
                <li key={h.id} className="text-xs bg-slate-50 rounded-lg p-2.5 flex flex-wrap items-center gap-1">
                  <span className="font-medium">{h.field_name}:</span>
                  <span className="text-rose-500 line-through">{h.old_value || "—"}</span>
                  <span className="text-slate-300">←</span>
                  <span className="text-emerald-600">{h.new_value || "—"}</span>
                  <span className="mr-auto text-slate-400">{h.changed_by} · {h.created_at}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
