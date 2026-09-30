import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exportToExcel, printSection } from "../utils/export.js";
import { hasPerm } from "../utils/permissions.js";

const TXN_COLOR = { "دریافت": "text-emerald-600", "صدور": "text-rose-600", "برگشت": "text-blue-600", "تنظیم": "text-amber-600" };

export default function Inventory({ user }) {
  const [sub, setSub] = useState("stock");
  const [parts, setParts] = useState([]);
  const [machines, setMachines] = useState([]);
  const [orders, setOrders] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [txns, setTxns] = useState([]);
  const [partForm, setPartForm] = useState({ id: null, code: "", name: "", unit: "عدد", min_stock: 0 });
  const [inForm, setInForm] = useState({ quantity: "", note: "" });
  const [bomEq, setBomEq] = useState("");
  const [bom, setBom] = useState([]);
  const [bomForm, setBomForm] = useState({ part_id: "", quantity: 1, note: "" });
  const [resForm, setResForm] = useState({ part_id: "", work_order_id: "", quantity: 1, note: "" });
  const canWrite = hasPerm(user, "workorders.write");

  const load = async () => {
    setParts(await invoke("get_parts"));
    setMachines(await invoke("get_machines"));
    setOrders(await invoke("get_work_orders"));
    setReservations(await invoke("get_reservations"));
  };
  useEffect(() => { load(); }, []);

  const selectPart = async (p) => {
    setSelected(p);
    setPartForm({ id: p.id, code: p.code, name: p.name, unit: p.unit, min_stock: p.min_stock });
    setTxns(await invoke("get_stock_transactions", { partId: p.id }));
  };

  const savePart = async () => {
    try { await invoke("save_part", { part: partForm }); setPartForm({ id: null, code: "", name: "", unit: "عدد", min_stock: 0 }); load(); }
    catch (e) { alert(e); }
  };

  const stockIn = async () => {
    if (!selected || !inForm.quantity) return;
    try {
      await invoke("stock_in", { partId: selected.id, quantity: Number(inForm.quantity), note: inForm.note });
      setInForm({ quantity: "", note: "" });
      load(); selectPart({ ...selected });
    } catch (e) { alert(e); }
  };

  const loadBom = async (eq) => {
    setBomEq(eq);
    if (eq) setBom(await invoke("get_bom", { equipmentId: Number(eq) }));
    else setBom([]);
  };

  const reserve = async () => {
    try {
      await invoke("reserve_part", { partId: Number(resForm.part_id),
        workOrderId: resForm.work_order_id ? Number(resForm.work_order_id) : null,
        quantity: Number(resForm.quantity), note: resForm.note });
      setResForm({ part_id: "", work_order_id: "", quantity: 1, note: "" });
      load();
    } catch (e) { alert(e); }
  };

  const F = "w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400";

  return (
    <div className="space-y-5">
      <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-4 border border-white flex gap-2">
        {[["stock", "📦 موجودی و گردش"], ["bom", "🔗 BOM (دستور مصرف)"], ["reserve", "📌 رزروها"]].map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${sub === id ? "bg-gradient-to-l from-cyan-500 to-blue-600 text-white shadow-lg" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
            {label}
          </button>
        ))}
      </div>

      {sub === "stock" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white h-fit">
            <h2 className="font-bold text-lg mb-4 text-slate-800">{partForm.id ? "✏️ ویرایش قطعه" : "➕ قطعه جدید"}</h2>
            <input className={`${F} mb-2 font-mono`} placeholder="کد قطعه *" value={partForm.code} onChange={(e) => setPartForm({ ...partForm, code: e.target.value })} />
            <input className={`${F} mb-2`} placeholder="نام قطعه *" value={partForm.name} onChange={(e) => setPartForm({ ...partForm, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2 mb-3">
              <input className={F} placeholder="واحد" value={partForm.unit} onChange={(e) => setPartForm({ ...partForm, unit: e.target.value })} />
              <input className={F} type="number" placeholder="حداقل موجودی" value={partForm.min_stock} onChange={(e) => setPartForm({ ...partForm, min_stock: Number(e.target.value) })} />
            </div>
            <button onClick={savePart} disabled={!canWrite} className="w-full bg-gradient-to-l from-cyan-500 to-blue-600 text-white py-2.5 rounded-xl font-medium shadow disabled:opacity-40">ذخیره قطعه</button>

            {selected && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-2">📥 دریافت / خرید — {selected.name}</h3>
                <div className="flex gap-2 mb-2">
                  <input className={F} type="number" placeholder="مقدار" value={inForm.quantity} onChange={(e) => setInForm({ ...inForm, quantity: e.target.value })} />
                  <input className={F} placeholder="یادداشت (شماره رسید...)" value={inForm.note} onChange={(e) => setInForm({ ...inForm, note: e.target.value })} />
                </div>
                <button onClick={stockIn} disabled={!canWrite} className="w-full bg-emerald-500 text-white py-2 rounded-xl text-sm hover:bg-emerald-600 disabled:opacity-40">ثبت دریافت</button>
                <h3 className="text-sm font-bold text-slate-700 mb-2 mt-4">🕓 گردش اخیر</h3>
                <ul className="max-h-40 overflow-y-auto space-y-1">
                  {txns.map((t) => (
                    <li key={t.id} className="flex justify-between text-xs bg-slate-50 rounded-lg p-2">
                      <span className={TXN_COLOR[t.txn_type] || ""}>{t.txn_type}: {Number(t.quantity).toLocaleString("fa-IR")}</span>
                      <span className="text-slate-400">{t.note} · {t.created_at}</span>
                    </li>
                  ))}
                  {txns.length === 0 && <li className="text-slate-400 text-xs">گردشی ثبت نشده است.</li>}
                </ul>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-lg text-slate-800">موجودی قطعات ({parts.length})</h2>
              <div className="flex gap-2 no-print">
                <button onClick={() => exportToExcel(parts, "موجودی", "stock")}
                  className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-600">📊 اکسل</button>
                <button onClick={() => printSection("stock-table", "گزارش موجودی انبار")}
                  className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800">🖨️ چاپ</button>
              </div>
            </div>
            <div id="stock-table" className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
                  <th className="p-2">کد</th><th className="p-2">نام</th><th className="p-2">موجودی</th>
                  <th className="p-2">رزرو شده</th><th className="p-2">قابل دسترس</th><th className="p-2">وضعیت</th>
                </tr></thead>
                <tbody>
                  {parts.map((p) => {
                    const avail = p.stock - p.reserved;
                    const low = p.min_stock > 0 && avail <= p.min_stock;
                    return (
                      <tr key={p.id} onClick={() => selectPart(p)}
                        className={`border-b border-slate-50 cursor-pointer transition ${selected?.id === p.id ? "bg-cyan-50" : "hover:bg-slate-50"}`}>
                        <td className="p-2 font-mono text-cyan-700 font-semibold">{p.code}</td>
                        <td className="p-2 font-medium">{p.name}</td>
                        <td className="p-2 font-mono">{Number(p.stock).toLocaleString("fa-IR")} {p.unit}</td>
                        <td className="p-2 font-mono text-amber-600">{Number(p.reserved).toLocaleString("fa-IR")}</td>
                        <td className={`p-2 font-mono font-bold ${avail <= 0 ? "text-rose-600" : "text-emerald-600"}`}>{Number(avail).toLocaleString("fa-IR")}</td>
                        <td className="p-2">{low && <span className="bg-rose-100 text-rose-700 text-[10px] px-2 py-0.5 rounded-full">⚠️ کمتر از حد مجاز</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {sub === "bom" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white h-fit">
            <h2 className="font-bold text-lg mb-4 text-slate-800">🔗 BOM تجهیز</h2>
            <select className={`${F} mb-3`} value={bomEq} onChange={(e) => loadBom(e.target.value)}>
              <option value="">انتخاب تجهیز...</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.code} - {m.name}</option>)}
            </select>
            {bomEq && (
              <>
                <select className={`${F} mb-2`} value={bomForm.part_id} onChange={(e) => setBomForm({ ...bomForm, part_id: e.target.value })}>
                  <option value="">انتخاب قطعه...</option>
                  {parts.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                </select>
                <div className="flex gap-2 mb-2">
                  <input className={F} type="number" placeholder="تعداد در BOM" value={bomForm.quantity} onChange={(e) => setBomForm({ ...bomForm, quantity: e.target.value })} />
                  <input className={F} placeholder="یادداشت (پوزیشن...)" value={bomForm.note} onChange={(e) => setBomForm({ ...bomForm, note: e.target.value })} />
                </div>
                <button onClick={async () => {
                  if (!bomForm.part_id) return;
                  try {
                    await invoke("add_bom_item", { equipmentId: Number(bomEq), partId: Number(bomForm.part_id), quantity: Number(bomForm.quantity), note: bomForm.note });
                    setBomForm({ part_id: "", quantity: 1, note: "" });
                    loadBom(bomEq);
                  } catch (e) { alert(e); }
                }} disabled={!canWrite} className="w-full bg-indigo-500 text-white py-2 rounded-xl text-sm hover:bg-indigo-600 disabled:opacity-40">+ افزودن به BOM</button>
                <p className="text-[11px] text-slate-400 mt-3 leading-5">💡 در صورت تکرار قطعه، تعداد به‌صورت خودکار جمع می‌شود.</p>
              </>
            )}
          </div>
          <div className="lg:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
            <h2 className="font-bold text-lg mb-4 text-slate-800">دستور مصرف ({bom.length} قلم)</h2>
            {bomEq && bom.length === 0 && <p className="text-slate-400 text-sm">برای این تجهیز BOM تعریف نشده است.</p>}
            <table className="w-full text-sm">
              <tbody>
                {bom.map((b) => (
                  <tr key={b.id} className="border-b border-slate-50">
                    <td className="p-2 font-mono text-indigo-700 font-semibold">{b.code}</td>
                    <td className="p-2 font-medium">{b.name}</td>
                    <td className="p-2 text-xs text-slate-500">{b.quantity} {b.unit}</td>
                    <td className="p-2 text-xs text-slate-400">{b.note}</td>
                    <td className="p-2"><button onClick={async () => { await invoke("remove_bom_item", { id: b.id }); loadBom(bomEq); }}
                      className="text-rose-400 hover:text-rose-600 text-xs">حذف</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sub === "reserve" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white h-fit">
            <h2 className="font-bold text-lg mb-4 text-slate-800">📌 رزرو جدید</h2>
            <select className={`${F} mb-2`} value={resForm.part_id} onChange={(e) => setResForm({ ...resForm, part_id: e.target.value })}>
              <option value="">قطعه *</option>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name} (قابل دسترس: {Number(p.stock - p.reserved).toLocaleString("fa-IR")})</option>)}
            </select>
            <select className={`${F} mb-2`} value={resForm.work_order_id} onChange={(e) => setResForm({ ...resForm, work_order_id: e.target.value })}>
              <option value="">بدون دستورکار (رزرو عمومی)</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.wo_number} - {o.machine_name}</option>)}
            </select>
            <div className="flex gap-2 mb-3">
              <input className={F} type="number" placeholder="مقدار" value={resForm.quantity} onChange={(e) => setResForm({ ...resForm, quantity: e.target.value })} />
              <input className={F} placeholder="یادداشت" value={resForm.note} onChange={(e) => setResForm({ ...resForm, note: e.target.value })} />
            </div>
            <button onClick={reserve} disabled={!canWrite} className="w-full bg-gradient-to-l from-amber-500 to-orange-500 text-white py-2.5 rounded-xl font-medium shadow disabled:opacity-40">ثبت رزرو</button>
          </div>
          <div className="lg:col-span-2 bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6 border border-white">
            <h2 className="font-bold text-lg mb-4 text-slate-800">رزروها ({reservations.length})</h2>
            <table className="w-full text-sm">
              <thead><tr className="border-b-2 border-slate-100 text-right text-slate-500 text-xs">
                <th className="p-2">قطعه</th><th className="p-2">مقدار</th><th className="p-2">دستورکار</th>
                <th className="p-2">وضعیت</th><th className="p-2"></th>
              </tr></thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="p-2"><span className="font-mono text-xs">{r.code}</span> {r.name}</td>
                    <td className="p-2 font-mono">{Number(r.quantity).toLocaleString("fa-IR")} {r.unit}</td>
                    <td className="p-2 text-xs text-slate-500 font-mono">{r.wo_number || "—"}</td>
                    <td className="p-2"><span className={`text-[11px] px-2 py-0.5 rounded-full ${r.status === "رزرو شده" ? "bg-amber-100 text-amber-700" : r.status === "صدور شده" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{r.status}</span></td>
                    <td className="p-2">
                      {r.status === "رزرو شده" && (
                        <div className="flex gap-2 text-xs no-print">
                          <button onClick={async () => { try { await invoke("set_reservation_status", { id: r.id, status: "صدور شده" }); load(); } catch (e) { alert(e); } }}
                            className="text-emerald-600 hover:underline">صدور</button>
                          <button onClick={async () => { await invoke("set_reservation_status", { id: r.id, status: "لغو شده" }); load(); }}
                            className="text-rose-500 hover:underline">لغو</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {reservations.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-slate-400">رزروی ثبت نشده است.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
