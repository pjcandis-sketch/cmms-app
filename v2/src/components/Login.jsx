import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import logo from "../assets/logo.png";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const u = await invoke("login", { username, password });
      localStorage.setItem("cmms_user", JSON.stringify(u));
      onLogin(u);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" dir="rtl">
      <form onSubmit={submit} className="bg-white/95 backdrop-blur rounded-3xl shadow-2xl p-8 w-full max-w-sm border border-white">
        <div className="text-center mb-6">
          <img src={logo} alt="logo" className="w-24 h-24 mx-auto rounded-3xl shadow-lg ring-4 ring-cyan-400/30" />
          <h1 className="font-bold text-lg text-slate-800 mt-4">سامانه مدیریت تعمیر و نگهداری</h1>
          <p className="text-xs text-slate-400 mt-1">CMMS — ورود به حساب کاربری</p>
        </div>
        <input className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
          placeholder="نام کاربری" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <input className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
          type="password" placeholder="رمز عبور" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-rose-500 text-xs mb-3 bg-rose-50 rounded-lg p-2">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full bg-gradient-to-l from-cyan-500 to-blue-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-cyan-500/30 hover:opacity-90 transition disabled:opacity-50">
          {loading ? "در حال ورود..." : "ورود"}
        </button>
        <p className="text-[11px] text-slate-400 text-center mt-4">حساب پیش‌فرض: admin / admin123</p>
      </form>
    </div>
  );
}
