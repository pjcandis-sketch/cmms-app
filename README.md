# CMMS - سامانه مدیریت تعمیر و نگهداری

## راه‌اندازی
```bash
npm install
npm install -g @tauri-apps/cli   # یا npx tauri
npm run tauri dev                # حالت توسعه
npm run tauri build              # خروجی نصب‌کننده ویندوز
```

## معماری
- فرانت‌اند: React + Tailwind + Vite
- بک‌اند: Rust (Tauri v2)
- دیتابیس: SQLite (فایل `cmms.db` در AppData) با کتابخانه rusqlite

## ارتباط فرانت و بک‌اند
فرانت با `invoke("نام_کامند", {...})` از `@tauri-apps/api/core` به توابع `#[tauri::command]` در Rust صدا می‌زند.
