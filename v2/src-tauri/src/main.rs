//! CMMS — سامانه مدیریت تعمیر و نگهداری (نسخه صنعتی)
//! Tauri v2 + Rust + SQLite (rusqlite)
//!
//! معماری:
//!   - `Db`: وضعیت سراسری — conn (دیتابیس) + user (نشست جاری). ترتیب قفل: همیشه user سپس conn.
//!   - مایگریشن در `migrate()`: ساخت جدول‌ها + ارتقای جدول‌های موجود (PRAGMA/ALTER) + داده اولیه.
//!   - `machines` (سازگاری با ماژول‌های قدیمی) از طریق ۴ trigger با `assets` همگام می‌شود.
//!   - تمام رویدادهای مهم در `audit_log` ثبت می‌شوند (log_audit).
//!   - اعتبارسنجی دسترسی با require_perm بر اساس نقش کاربر جاری.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

const PERM_DEVICES: &str = "devices.write";
const PERM_CHECKLIST: &str = "checklist.write";
const PERM_WORKORDERS: &str = "workorders.write";
const PERM_USERS: &str = "users.manage";
const PERM_APPROVE: &str = "approvals.decide";
const PERM_AUDIT: &str = "audit.view";

struct Db {
    conn: Mutex<Connection>,
    user: Mutex<Option<LoggedUser>>,
}

// ---------- مدل‌ها ----------
#[derive(Serialize, Clone)]
struct LoggedUser {
    id: i64,
    username: String,
    full_name: String,
    role_name: String,
    permissions: Vec<String>,
}

#[derive(Serialize)]
struct Machine {
    id: i64,
    code: String,
    name: String,
    model: String,
    serial_number: String,
    manufacturer: String,
    manufacturer_phone: String,
    manufacturer_email: String,
    manufacturer_website: String,
    purchase_date: String,
    warranty_months: i64,
    location: String,
    description: String,
    warranty_status: String,
}


#[derive(Serialize)]
struct ChecklistItem {
    id: i64,
    description: String,
}

#[derive(Serialize, Clone)]
struct WorkOrder {
    id: i64,
    wo_number: String,
    machine_id: i64,
    machine_name: String,
    description: String,
    priority: String,
    status: String,
    assigned_to: String,
    wo_type: String,
    failure_mode: String,
    cause: String,
    action_taken: String,
    start_date: String,
    end_date: String,
    labor_hours: f64,
    cost: f64,
    requested_by: String,
    completed_by: String,
    created_at: String,
}

#[derive(Deserialize)]
struct WorkOrderInput {
    description: String,
    #[serde(default)] priority: String,
    #[serde(default)] assigned_to: String,
    #[serde(default)] wo_type: String,
    #[serde(default)] failure_mode: String,
    #[serde(default)] cause: String,
    #[serde(default)] action_taken: String,
    #[serde(default)] start_date: String,
    #[serde(default)] end_date: String,
    #[serde(default)] labor_hours: f64,
    #[serde(default)] cost: f64,
}

const WO_STATUSES: [&str; 6] = ["درخواست", "تأیید شده", "در حال انجام", "تکمیل شده", "بسته شده", "لغو شده"];

fn allowed_transitions(from: &str) -> &'static [&'static str] {
    match from {
        "درخواست" => &["تأیید شده", "لغو شده"],
        "تأیید شده" => &["در حال انجام", "لغو شده"],
        "در حال انجام" => &["تکمیل شده", "لغو شده"],
        "تکمیل شده" => &["بسته شده", "در حال انجام"],
        _ => &[],
    }
}

#[derive(Serialize)]
struct WoHistoryRow {
    id: i64,
    from_status: String,
    to_status: String,
    note: String,
    changed_by: String,
    created_at: String,
}

#[derive(Serialize)]
struct FieldHistoryRow {
    id: i64,
    field_name: String,
    old_value: String,
    new_value: String,
    changed_by: String,
    created_at: String,
}

#[derive(Serialize)]
struct Part {
    id: i64,
    code: String,
    name: String,
    unit: String,
    min_stock: f64,
    stock: f64,
    reserved: f64,
}

#[derive(Deserialize)]
struct PartInput {
    id: Option<i64>,
    code: String,
    name: String,
    #[serde(default)] unit: String,
    #[serde(default)] min_stock: f64,
}

#[derive(Serialize)]
struct StockTxnRow {
    id: i64,
    txn_type: String,
    quantity: f64,
    ref_type: String,
    ref_id: i64,
    note: String,
    created_by: String,
    created_at: String,
}

#[derive(Serialize)]
struct ReservationRow {
    id: i64,
    part_id: i64,
    code: String,
    name: String,
    unit: String,
    work_order_id: Option<i64>,
    wo_number: String,
    quantity: f64,
    status: String,
    note: String,
    created_by: String,
    created_at: String,
}

#[derive(Serialize)]
struct BomItem {
    id: i64,
    part_id: i64,
    code: String,
    name: String,
    unit: String,
    quantity: f64,
    note: String,
}

#[derive(Serialize)]
struct PartUsage {
    id: i64,
    part_id: i64,
    code: String,
    name: String,
    unit: String,
    quantity: f64,
    unit_price: f64,
    total: f64,
}

fn log_field_change(conn: &Connection, entity_type: &str, entity_id: i64,
                    field: &str, old_v: &str, new_v: &str, by: &str) {
    if old_v != new_v {
        let _ = conn.execute(
            "INSERT INTO field_history (entity_type, entity_id, field_name, old_value, new_value, changed_by) VALUES (?1,?2,?3,?4,?5,?6)",
            params![entity_type, entity_id, field, old_v, new_v, by],
        );
    }
}

// ---- کاربران و نقش‌ها ----
#[derive(Serialize)]
struct UserRow {
    id: i64,
    username: String,
    full_name: String,
    role_name: String,
    role_id: i64,
    is_active: bool,
    created_at: String,
}

#[derive(Deserialize)]
struct UserInput {
    id: Option<i64>,
    username: String,
    full_name: String,
    password: Option<String>,
    role_id: i64,
    #[serde(default)] is_active: bool,
}

#[derive(Serialize, Clone)]
struct Role {
    id: i64,
    name: String,
    permissions: Vec<String>,
}

#[derive(Deserialize)]
struct RoleInput {
    id: Option<i64>,
    name: String,
    permissions: Vec<String>,
}

// ---- تأییدها ----
#[derive(Serialize)]
struct ApprovalRow {
    id: i64,
    action: String,
    entity_type: String,
    entity_id: i64,
    entity_label: String,
    status: String,
    requested_by: String,
    created_at: String,
    decided_by: String,
    decided_at: String,
    note: String,
}

// ---- گزارش فعالیت ----
#[derive(Serialize)]
struct AuditRow {
    id: i64,
    username: String,
    action: String,
    entity_type: String,
    entity_id: i64,
    details: String,
    created_at: String,
}

// ---------- ابزارها ----------
fn hash_password(password: &str, salt: &str) -> String {
    let mut h = Sha256::new();
    h.update(format!("{}:{}", salt, password));
    format!("{:x}", h.finalize())
}

fn current_user(db: &State<Db>) -> Result<LoggedUser, String> {
    db.user.lock().map_err(|e| e.to_string())?
        .clone().ok_or_else(|| "ابتدا وارد حساب کاربری شوید.".to_string())
}

fn require_perm(db: &State<Db>, perm: &str) -> Result<LoggedUser, String> {
    let u = current_user(db)?;
    if u.permissions.iter().any(|p| p == "*" || p == perm) {
        Ok(u)
    } else {
        Err("دسترسی لازم برای این عملیات را ندارید.".to_string())
    }
}

fn log_audit(conn: &Connection, user: Option<&LoggedUser>, action: &str,
             entity_type: &str, entity_id: i64, details: &str) {
    let (uid, uname) = match user {
        Some(u) => (u.id, u.username.clone()),
        None => (-1, "system".to_string()),
    };
    let _ = conn.execute(
        "INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?1,?2,?3,?4,?5,?6)",
        params![uid, uname, action, entity_type, entity_id, details],
    );
}

// ---------- مایگریشن ----------
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("
    CREATE TABLE IF NOT EXISTS machines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        model TEXT DEFAULT '',
        serial_number TEXT DEFAULT '',
        manufacturer TEXT DEFAULT '',
        manufacturer_phone TEXT DEFAULT '',
        manufacturer_email TEXT DEFAULT '',
        manufacturer_website TEXT DEFAULT '',
        purchase_date TEXT DEFAULT '',
        warranty_months INTEGER DEFAULT 0,
        location TEXT DEFAULT '',
        description TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
        check_type TEXT NOT NULL,
        description TEXT NOT NULL,
        UNIQUE(machine_id, check_type, description)
    );

    CREATE TABLE IF NOT EXISTS checklist_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        machine_id INTEGER NOT NULL REFERENCES machines(id),
        check_type TEXT NOT NULL,
        performed_by TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checklist_record_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id INTEGER NOT NULL REFERENCES checklist_records(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL,
        is_ok INTEGER DEFAULT 1,
        note TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS work_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        machine_id INTEGER NOT NULL REFERENCES machines(id),
        wo_number TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        priority TEXT DEFAULT 'متوسط',
        status TEXT DEFAULT 'باز',
        assigned_to TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        unit TEXT DEFAULT 'عدد'
    );

    CREATE TABLE IF NOT EXISTS work_order_parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        part_id INTEGER NOT NULL REFERENCES parts(id),
        quantity REAL DEFAULT 1,
        unit_price REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        permissions TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        full_name TEXT DEFAULT '',
        password_hash TEXT NOT NULL,
        role_id INTEGER NOT NULL REFERENCES roles(id),
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        entity_label TEXT DEFAULT '',
        status TEXT DEFAULT 'در انتظار',
        requested_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        decided_by TEXT DEFAULT '',
        decided_at TEXT DEFAULT '',
        note TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT -1,
        username TEXT DEFAULT '',
        action TEXT NOT NULL,
        entity_type TEXT DEFAULT '',
        entity_id INTEGER DEFAULT 0,
        details TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS asset_classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        parent_id INTEGER REFERENCES assets(id),
        level TEXT NOT NULL DEFAULT 'equipment',
        class_id INTEGER REFERENCES asset_classes(id),
        criticality TEXT DEFAULT 'C',
        status TEXT DEFAULT 'در حال بهره‌برداری',
        location TEXT DEFAULT '',
        serial_number TEXT DEFAULT '',
        model TEXT DEFAULT '',
        manufacturer TEXT DEFAULT '',
        manufacturer_phone TEXT DEFAULT '',
        manufacturer_email TEXT DEFAULT '',
        manufacturer_website TEXT DEFAULT '',
        purchase_date TEXT DEFAULT '',
        warranty_months INTEGER DEFAULT 0,
        commission_date TEXT DEFAULT '',
        description TEXT DEFAULT '',
        specs TEXT DEFAULT '{}',
        path TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS work_order_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        from_status TEXT DEFAULT '',
        to_status TEXT NOT NULL,
        note TEXT DEFAULT '',
        changed_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS field_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        field_name TEXT NOT NULL,
        old_value TEXT DEFAULT '',
        new_value TEXT DEFAULT '',
        changed_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_fh_entity ON field_history(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_woh ON work_order_history(work_order_id);

    CREATE TABLE IF NOT EXISTS job_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        estimated_hours REAL DEFAULT 0,
        safety_notes TEXT DEFAULT '',
        tools TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_plan_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_plan_id INTEGER NOT NULL REFERENCES job_plans(id) ON DELETE CASCADE,
        order_index INTEGER DEFAULT 0,
        description TEXT NOT NULL,
        estimated_minutes INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS job_plan_parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_plan_id INTEGER NOT NULL REFERENCES job_plans(id) ON DELETE CASCADE,
        part_id INTEGER NOT NULL REFERENCES parts(id),
        quantity REAL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS pm_programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        asset_id INTEGER NOT NULL REFERENCES assets(id),
        job_plan_id INTEGER REFERENCES job_plans(id),
        interval_value REAL NOT NULL DEFAULT 1,
        interval_unit TEXT NOT NULL DEFAULT 'month',
        next_due_date TEXT DEFAULT '',
        last_done_date TEXT DEFAULT '',
        next_due_meter REAL,
        last_done_meter REAL,
        assignee TEXT DEFAULT '',
        priority TEXT DEFAULT 'متوسط',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meter_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        value REAL NOT NULL,
        note TEXT DEFAULT '',
        recorded_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pm_asset ON pm_programs(asset_id);
    CREATE INDEX IF NOT EXISTS idx_meter_asset ON meter_readings(asset_id);

    CREATE TABLE IF NOT EXISTS stock_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        part_id INTEGER NOT NULL REFERENCES parts(id),
        txn_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        ref_type TEXT DEFAULT '',
        ref_id INTEGER DEFAULT 0,
        note TEXT DEFAULT '',
        created_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        part_id INTEGER NOT NULL REFERENCES parts(id),
        work_order_id INTEGER REFERENCES work_orders(id),
        quantity REAL NOT NULL,
        status TEXT DEFAULT 'رزرو شده',
        note TEXT DEFAULT '',
        created_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        fulfilled_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS bom_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        equipment_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        part_id INTEGER NOT NULL REFERENCES parts(id),
        quantity REAL DEFAULT 1,
        note TEXT DEFAULT '',
        UNIQUE(equipment_id, part_id)
    );

    CREATE TABLE IF NOT EXISTS rcas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_order_id INTEGER REFERENCES work_orders(id),
        title TEXT NOT NULL,
        failure_mode TEXT DEFAULT '',
        failure_cause TEXT DEFAULT '',
        consequence TEXT DEFAULT '',
        method TEXT DEFAULT '5 Why',
        status TEXT DEFAULT 'باز',
        created_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS rca_whys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rca_id INTEGER NOT NULL REFERENCES rcas(id) ON DELETE CASCADE,
        step INTEGER NOT NULL,
        answer TEXT DEFAULT '',
        UNIQUE(rca_id, step)
    );

    CREATE TABLE IF NOT EXISTS rca_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rca_id INTEGER NOT NULL REFERENCES rcas(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        responsible TEXT DEFAULT '',
        due_date TEXT DEFAULT '',
        status TEXT DEFAULT 'باز'
    );

    CREATE INDEX IF NOT EXISTS idx_stock_part ON stock_transactions(part_id);
    CREATE INDEX IF NOT EXISTS idx_res_part ON reservations(part_id);
    CREATE INDEX IF NOT EXISTS idx_bom_eq ON bom_items(equipment_id);

    CREATE TABLE IF NOT EXISTS condition_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        parameter TEXT DEFAULT 'لرزش',
        unit TEXT DEFAULT '',
        warning_limit REAL,
        alarm_limit REAL,
        direction TEXT DEFAULT 'up',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS condition_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        point_id INTEGER NOT NULL REFERENCES condition_points(id) ON DELETE CASCADE,
        value REAL NOT NULL,
        note TEXT DEFAULT '',
        measured_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cp_asset ON condition_points(asset_id);
    CREATE INDEX IF NOT EXISTS idx_cr_point ON condition_readings(point_id);

    CREATE TABLE IF NOT EXISTS asset_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        doc_type TEXT DEFAULT 'کاتالوگ',
        file_path TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_assets_parent ON assets(parent_id);
    CREATE INDEX IF NOT EXISTS idx_assets_path ON assets(path);
    CREATE INDEX IF NOT EXISTS idx_assets_level ON assets(level);

    -- sync: equipment rows mirror into legacy machines table (checklist/work_orders keep working)
    CREATE TRIGGER IF NOT EXISTS trg_assets_ins AFTER INSERT ON assets
    WHEN NEW.level = 'equipment'
    BEGIN
        INSERT OR REPLACE INTO machines (id, code, name, model, serial_number, manufacturer,
            manufacturer_phone, manufacturer_email, manufacturer_website,
            purchase_date, warranty_months, location, description)
        VALUES (NEW.id, NEW.code, NEW.name, NEW.model, NEW.serial_number, NEW.manufacturer,
            NEW.manufacturer_phone, NEW.manufacturer_email, NEW.manufacturer_website,
            NEW.purchase_date, NEW.warranty_months, NEW.location, NEW.description);
    END;

    CREATE TRIGGER IF NOT EXISTS trg_assets_upd AFTER UPDATE ON assets
    WHEN NEW.level = 'equipment'
    BEGIN
        INSERT OR REPLACE INTO machines (id, code, name, model, serial_number, manufacturer,
            manufacturer_phone, manufacturer_email, manufacturer_website,
            purchase_date, warranty_months, location, description)
        VALUES (NEW.id, NEW.code, NEW.name, NEW.model, NEW.serial_number, NEW.manufacturer,
            NEW.manufacturer_phone, NEW.manufacturer_email, NEW.manufacturer_website,
            NEW.purchase_date, NEW.warranty_months, NEW.location, NEW.description);
    END;

    CREATE TRIGGER IF NOT EXISTS trg_assets_del_equip AFTER UPDATE ON assets
    WHEN OLD.level = 'equipment' AND NEW.level != 'equipment'
    BEGIN
        DELETE FROM machines WHERE id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_assets_del AFTER DELETE ON assets
    BEGIN
        DELETE FROM machines WHERE id = OLD.id;
    END;

    -- backfill: migrate existing machines into assets as equipment
    INSERT OR IGNORE INTO assets (id, code, name, parent_id, level, location, serial_number,
        model, manufacturer, manufacturer_phone, manufacturer_email, manufacturer_website,
        purchase_date, warranty_months, description, path)
    SELECT id, code, name, NULL, 'equipment', location, serial_number,
        model, manufacturer, manufacturer_phone, manufacturer_email, manufacturer_website,
        purchase_date, warranty_months, description, '/' || code
    FROM machines;
    ")?;

    conn.execute("UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM assets) WHERE name='assets'", []).ok();
    conn.execute("INSERT INTO sqlite_sequence (name, seq) SELECT 'assets', (SELECT MAX(id) FROM assets) WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='assets')", []).ok();

    // ارتقای جدول work_orders برای چرخه کامل دستورکار (دیتابیس‌های موجود)
    let wo_cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(work_orders)")?;
        let rows = stmt.query_map([], |r| r.get(1))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let new_cols = [
        ("wo_type", "ALTER TABLE work_orders ADD COLUMN wo_type TEXT DEFAULT 'برنامه‌ریزی‌شده'"),
        ("failure_mode", "ALTER TABLE work_orders ADD COLUMN failure_mode TEXT DEFAULT ''"),
        ("cause", "ALTER TABLE work_orders ADD COLUMN cause TEXT DEFAULT ''"),
        ("action_taken", "ALTER TABLE work_orders ADD COLUMN action_taken TEXT DEFAULT ''"),
        ("start_date", "ALTER TABLE work_orders ADD COLUMN start_date TEXT DEFAULT ''"),
        ("end_date", "ALTER TABLE work_orders ADD COLUMN end_date TEXT DEFAULT ''"),
        ("labor_hours", "ALTER TABLE work_orders ADD COLUMN labor_hours REAL DEFAULT 0"),
        ("cost", "ALTER TABLE work_orders ADD COLUMN cost REAL DEFAULT 0"),
        ("requested_by", "ALTER TABLE work_orders ADD COLUMN requested_by TEXT DEFAULT ''"),
        ("completed_by", "ALTER TABLE work_orders ADD COLUMN completed_by TEXT DEFAULT ''"),
        ("pm_program_id", "ALTER TABLE work_orders ADD COLUMN pm_program_id INTEGER"),
        ("min_stock", "ALTER TABLE parts ADD COLUMN min_stock REAL DEFAULT 0"),
        ("condition_point_id", "ALTER TABLE work_orders ADD COLUMN condition_point_id INTEGER"),
    ];
    for (col, ddl) in new_cols {
        if !wo_cols.iter().any(|c| c == col) {
            conn.execute(ddl, []).ok();
        }
    }
    conn.execute("UPDATE work_orders SET status='درخواست' WHERE status='باز'", []).ok();

    // طبقه‌بندی استاندارد تجهیزات (الهام از ISO 14224)
    let classes = [
        ("PM", "پمپ", "دوار"), ("GB", "گیربکس", "دوار"), ("CM", "کمپرسور", "دوار"),
        ("TU", "توربین", "دوار"), ("EN", "موتور احتراقی", "دوار"), ("FN", "فن / بلوئر", "دوار"),
        ("TK", "مخزن", "ایستا"), ("HE", "مبدل حرارتی", "ایستا"), ("RE", "رآکتور / ستون", "ایستا"),
        ("PP", "لوله و اتصالات", "ایستا"), ("VL", "شیرآلات صنعتی", "ایستا"),
        ("EM", "موتور الکتریکی", "برقی"), ("TR", "ترانسفورماتور", "برقی"),
        ("PN", "تابلو برق", "برقی"), ("GN", "ژنراتور", "برقی"), ("UP", "یوپی‌اس / باتری", "برقی"),
        ("TX", "ترانسمیتر", "ابزاردقیق"), ("AN", "آنالایزر", "ابزاردقیق"),
        ("CV", "شیر کنترلی", "ابزاردقیق"), ("IN", "سایر ابزار دقیق", "ابزاردقیق"),
        ("RV", "شیر اطمینان", "ایمنی"), ("FS", "سیستم اطفاء حریق", "ایمنی"),
        ("SD", "سیستم قطع اضطراری", "ایمنی"),
        ("BL", "دیگ بخار", "تاسیسات"), ("CH", "چیلر", "تاسیسات"),
        ("WT", "تصفیه آب", "تاسیسات"), ("AC", "تهویه مطبوع", "تاسیسات"),
        ("XX", "سایر", "عمومی"),
    ];
    for (code, name, cat) in classes {
        conn.execute(
            "INSERT INTO asset_classes (code, name, category) SELECT ?1, ?2, ?3 WHERE NOT EXISTS (SELECT 1 FROM asset_classes WHERE code = ?1)",
            params![code, name, cat],
        )?;
    }

    // داده اولیه: نقش‌ها و کاربر admin
    if conn.query_row("SELECT COUNT(*) FROM roles", [], |r| r.get::<_, i64>(0))? == 0 {
        conn.execute("INSERT INTO roles (name, permissions) VALUES ('مدیر سیستم', '[\"*\"]')", [])?;
        conn.execute("INSERT INTO roles (name, permissions) VALUES ('سرپرست',
            '[\"devices.write\",\"checklist.write\",\"workorders.write\",\"approvals.decide\"]')", [])?;
        conn.execute("INSERT INTO roles (name, permissions) VALUES ('اپراتور',
            '[\"checklist.write\",\"workorders.write\"]')", [])?;
    }
    if conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get::<_, i64>(0))? == 0 {
        let salt = "cmms-default-salt";
        conn.execute(
            "INSERT INTO users (username, full_name, password_hash, role_id) VALUES ('admin', 'مدیر سیستم', ?1, 1)",
            params![hash_password("admin123", salt)],
        )?;
    }
    Ok(())
}

fn map_user(row: &rusqlite::Row) -> rusqlite::Result<LoggedUser> {
    let perms_str: String = row.get(4)?;
    let permissions: Vec<String> = serde_json::from_str(&perms_str).unwrap_or_default();
    Ok(LoggedUser {
        id: row.get(0)?,
        username: row.get(1)?,
        full_name: row.get(2)?,
        role_name: row.get(3)?,
        permissions,
    })
}

// ---------- احراز هویت ----------
#[tauri::command]
fn login(db: State<Db>, username: String, password: String) -> Result<LoggedUser, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let user = conn.query_row(
        "SELECT u.id, u.username, u.full_name, r.name, r.permissions
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.username = ?1 AND u.is_active = 1",
        params![username],
        map_user,
    ).map_err(|_| "نام کاربری یا رمز عبور اشتباه است.".to_string())?;

    let hash: String = conn.query_row(
        "SELECT password_hash FROM users WHERE id = ?1", params![user.id], |r| r.get(0)
    ).map_err(|e| e.to_string())?;
    if hash != hash_password(&password, "cmms-default-salt") {
        return Err("نام کاربری یا رمز عبور اشتباه است.".to_string());
    }
    log_audit(&conn, Some(&user), "login", "session", user.id, "ورود به سیستم");
    drop(conn); // رهاسازی قفل conn قبل از قفل user — ترتیب یکنواخت قفل‌ها (user ← conn)
    *db.user.lock().map_err(|e| e.to_string())? = Some(user.clone());
    Ok(user)
}

#[tauri::command]
fn logout(db: State<Db>) -> Result<(), String> {
    let u = current_user(&db).ok();
    if let Ok(conn) = db.conn.lock() {
        log_audit(&conn, u.as_ref(), "logout", "session", u.as_ref().map(|x| x.id).unwrap_or(-1), "خروج از سیستم");
    }
    *db.user.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
fn get_current_user(db: State<Db>) -> Result<Option<LoggedUser>, String> {
    Ok(db.user.lock().map_err(|e| e.to_string())?.clone())
}

// ---------- دستگاه‌ها ----------
#[tauri::command]
fn get_machines(db: State<Db>) -> Result<Vec<Machine>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, code, name, model, serial_number, manufacturer, manufacturer_phone,
                manufacturer_email, manufacturer_website, purchase_date, warranty_months,
                location, description FROM machines ORDER BY code"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        let months: i64 = row.get(10)?;
        let purchase: String = row.get(9)?;
        // منطق گارانتی مشترک در calc_warranty_status نگهداری می‌شود
        let warranty_status = calc_warranty_status(&purchase, months);
        Ok(Machine {
            id: row.get(0)?, code: row.get(1)?, name: row.get(2)?,
            model: row.get(3)?, serial_number: row.get(4)?, manufacturer: row.get(5)?,
            manufacturer_phone: row.get(6)?, manufacturer_email: row.get(7)?,
            manufacturer_website: row.get(8)?, purchase_date: purchase,
            warranty_months: months, location: row.get(11)?, description: row.get(12)?,
            warranty_status,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

const LEVELS: [&str; 4] = ["site", "system", "equipment", "component"];
const CRITICALITIES: [&str; 4] = ["A", "B", "C", "D"];
const ASSET_STATUSES: [&str; 5] = ["در حال بهره‌برداری", "تحت تعمیر", "خارج از سرویس", "استندبای", "اسقاط"];

// ---- دارایی‌ها (مدل استاندارد + سلسله‌مراتب) ----
#[derive(Serialize)]
struct AssetClass {
    id: i64,
    code: String,
    name: String,
    category: String,
}

#[derive(Serialize)]
struct AssetRow {
    id: i64,
    code: String,
    name: String,
    parent_id: Option<i64>,
    level: String,
    class_id: Option<i64>,
    class_name: String,
    criticality: String,
    status: String,
    location: String,
    serial_number: String,
    model: String,
    manufacturer: String,
    manufacturer_phone: String,
    manufacturer_email: String,
    manufacturer_website: String,
    purchase_date: String,
    warranty_months: i64,
    commission_date: String,
    description: String,
    specs: serde_json::Value,
    path: String,
    sort_order: i64,
    children_count: i64,
    warranty_status: String,
}

#[derive(Deserialize)]
struct AssetInput {
    id: Option<i64>,
    code: String,
    name: String,
    #[serde(default)] parent_id: Option<i64>,
    #[serde(default)] level: String,
    #[serde(default)] class_id: Option<i64>,
    #[serde(default)] criticality: String,
    #[serde(default)] status: String,
    #[serde(default)] location: String,
    #[serde(default)] serial_number: String,
    #[serde(default)] model: String,
    #[serde(default)] manufacturer: String,
    #[serde(default)] manufacturer_phone: String,
    #[serde(default)] manufacturer_email: String,
    #[serde(default)] manufacturer_website: String,
    #[serde(default)] purchase_date: String,
    #[serde(default)] warranty_months: String,
    #[serde(default)] commission_date: String,
    #[serde(default)] description: String,
    #[serde(default)] specs: String,
    #[serde(default)] sort_order: i64,
}

#[derive(Serialize)]
struct AssetDoc {
    id: i64,
    title: String,
    doc_type: String,
    file_path: String,
    created_at: String,
}

#[derive(Deserialize)]
struct AssetDocInput {
    id: Option<i64>,
    asset_id: i64,
    title: String,
    #[serde(default)] doc_type: String,
    #[serde(default)] file_path: String,
}

fn level_index(level: &str) -> Option<usize> {
    LEVELS.iter().position(|l| *l == level)
}

fn calc_warranty_status(purchase: &str, months: i64) -> String {
    if months > 0 && !purchase.is_empty() {
        let valid = chrono::NaiveDate::parse_from_str(purchase, "%Y-%m-%d")
            .map(|d| d + chrono::Duration::days(months * 30))
            .map(|end| end >= chrono::Utc::now().date_naive())
            .unwrap_or(false);
        if valid { "معتبر".to_string() } else { "منقضی".to_string() }
    } else {
        "نامشخص".to_string()
    }
}

#[tauri::command]
fn get_asset_classes(db: State<Db>) -> Result<Vec<AssetClass>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, code, name, category FROM asset_classes ORDER BY category, code")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(AssetClass { id: row.get(0)?, code: row.get(1)?, name: row.get(2)?, category: row.get(3)? })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_assets(db: State<Db>) -> Result<Vec<AssetRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT a.id, a.code, a.name, a.parent_id, a.level, a.class_id, COALESCE(c.name,''),
                a.criticality, a.status, a.location, a.serial_number, a.model, a.manufacturer,
                a.manufacturer_phone, a.manufacturer_email, a.manufacturer_website,
                a.purchase_date, a.warranty_months, a.commission_date, a.description,
                a.specs, a.path, a.sort_order,
                (SELECT COUNT(*) FROM assets ch WHERE ch.parent_id = a.id)
         FROM assets a LEFT JOIN asset_classes c ON c.id = a.class_id
         ORDER BY a.path, a.sort_order, a.id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        let months: i64 = row.get(17)?;
        let purchase: String = row.get(16)?;
        let specs_str: String = row.get(20)?;
        Ok(AssetRow {
            id: row.get(0)?, code: row.get(1)?, name: row.get(2)?, parent_id: row.get(3)?,
            level: row.get(4)?, class_id: row.get(5)?, class_name: row.get(6)?,
            criticality: row.get(7)?, status: row.get(8)?, location: row.get(9)?,
            serial_number: row.get(10)?, model: row.get(11)?, manufacturer: row.get(12)?,
            manufacturer_phone: row.get(13)?, manufacturer_email: row.get(14)?,
             manufacturer_website: row.get(15)?, purchase_date: purchase.clone(), warranty_months: months,
            commission_date: row.get(18)?, description: row.get(19)?,
            specs: serde_json::from_str(&specs_str).unwrap_or(serde_json::json!({})),
            path: row.get(21)?, sort_order: row.get(22)?, children_count: row.get(23)?,
            warranty_status: calc_warranty_status(&purchase, months),
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_asset(db: State<Db>, asset: AssetInput) -> Result<i64, String> {
    let user = require_perm(&db, PERM_DEVICES)?;
    let code = asset.code.trim().to_string();
    let name = asset.name.trim().to_string();
    if code.is_empty() || name.is_empty() {
        return Err("کد و نام دارایی الزامی است.".to_string());
    }
    let level_idx = level_index(&asset.level)
        .ok_or_else(|| "سطح دارایی نامعتبر است.".to_string())?;
    if !CRITICALITIES.contains(&asset.criticality.as_str()) {
        return Err("بحرانیت باید یکی از A تا D باشد.".to_string());
    }
    if !ASSET_STATUSES.contains(&asset.status.as_str()) {
        return Err("وضعیت دارایی نامعتبر است.".to_string());
    }
    let months: i64 = asset.warranty_months.trim().parse().unwrap_or(0);
    let specs = if asset.specs.trim().is_empty() { "{}".to_string() } else { asset.specs };
    serde_json::from_str::<serde_json::Value>(&specs).map_err(|_| "مشخصات فنی باید JSON معتبر باشد.".to_string())?;

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // تعیین والد و مسیر (path) + جلوگیری از چرخه
    let (parent_id, parent_path) = match asset.parent_id {
        None => {
            if level_idx != 0 {
                return Err("برای سطوح غیر از Site باید والد مشخص شود.".to_string());
            }
            (None, String::new())
        }
        Some(pid) => {
            if Some(pid) == asset.id {
                return Err("دارایی نمی‌تواند والد خودش باشد.".to_string());
            }
            let (p_level, p_path): (String, String) = conn.query_row(
                "SELECT level, path FROM assets WHERE id=?1", params![pid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ).map_err(|_| "والد یافت نشد.".to_string())?;
            let p_idx = level_index(&p_level)
                .ok_or_else(|| "سطح والد نامعتبر است.".to_string())?;
            if p_idx + 1 != level_idx {
                return Err(format!("سطح والد باید «{}» باشد.", LEVELS[p_idx.saturating_sub(0)]));
            }
            (Some(pid), p_path)
        }
    };

    // اطلاعات قبلی (برای جلوگیری از چرخه و بازسازی مسیر نوادگان)
    let old_info: Option<(String, String)> = match asset.id {
        Some(id) => conn.query_row("SELECT code, path FROM assets WHERE id=?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|_| "دارایی یافت نشد.".to_string()).ok(),
        None => None,
    };

    // در ویرایش: والد نباید از نوادگان خود دارایی باشد
    if let Some((_, ref old_path)) = old_info {
        if !old_path.is_empty() && format!("{}/", parent_path).starts_with(&format!("{}/", old_path)) {
            return Err("نمی‌توانید دارایی را زیرمجموعه خودش قرار دهید.".to_string());
        }
    }

    let path = format!("{}/{}", parent_path, code);

    // تاریخچه فیلدبه‌فیلد (قبل از آپدیت، مقادیر قبلی خوانده می‌شود)
    let old_fields: Option<(String, String, String, String, String, String, String, i64, String, String)> =
        match asset.id {
            Some(id) => conn.query_row(
                "SELECT name, criticality, status, location, manufacturer, model, serial_number,
                        warranty_months, purchase_date, commission_date FROM assets WHERE id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?,
                        r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?)),
            ).ok(),
            None => None,
        };

    let id = match asset.id {
        Some(id) => {
            conn.execute(
                "UPDATE assets SET code=?1, name=?2, parent_id=?3, level=?4, class_id=?5,
                 criticality=?6, status=?7, location=?8, serial_number=?9, model=?10,
                 manufacturer=?11, manufacturer_phone=?12, manufacturer_email=?13, manufacturer_website=?14,
                 purchase_date=?15, warranty_months=?16, commission_date=?17, description=?18,
                 specs=?19, path=?20, sort_order=?21 WHERE id=?22",
                params![code, name, parent_id, asset.level, asset.class_id,
                        asset.criticality, asset.status, asset.location, asset.serial_number, asset.model,
                        asset.manufacturer, asset.manufacturer_phone, asset.manufacturer_email, asset.manufacturer_website,
                        asset.purchase_date, months, asset.commission_date, asset.description,
                        specs, path, asset.sort_order, id],
            ).map(|_| id).map_err(|e| {
                if e.to_string().contains("UNIQUE") { "این کد دارایی قبلاً ثبت شده است.".to_string() } else { e.to_string() }
            })?
        }
        None => conn.execute(
            "INSERT INTO assets (code, name, parent_id, level, class_id, criticality, status,
             location, serial_number, model, manufacturer, manufacturer_phone, manufacturer_email,
             manufacturer_website, purchase_date, warranty_months, commission_date, description,
             specs, path, sort_order)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)",
            params![code, name, parent_id, asset.level, asset.class_id,
                    asset.criticality, asset.status, asset.location, asset.serial_number, asset.model,
                    asset.manufacturer, asset.manufacturer_phone, asset.manufacturer_email, asset.manufacturer_website,
                    asset.purchase_date, months, asset.commission_date, asset.description,
                    specs, path, asset.sort_order],
        ).map(|_| conn.last_insert_rowid()).map_err(|e| {
            if e.to_string().contains("UNIQUE") { "این کد دارایی قبلاً ثبت شده است.".to_string() } else { e.to_string() }
        })?,
    };

    if let Some((oname, ocrit, ostatus, oloc, omfg, omodel, osn, omonths, opurch, ocomm)) = &old_fields {
        let by = &user.username;
        log_field_change(&conn, "asset", id, "نام", oname, &name, by);
        log_field_change(&conn, "asset", id, "بحرانیت", ocrit, &asset.criticality, by);
        log_field_change(&conn, "asset", id, "وضعیت", ostatus, &asset.status, by);
        log_field_change(&conn, "asset", id, "محل نصب", oloc, &asset.location, by);
        log_field_change(&conn, "asset", id, "سازنده", omfg, &asset.manufacturer, by);
        log_field_change(&conn, "asset", id, "مدل", omodel, &asset.model, by);
        log_field_change(&conn, "asset", id, "شماره سریال", osn, &asset.serial_number, by);
        log_field_change(&conn, "asset", id, "گارانتی (ماه)", &omonths.to_string(), &months.to_string(), by);
        log_field_change(&conn, "asset", id, "تاریخ خرید", opurch, &asset.purchase_date, by);
        log_field_change(&conn, "asset", id, "تاریخ کمیسیونینگ", ocomm, &asset.commission_date, by);
    }

    // بازسازی مسیر (path) تمام نوادگان در صورت تغییر کد یا جابه‌جایی
    if let Some((_, ref op)) = old_info {
        if *op != path {
            let like = format!("{}/%", op).replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
            let mut stmt = conn.prepare("SELECT id, path FROM assets WHERE path LIKE ?1 ESCAPE '\\'")
                .map_err(|e| e.to_string())?;
            let descendants: Vec<(i64, String)> = stmt.query_map(params![like], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<_, _>>().map_err(|e| e.to_string())?;
            for (cid, cpath) in descendants {
                let suffix = cpath.get(op.len()..).unwrap_or("");
                conn.execute("UPDATE assets SET path=?1 WHERE id=?2",
                    params![format!("{}{}", path, suffix), cid]).map_err(|e| e.to_string())?;
            }
        }
    }

    log_audit(&conn, Some(&user), if asset.id.is_some() { "update" } else { "create" },
              "asset", id, &format!("[{}] {} - {}", asset.level, code, name));
    Ok(id)
}

#[tauri::command]
fn delete_asset(db: State<Db>, id: i64) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let (level, label): (String, String) = conn.query_row(
        "SELECT level, code || ' - ' || name FROM assets WHERE id=?1", params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|_| "دارایی یافت نشد.".to_string())?;

    let children: i64 = conn.query_row("SELECT COUNT(*) FROM assets WHERE parent_id=?1", params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if children > 0 {
        return Err("این دارایی دارای زیرمجموعه است؛ ابتدا زیرمجموعه‌ها را حذف کنید.".to_string());
    }
    if level == "equipment" {
        let wo: i64 = conn.query_row("SELECT COUNT(*) FROM work_orders WHERE machine_id=?1", params![id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if wo > 0 {
            return Err("برای این تجهیز سفارش تعمیر ثبت شده و امکان حذف نیست.".to_string());
        }
    }

    let is_admin = current_user(&db).map(|u| u.permissions.iter().any(|p| p == "*")).unwrap_or(false);
    if is_admin {
        conn.execute("DELETE FROM assets WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        log_audit(&conn, current_user(&db).ok().as_ref(), "delete", "asset", id, &label);
        return Ok("دارایی حذف شد.".to_string());
    }

    let user = current_user(&db)?;
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) FROM approvals WHERE entity_type='asset' AND entity_id=?1 AND status='در انتظار'",
        params![id], |r| r.get::<_, i64>(0)).map_err(|e| e.to_string())? > 0;
    if exists {
        return Err("درخواست حذف این دارایی قبلاً ثبت شده و در انتظار تأیید است.".to_string());
    }
    conn.execute(
        "INSERT INTO approvals (action, entity_type, entity_id, entity_label, requested_by) VALUES ('حذف','asset',?1,?2,?3)",
        params![id, label, user.username],
    ).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "request_approval", "asset", id, &format!("درخواست حذف: {}", label));
    Ok("درخواست حذف برای تأیید مدیر ثبت شد.".to_string())
}

// ---- مدارک فنی دارایی ----
#[tauri::command]
fn get_asset_documents(db: State<Db>, asset_id: i64) -> Result<Vec<AssetDoc>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, title, doc_type, file_path, created_at FROM asset_documents WHERE asset_id=?1 ORDER BY id DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![asset_id], |row| {
        Ok(AssetDoc {
            id: row.get(0)?, title: row.get(1)?, doc_type: row.get(2)?,
            file_path: row.get(3)?, created_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_asset_document(db: State<Db>, doc: AssetDocInput) -> Result<(), String> {
    let user = require_perm(&db, PERM_DEVICES)?;
    if doc.title.trim().is_empty() {
        return Err("عنوان مدرک الزامی است.".to_string());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    match doc.id {
        Some(id) => conn.execute(
            "UPDATE asset_documents SET title=?1, doc_type=?2, file_path=?3 WHERE id=?4",
            params![doc.title, doc.doc_type, doc.file_path, id],
        ),
        None => conn.execute(
            "INSERT INTO asset_documents (asset_id, title, doc_type, file_path) VALUES (?1,?2,?3,?4)",
            params![doc.asset_id, doc.title, doc.doc_type, doc.file_path],
        ),
    }.map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "create", "asset_document", doc.asset_id, &doc.title);
    Ok(())
}

#[tauri::command]
fn delete_asset_document(db: State<Db>, id: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_DEVICES)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM asset_documents WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "delete", "asset_document", id, "");
    Ok(())
}

#[tauri::command]
async fn pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_file(move |path| {
        let _ = tx.send(path.map(|p| p.to_string_lossy().to_string()));
    });
    rx.recv().map_err(|e| e.to_string())
}

// ---------- چک‌لیست ----------
#[tauri::command]
fn get_checklist_items(db: State<Db>, machine_id: i64, check_type: String) -> Result<Vec<ChecklistItem>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, description FROM checklist_items WHERE machine_id=?1 AND check_type=?2 ORDER BY id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![machine_id, check_type], |row| {
        Ok(ChecklistItem { id: row.get(0)?, description: row.get(1)? })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_checklist_item(db: State<Db>, machine_id: i64, check_type: String, description: String) -> Result<(), String> {
    let user = require_perm(&db, PERM_CHECKLIST)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR IGNORE INTO checklist_items (machine_id, check_type, description) VALUES (?1,?2,?3)",
                 params![machine_id, check_type, description])
        .map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "create", "checklist_item", machine_id, &format!("{}: {}", check_type, description));
    Ok(())
}

#[tauri::command]
fn remove_checklist_item(db: State<Db>, id: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_CHECKLIST)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM checklist_items WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "delete", "checklist_item", id, "");
    Ok(())
}

// ---------- سفارش‌های تعمیر ----------
#[tauri::command]
fn create_work_order(db: State<Db>, machine_id: i64, order: WorkOrderInput) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM work_orders", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let wo_number = format!("WO-{:05}", count + 1);
    let wo_type = if order.wo_type.is_empty() { "برنامه‌ریزی‌شده".to_string() } else { order.wo_type };
    conn.execute(
        "INSERT INTO work_orders (machine_id, wo_number, description, priority, assigned_to,
         wo_type, failure_mode, requested_by, status)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'درخواست')",
        params![machine_id, wo_number, order.description, order.priority, order.assigned_to,
                wo_type, order.failure_mode, user.username],
    ).map_err(|e| e.to_string())?;
    let wo_id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO work_order_history (work_order_id, from_status, to_status, note, changed_by) VALUES (?1,'','درخواست','ثبت دستورکار',?2)",
        params![wo_id, user.username],
    ).ok();
    // دستورکار اورژانسی نیازمند تأیید مدیر است
    if order.priority == "اورژانسی" {
        let mname: String = conn.query_row("SELECT name FROM machines WHERE id=?1", params![machine_id], |r| r.get(0))
            .unwrap_or_default();
        conn.execute(
            "INSERT INTO approvals (action, entity_type, entity_id, entity_label, requested_by) VALUES ('تأیید دستورکار اورژانسی','work_order',?1,?2,?3)",
            params![wo_id, format!("{} - {}", wo_number, mname), user.username],
        ).ok();
    }
    log_audit(&conn, Some(&user), "create", "work_order", machine_id,
              &format!("{} [{}]: {}", wo_number, wo_type, order.description));
    Ok(())
}

#[tauri::command]
fn get_work_orders(db: State<Db>) -> Result<Vec<WorkOrder>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT w.id, w.wo_number, w.machine_id, m.name, w.description, w.priority, w.status,
                w.assigned_to, w.wo_type, w.failure_mode, w.cause, w.action_taken,
                w.start_date, w.end_date, w.labor_hours, w.cost, w.requested_by, w.completed_by, w.created_at
         FROM work_orders w JOIN machines m ON m.id = w.machine_id
         ORDER BY w.id DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(WorkOrder {
            id: row.get(0)?, wo_number: row.get(1)?, machine_id: row.get(2)?, machine_name: row.get(3)?,
            description: row.get(4)?, priority: row.get(5)?, status: row.get(6)?,
            assigned_to: row.get(7)?, wo_type: row.get(8)?, failure_mode: row.get(9)?,
            cause: row.get(10)?, action_taken: row.get(11)?,
            start_date: row.get(12)?, end_date: row.get(13)?,
            labor_hours: row.get(14)?, cost: row.get(15)?,
            requested_by: row.get(16)?, completed_by: row.get(17)?, created_at: row.get(18)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// تغییر وضعیت با اعتبارسنجی چرخه حیات + ثبت تاریخچه
#[tauri::command]
fn set_work_order_status(db: State<Db>, id: i64, status: String, note: String) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    if !WO_STATUSES.contains(&status.as_str()) {
        return Err("وضعیت نامعتبر است.".to_string());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let current: String = conn.query_row("SELECT status FROM work_orders WHERE id=?1", params![id], |r| r.get(0))
        .map_err(|_| "دستورکار یافت نشد.".to_string())?;
    if current == status {
        return Err("دستورکار هم‌اکنون در این وضعیت است.".to_string());
    }
    if !allowed_transitions(&current).contains(&status.as_str()) {
        return Err(format!("گذار «{} → {}» در چرخه حیات مجاز نیست.", current, status));
    }
    // تکمیل دستورکار: ثبت تکنسین و زمان پایان
    if status == "تکمیل شده" {
        conn.execute("UPDATE work_orders SET status=?1, completed_by=?2, end_date=date('now') WHERE id=?3",
            params![status, user.username, id]).map_err(|e| e.to_string())?;
    } else {
        conn.execute("UPDATE work_orders SET status=?1 WHERE id=?2", params![status, id])
            .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "INSERT INTO work_order_history (work_order_id, from_status, to_status, note, changed_by) VALUES (?1,?2,?3,?4,?5)",
        params![id, current, status, note, user.username],
    ).map_err(|e| e.to_string())?;

    // چرخه بعدی PM: زمان‌بندی مجدد برنامه پس از تکمیل دستورکار
    if status == "تکمیل شده" {
        let pm_id: Option<i64> = conn.query_row("SELECT pm_program_id FROM work_orders WHERE id=?1", params![id], |r| r.get(0)).ok().flatten();
        if let Some(pid) = pm_id {
            let (unit, interval, asset_id): (String, f64, i64) = conn.query_row(
                "SELECT interval_unit, interval_value, asset_id FROM pm_programs WHERE id=?1", params![pid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            ).map_err(|e| e.to_string())?;
            if METER_UNITS.contains(&unit.as_str()) {
                let cur = last_meter(&conn, asset_id).unwrap_or(0.0);
                conn.execute(
                    "UPDATE pm_programs SET last_done_date=date('now'), last_done_meter=?1, next_due_meter=?2 WHERE id=?3",
                    params![cur, cur + interval, pid],
                ).map_err(|e| e.to_string())?;
            } else {
                let days = (interval * unit_days(&unit) as f64) as i64;
                conn.execute(
                    "UPDATE pm_programs SET last_done_date=date('now'), next_due_date=date('now', ?1) WHERE id=?2",
                    params![format!("+{} days", days), pid],
                ).map_err(|e| e.to_string())?;
            }
            log_audit(&conn, Some(&user), "update", "pm_program", pid, "زمان‌بندی مجدد پس از تکمیل دستورکار");
        }
    }
    log_audit(&conn, Some(&user), "update", "work_order", id,
              &format!("{} → {} {}", current, status, note));
    Ok(())
}

// ویرایش فیلدهای تکمیلی + تاریخچه فیلدبه‌فیلد
#[tauri::command]
fn update_work_order(db: State<Db>, id: i64, order: WorkOrderInput) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let old = conn.query_row(
        "SELECT description, assigned_to, priority, wo_type, failure_mode, cause, action_taken,
                start_date, end_date, labor_hours, cost FROM work_orders WHERE id=?1",
        params![id],
        |r| Ok((
            r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?,
            r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, String>(5)?,
            r.get::<_, String>(6)?, r.get::<_, String>(7)?, r.get::<_, String>(8)?,
            r.get::<_, f64>(9)?, r.get::<_, f64>(10)?,
        )),
    ).map_err(|_| "دستورکار یافت نشد.".to_string())?;

    conn.execute(
        "UPDATE work_orders SET description=?1, assigned_to=?2, priority=?3, wo_type=?4,
         failure_mode=?5, cause=?6, action_taken=?7, start_date=?8, end_date=?9,
         labor_hours=?10, cost=?11 WHERE id=?12",
        params![order.description, order.assigned_to, order.priority, order.wo_type,
                order.failure_mode, order.cause, order.action_taken, order.start_date, order.end_date,
                order.labor_hours, order.cost, id],
    ).map_err(|e| e.to_string())?;

    let fmt = |v: f64| v.to_string();
    let changes: [(&str, String, String); 11] = [
        ("شرح", old.0, order.description),
        ("تکنسین", old.1, order.assigned_to),
        ("اولویت", old.2, order.priority),
        ("نوع", old.3, order.wo_type),
        ("مورد خرابی", old.4, order.failure_mode),
        ("علت ریشه‌ای", old.5, order.cause),
        ("اقدام انجام‌شده", old.6, order.action_taken),
        ("تاریخ شروع", old.7, order.start_date),
        ("تاریخ پایان", old.8, order.end_date),
        ("ساعت کار", fmt(old.9), fmt(order.labor_hours)),
        ("هزینه", fmt(old.10), fmt(order.cost)),
    ];
    for (f, ov, nv) in changes {
        log_field_change(&conn, "work_order", id, f, &ov, &nv, &user.username);
    }
    log_audit(&conn, Some(&user), "update", "work_order", id, "ویرایش فیلدهای تکمیلی");
    Ok(())
}

#[tauri::command]
fn get_work_order_history(db: State<Db>, wo_id: i64) -> Result<Vec<WoHistoryRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, from_status, to_status, note, changed_by, created_at
         FROM work_order_history WHERE work_order_id=?1 ORDER BY id DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![wo_id], |row| {
        Ok(WoHistoryRow {
            id: row.get(0)?, from_status: row.get(1)?, to_status: row.get(2)?,
            note: row.get(3)?, changed_by: row.get(4)?, created_at: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// تاریخچه فیلدبه‌فیلد (دارایی، دستورکار و...)
#[tauri::command]
fn get_field_history(db: State<Db>, entity_type: String, entity_id: i64) -> Result<Vec<FieldHistoryRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, field_name, old_value, new_value, changed_by, created_at
         FROM field_history WHERE entity_type=?1 AND entity_id=?2 ORDER BY id DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![entity_type, entity_id], |row| {
        Ok(FieldHistoryRow {
            id: row.get(0)?, field_name: row.get(1)?, old_value: row.get(2)?,
            new_value: row.get(3)?, changed_by: row.get(4)?, created_at: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------- Job Plan و برنامه‌های PM ----------
const TIME_UNITS: [&str; 4] = ["day", "week", "month", "year"];
const METER_UNITS: [&str; 3] = ["operating_hour", "kilometer", "meter"];

fn unit_days(unit: &str) -> i64 {
    match unit { "day" => 1, "week" => 7, "month" => 30, "year" => 365, _ => 30 }
}

fn unit_fa(unit: &str) -> &'static str {
    match unit {
        "day" => "روز", "week" => "هفته", "month" => "ماه", "year" => "سال",
        "operating_hour" => "ساعت کارکرد", "kilometer" => "کیلومتر", "meter" => "متر",
        _ => "ماه",
    }
}

#[derive(Serialize)]
struct JobPlanRow {
    id: i64,
    code: String,
    title: String,
    description: String,
    estimated_hours: f64,
    safety_notes: String,
    tools: String,
    steps_count: i64,
    parts_count: i64,
}

#[derive(Deserialize)]
struct JobPlanInput {
    id: Option<i64>,
    code: String,
    title: String,
    #[serde(default)] description: String,
    #[serde(default)] estimated_hours: f64,
    #[serde(default)] safety_notes: String,
    #[serde(default)] tools: String,
}

#[derive(Serialize)]
struct JobPlanStep {
    id: i64,
    order_index: i64,
    description: String,
    estimated_minutes: i64,
}

#[derive(Serialize)]
struct JobPlanPart {
    id: i64,
    part_id: i64,
    code: String,
    name: String,
    unit: String,
    quantity: f64,
}

#[derive(Serialize)]
struct PmProgramRow {
    id: i64,
    code: String,
    title: String,
    asset_id: i64,
    asset_code: String,
    asset_name: String,
    job_plan_id: Option<i64>,
    job_plan_title: String,
    interval_value: f64,
    interval_unit: String,
    interval_fa: String,
    is_meter_based: bool,
    next_due_date: String,
    last_done_date: String,
    next_due_meter: Option<f64>,
    last_done_meter: Option<f64>,
    current_meter: Option<f64>,
    assignee: String,
    priority: String,
    is_active: bool,
    days_until: Option<i64>,
    due_status: String, // ok / near / overdue / nodata
}

#[derive(Deserialize)]
struct PmProgramInput {
    id: Option<i64>,
    code: String,
    title: String,
    asset_id: i64,
    #[serde(default)] job_plan_id: Option<i64>,
    interval_value: f64,
    #[serde(default)] interval_unit: String,
    #[serde(default)] assignee: String,
    #[serde(default)] priority: String,
    #[serde(default)] is_active: bool,
}

#[derive(Serialize)]
struct MeterReadingRow {
    id: i64,
    value: f64,
    note: String,
    recorded_by: String,
    created_at: String,
}

fn last_meter(conn: &Connection, asset_id: i64) -> Option<f64> {
    conn.query_row("SELECT MAX(value) FROM meter_readings WHERE asset_id=?1", params![asset_id], |r| r.get(0)).ok().flatten()
}

// ---------- قطعات ----------
#[tauri::command]
fn get_parts(db: State<Db>) -> Result<Vec<Part>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.code, p.name, p.unit, p.min_stock,
                COALESCE((SELECT SUM(t.quantity) FROM stock_transactions t WHERE t.part_id = p.id), 0),
                COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.part_id = p.id AND r.status = 'رزرو شده'), 0)
         FROM parts p ORDER BY p.code"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Part {
            id: row.get(0)?, code: row.get(1)?, name: row.get(2)?, unit: row.get(3)?,
            min_stock: row.get(4)?, stock: row.get(5)?, reserved: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_part(db: State<Db>, part: PartInput) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    if part.code.trim().is_empty() || part.name.trim().is_empty() {
        return Err("کد و نام قطعه الزامی است.".to_string());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    match part.id {
        Some(id) => conn.execute(
            "UPDATE parts SET code=?1, name=?2, unit=?3, min_stock=?4 WHERE id=?5",
            params![part.code, part.name, part.unit, part.min_stock, id]),
        None => conn.execute(
            "INSERT OR IGNORE INTO parts (code, name, unit, min_stock) VALUES (?1,?2,?3,?4)",
            params![part.code, part.name, part.unit, part.min_stock]),
    }.map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "create", "part", 0, &format!("{} - {}", part.code, part.name));
    Ok(())
}

#[tauri::command]
fn get_work_order_parts(db: State<Db>, wo_id: i64) -> Result<Vec<PartUsage>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT w.id, p.id, p.code, p.name, p.unit, w.quantity, w.unit_price
         FROM work_order_parts w JOIN parts p ON p.id = w.part_id
         WHERE w.work_order_id=?1 ORDER BY w.id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![wo_id], |row| {
        let qty: f64 = row.get(5)?;
        let price: f64 = row.get(6)?;
        Ok(PartUsage {
            id: row.get(0)?, part_id: row.get(1)?, code: row.get(2)?, name: row.get(3)?,
            unit: row.get(4)?, quantity: qty, unit_price: price, total: qty * price,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_work_order_part(db: State<Db>, wo_id: i64, part_id: i64, quantity: f64, unit_price: f64) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO work_order_parts (work_order_id, part_id, quantity, unit_price) VALUES (?1,?2,?3,?4)",
        params![wo_id, part_id, quantity, unit_price],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO stock_transactions (part_id, txn_type, quantity, ref_type, ref_id, note, created_by) VALUES (?1,'صدور',?2,'work_order',?3,'','')",
        params![part_id, -quantity.abs(), wo_id],
    ).ok();
    let pname: String = conn.query_row("SELECT name FROM parts WHERE id=?1", params![part_id], |r| r.get(0))
        .unwrap_or_default();
    log_audit(&conn, Some(&user), "update", "work_order", wo_id,
              &format!("مصرف قطعه: {} × {}", pname, quantity));
    Ok(())
}

#[tauri::command]
fn remove_work_order_part(db: State<Db>, id: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let (part_id, qty, wo_id): (i64, f64, i64) = conn.query_row(
        "SELECT part_id, quantity, work_order_id FROM work_order_parts WHERE id=?1", params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).map_err(|_| "رکورد یافت نشد.".to_string())?;
    conn.execute("DELETE FROM work_order_parts WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO stock_transactions (part_id, txn_type, quantity, ref_type, ref_id, note, created_by) VALUES (?1,'برگشت',?2,'work_order',?3,'بازگشت مصرف','')",
        params![part_id, qty.abs(), wo_id],
    ).ok();
    log_audit(&conn, Some(&user), "update", "work_order", 0, "حذف قطعه مصرفی + برگشت به انبار");
    Ok(())
}

// ---------- Job Plan ----------
#[tauri::command]
fn get_job_plans(db: State<Db>) -> Result<Vec<JobPlanRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT j.id, j.code, j.title, j.description, j.estimated_hours, j.safety_notes, j.tools,
                (SELECT COUNT(*) FROM job_plan_steps s WHERE s.job_plan_id = j.id),
                (SELECT COUNT(*) FROM job_plan_parts p WHERE p.job_plan_id = j.id)
         FROM job_plans j ORDER BY j.code"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(JobPlanRow {
            id: row.get(0)?, code: row.get(1)?, title: row.get(2)?, description: row.get(3)?,
            estimated_hours: row.get(4)?, safety_notes: row.get(5)?, tools: row.get(6)?,
            steps_count: row.get(7)?, parts_count: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_job_plan(db: State<Db>, plan: JobPlanInput) -> Result<i64, String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    if plan.code.trim().is_empty() || plan.title.trim().is_empty() {
        return Err("کد و عنوان طرح کار الزامی است.".to_string());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = match plan.id {
        Some(id) => conn.execute(
            "UPDATE job_plans SET code=?1, title=?2, description=?3, estimated_hours=?4, safety_notes=?5, tools=?6 WHERE id=?7",
            params![plan.code, plan.title, plan.description, plan.estimated_hours, plan.safety_notes, plan.tools, id],
        ).map(|_| id),
        None => conn.execute(
            "INSERT INTO job_plans (code, title, description, estimated_hours, safety_notes, tools) VALUES (?1,?2,?3,?4,?5,?6)",
            params![plan.code, plan.title, plan.description, plan.estimated_hours, plan.safety_notes, plan.tools],
        ).map(|_| conn.last_insert_rowid()),
    }.map_err(|e| {
        if e.to_string().contains("UNIQUE") { "این کد طرح کار قبلاً ثبت شده است.".to_string() } else { e.to_string() }
    })?;
    log_audit(&conn, Some(&user), if plan.id.is_some() { "update" } else { "create" },
              "job_plan", id, &format!("{} - {}", plan.code, plan.title));
    Ok(id)
}

#[tauri::command]
fn delete_job_plan(db: State<Db>, id: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let used: i64 = conn.query_row("SELECT COUNT(*) FROM pm_programs WHERE job_plan_id=?1", params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if used > 0 {
        return Err("این طرح کار در برنامه PM استفاده شده و قابل حذف نیست.".to_string());
    }
    conn.execute("DELETE FROM job_plans WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "delete", "job_plan", id, "");
    Ok(())
}

#[tauri::command]
fn get_job_plan_steps(db: State<Db>, job_plan_id: i64) -> Result<Vec<JobPlanStep>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, order_index, description, estimated_minutes FROM job_plan_steps WHERE job_plan_id=?1 ORDER BY order_index, id")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![job_plan_id], |row| {
        Ok(JobPlanStep { id: row.get(0)?, order_index: row.get(1)?, description: row.get(2)?, estimated_minutes: row.get(3)? })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_job_plan_step(db: State<Db>, job_plan_id: i64, description: String, estimated_minutes: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    if description.trim().is_empty() { return Err("شرح مرحله الزامی است.".to_string()); }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let max_idx: i64 = conn.query_row("SELECT COALESCE(MAX(order_index),0) FROM job_plan_steps WHERE job_plan_id=?1", params![job_plan_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO job_plan_steps (job_plan_id, order_index, description, estimated_minutes) VALUES (?1,?2,?3,?4)",
        params![job_plan_id, max_idx + 1, description, estimated_minutes]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "update", "job_plan", job_plan_id, &format!("افزودن مرحله: {}", description));
    Ok(())
}

#[tauri::command]
fn remove_job_plan_step(db: State<Db>, id: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM job_plan_steps WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "update", "job_plan", 0, "حذف مرحله");
    Ok(())
}

#[tauri::command]
fn get_job_plan_parts(db: State<Db>, job_plan_id: i64) -> Result<Vec<JobPlanPart>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT j.id, p.id, p.code, p.name, p.unit, j.quantity FROM job_plan_parts j JOIN parts p ON p.id = j.part_id WHERE j.job_plan_id=?1 ORDER BY j.id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![job_plan_id], |row| {
        Ok(JobPlanPart { id: row.get(0)?, part_id: row.get(1)?, code: row.get(2)?, name: row.get(3)?, unit: row.get(4)?, quantity: row.get(5)? })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_job_plan_part(db: State<Db>, job_plan_id: i64, part_id: i64, quantity: f64) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO job_plan_parts (job_plan_id, part_id, quantity) VALUES (?1,?2,?3)",
        params![job_plan_id, part_id, quantity]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "update", "job_plan", job_plan_id, "افزودن قطعه");
    Ok(())
}

#[tauri::command]
fn remove_job_plan_part(db: State<Db>, id: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM job_plan_parts WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "update", "job_plan", 0, "حذف قطعه");
    Ok(())
}

// ---------- برنامه‌های PM ----------
#[tauri::command]
fn get_pm_programs(db: State<Db>) -> Result<Vec<PmProgramRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.code, p.title, p.asset_id, a.code, a.name, p.job_plan_id,
                COALESCE(j.title,''), p.interval_value, p.interval_unit,
                p.next_due_date, p.last_done_date, p.next_due_meter, p.last_done_meter,
                p.assignee, p.priority, p.is_active
         FROM pm_programs p
         JOIN assets a ON a.id = p.asset_id
         LEFT JOIN job_plans j ON j.id = p.job_plan_id
         ORDER BY p.code"
    ).map_err(|e| e.to_string())?;
    let today = chrono::Utc::now().date_naive();
    let rows = stmt.query_map([], |row| {
        let unit: String = row.get(9)?;
        let is_meter = METER_UNITS.contains(&unit.as_str());
        let next_due_date: String = row.get(10)?;
        let next_due_meter: Option<f64> = row.get(12)?;
        let asset_id: i64 = row.get(3)?;
        let current = last_meter(&conn, asset_id);
        let interval: f64 = row.get(8)?;
        let (days_until, due_status) = if is_meter {
            match (current, next_due_meter) {
                (Some(cur), Some(due)) => {
                    let d = (due - cur).round() as i64;
                    if cur >= due { (Some(d), "overdue".to_string()) }
                    else if due > 0.0 && cur >= due - (interval * 0.1) { (Some(d), "near".to_string()) }
                    else { (Some(d), "ok".to_string()) }
                }
                _ => (None, "nodata".to_string()),
            }
        } else {
            if next_due_date.is_empty() {
                (None, "nodata".to_string())
            } else {
                match chrono::NaiveDate::parse_from_str(&next_due_date, "%Y-%m-%d") {
                    Ok(d) => {
                        let diff = (d - today).num_days();
                        if diff < 0 { (Some(diff), "overdue".to_string()) }
                        else if diff <= 7 { (Some(diff), "near".to_string()) }
                        else { (Some(diff), "ok".to_string()) }
                    }
                    Err(_) => (None, "nodata".to_string()),
                }
            }
        };
        Ok(PmProgramRow {
            id: row.get(0)?, code: row.get(1)?, title: row.get(2)?, asset_id,
            asset_code: row.get(4)?, asset_name: row.get(5)?,
            job_plan_id: row.get(6)?, job_plan_title: row.get(7)?,
            interval_value: interval, interval_unit: unit.clone(), interval_fa: unit_fa(&unit).to_string(),
            is_meter_based: is_meter,
            next_due_date, last_done_date: row.get(11)?, next_due_meter, last_done_meter: row.get(13)?,
            current_meter: current,
            assignee: row.get(14)?, priority: row.get(15)?,
            is_active: row.get::<_, i64>(16)? == 1,
            days_until, due_status,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_pm_program(db: State<Db>, program: PmProgramInput) -> Result<i64, String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    if program.code.trim().is_empty() || program.title.trim().is_empty() {
        return Err("کد و عنوان برنامه الزامی است.".to_string());
    }
    if program.interval_value <= 0.0 {
        return Err("مقدار بازه باید بزرگ‌تر از صفر باشد.".to_string());
    }
    let unit = if program.interval_unit.is_empty() { "month".to_string() } else { program.interval_unit };
    if !TIME_UNITS.contains(&unit.as_str()) && !METER_UNITS.contains(&unit.as_str()) {
        return Err("واحد بازه نامعتبر است.".to_string());
    }
    let is_meter = METER_UNITS.contains(&unit.as_str());
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let exists: bool = conn.query_row("SELECT COUNT(*) FROM assets WHERE id=?1 AND level='equipment'", params![program.asset_id], |r| r.get(0))
        .map_err(|e| e.to_string())? > 0;
    if !exists {
        return Err("تجهیز انتخاب‌شده معتبر نیست.".to_string());
    }
    let active = if program.is_active { 1 } else { 0 };

    // سررسید اولیه در صورت خالی بودن
    let (next_due_date, next_due_meter) = match program.id {
        Some(id) => conn.query_row(
            "SELECT next_due_date, next_due_meter FROM pm_programs WHERE id=?1", params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<f64>>(1)?)),
        ).map_err(|_| "برنامه یافت نشد.".to_string())?,
        None => {
            if is_meter {
                let cur = last_meter(&conn, program.asset_id).unwrap_or(0.0);
                (String::new(), Some(cur + program.interval_value))
            } else {
                let days = (program.interval_value * unit_days(&unit) as f64) as i64;
                let due = chrono::Utc::now().date_naive() + chrono::Duration::days(days);
                (due.format("%Y-%m-%d").to_string(), None)
            }
        }
    };

    let id = match program.id {
        Some(id) => conn.execute(
            "UPDATE pm_programs SET code=?1, title=?2, asset_id=?3, job_plan_id=?4,
             interval_value=?5, interval_unit=?6, assignee=?7, priority=?8, is_active=?9 WHERE id=?10",
            params![program.code, program.title, program.asset_id, program.job_plan_id,
                    program.interval_value, unit, program.assignee, program.priority, active, id],
        ).map(|_| id),
        None => conn.execute(
            "INSERT INTO pm_programs (code, title, asset_id, job_plan_id, interval_value, interval_unit,
             next_due_date, next_due_meter, assignee, priority, is_active)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![program.code, program.title, program.asset_id, program.job_plan_id,
                    program.interval_value, unit, next_due_date, next_due_meter,
                    program.assignee, program.priority, active],
        ).map(|_| conn.last_insert_rowid()),
    }.map_err(|e| {
        if e.to_string().contains("UNIQUE") { "این کد برنامه قبلاً ثبت شده است.".to_string() } else { e.to_string() }
    })?;
    log_audit(&conn, Some(&user), if program.id.is_some() { "update" } else { "create" },
              "pm_program", id, &format!("{} - {}", program.code, program.title));
    Ok(id)
}

#[tauri::command]
fn delete_pm_program(db: State<Db>, id: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM pm_programs WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "delete", "pm_program", id, "");
    Ok(())
}

// تولید خودکار دستورکار برای برنامه‌های سررسید
#[tauri::command]
fn generate_pm_work_orders(db: State<Db>) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let today = chrono::Utc::now().date_naive();

    let mut stmt = conn.prepare(
        "SELECT p.id, p.code, p.title, p.asset_id, p.job_plan_id, p.assignee, p.priority,
                p.interval_value, p.interval_unit, p.next_due_date, p.next_due_meter, p.last_done_date
         FROM pm_programs p WHERE p.is_active = 1"
    ).map_err(|e| e.to_string())?;

    let programs: Vec<(i64, String, String, i64, Option<i64>, String, String, f64, String, String, Option<f64>, String)> =
        stmt.query_map([], |row| Ok((
            row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?,
            row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?, row.get(11)?,
        ))).map_err(|e| e.to_string())?
        .collect::<Result<_, _>>().map_err(|e| e.to_string())?;

    let mut generated = 0;
    for (pid, pcode, ptitle, asset_id, job_plan_id, assignee, priority, interval, unit, next_due_date, next_due_meter, last_done_date) in programs {
        let is_meter = METER_UNITS.contains(&unit.as_str());
        let due = if is_meter {
            match (last_meter(&conn, asset_id), next_due_meter) {
                (Some(cur), Some(due)) => cur >= due,
                _ => false,
            }
        } else if next_due_date.is_empty() {
            false
        } else {
            match chrono::NaiveDate::parse_from_str(&next_due_date, "%Y-%m-%d") {
                Ok(d) => d <= today,
                Err(_) => false,
            }
        };
        if !due { continue; }

        // جلوگیری از تکرار: دستورکار باز PM برای این چرخه وجود نداشته باشد
        let open_exists: i64 = if last_done_date.is_empty() {
            conn.query_row(
                "SELECT COUNT(*) FROM work_orders WHERE pm_program_id=?1 AND status NOT IN ('لغو شده','بسته شده')",
                params![pid], |r| r.get(0)).map_err(|e| e.to_string())?
        } else {
            conn.query_row(
                "SELECT COUNT(*) FROM work_orders WHERE pm_program_id=?1 AND status NOT IN ('لغو شده','بسته شده')
                 AND created_at >= COALESCE((SELECT MAX(created_at) FROM work_orders WHERE pm_program_id=?1 AND status='تکمیل شده'), '1970-01-01')",
                params![pid, pid], |r| r.get(0)).map_err(|e| e.to_string())?
        };
        if open_exists > 0 { continue; }

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM work_orders", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let wo_number = format!("WO-{:05}", count + 1);
        let jp_title: String = match job_plan_id {
            Some(jid) => conn.query_row("SELECT title FROM job_plans WHERE id=?1", params![jid], |r| r.get(0)).unwrap_or_default(),
            None => String::new(),
        };
        let description = if jp_title.is_empty() {
            format!("PM {} - {}", pcode, ptitle)
        } else {
            format!("PM {} - {} | طرح کار: {}", pcode, ptitle, jp_title)
        };
        conn.execute(
            "INSERT INTO work_orders (machine_id, wo_number, description, priority, assigned_to,
             wo_type, requested_by, status, pm_program_id) VALUES (?1,?2,?3,?4,?5,'پیشگیرانه',?6,'درخواست',?7)",
            params![asset_id, wo_number, description, priority, assignee, "PM-Scheduler", pid],
        ).map_err(|e| e.to_string())?;
        let wo_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO work_order_history (work_order_id, from_status, to_status, note, changed_by) VALUES (?1,'','درخواست','تولید خودکار از برنامه PM',?2)",
            params![wo_id, "PM-Scheduler"],
        ).ok();
        // قطعات طرح کار به‌صورت پیش‌بینی در دستورکار ثبت نمی‌شود؛ تکنسین هنگام تکمیل ثبت می‌کند
        generated += 1;
        log_audit(&conn, None, "create", "work_order", asset_id,
                  &format!("{} (خودکار از PM {})", wo_number, pcode));
    }
    Ok(generated)
}

// ---------- رکوردهای کنتوری ----------
#[tauri::command]
fn record_meter_reading(db: State<Db>, asset_id: i64, value: f64, note: String) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO meter_readings (asset_id, value, note, recorded_by) VALUES (?1,?2,?3,?4)",
        params![asset_id, value, note, user.username],
    ).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "create", "meter_reading", asset_id,
              &format!("مقدار: {} {}", value, note));
    Ok(())
}

#[tauri::command]
fn get_meter_readings(db: State<Db>, asset_id: i64) -> Result<Vec<MeterReadingRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, value, note, recorded_by, created_at FROM meter_readings WHERE asset_id=?1 ORDER BY id DESC LIMIT 50"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![asset_id], |row| {
        Ok(MeterReadingRow {
            id: row.get(0)?, value: row.get(1)?, note: row.get(2)?,
            recorded_by: row.get(3)?, created_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------- انبار: گردش موجودی ----------
#[tauri::command]
fn stock_in(db: State<Db>, part_id: i64, quantity: f64, note: String) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    if quantity <= 0.0 { return Err("مقدار باید بزرگ‌تر از صفر باشد.".to_string()); }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO stock_transactions (part_id, txn_type, quantity, ref_type, ref_id, note, created_by) VALUES (?1,'دریافت',?2,'purchase',0,?3,?4)",
        params![part_id, quantity.abs(), note, user.username],
    ).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "create", "stock_transaction", part_id, &format!("دریافت: {} | {}", quantity, note));
    Ok(())
}

#[tauri::command]
fn stock_adjust(db: State<Db>, part_id: i64, quantity: f64, note: String) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO stock_transactions (part_id, txn_type, quantity, ref_type, ref_id, note, created_by) VALUES (?1,'تنظیم',?2,'adjust',0,?3,?4)",
        params![part_id, quantity, note, user.username],
    ).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "create", "stock_transaction", part_id, &format!("تنظیم موجودی: {}", quantity));
    Ok(())
}

#[tauri::command]
fn get_stock_transactions(db: State<Db>, part_id: i64) -> Result<Vec<StockTxnRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, txn_type, quantity, ref_type, ref_id, note, created_by, created_at
         FROM stock_transactions WHERE part_id=?1 ORDER BY id DESC LIMIT 100"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![part_id], |row| {
        Ok(StockTxnRow {
            id: row.get(0)?, txn_type: row.get(1)?, quantity: row.get(2)?,
            ref_type: row.get(3)?, ref_id: row.get(4)?, note: row.get(5)?,
            created_by: row.get(6)?, created_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------- رزرو قطعه ----------
#[tauri::command]
fn reserve_part(db: State<Db>, part_id: i64, work_order_id: Option<i64>, quantity: f64, note: String) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    if quantity <= 0.0 { return Err("مقدار رزرو باید بزرگ‌تر از صفر باشد.".to_string()); }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let stock: f64 = conn.query_row("SELECT COALESCE(SUM(quantity),0) FROM stock_transactions WHERE part_id=?1", params![part_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let reserved: f64 = conn.query_row("SELECT COALESCE(SUM(quantity),0) FROM reservations WHERE part_id=?1 AND status='رزرو شده'", params![part_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if stock - reserved < quantity {
        return Err(format!("موجودی قابل رزرو کافی نیست (موجودی: {}، رزروشده: {})", stock, reserved));
    }
    conn.execute(
        "INSERT INTO reservations (part_id, work_order_id, quantity, note, created_by) VALUES (?1,?2,?3,?4,?5)",
        params![part_id, work_order_id, quantity, note, user.username],
    ).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "create", "reservation", part_id, &format!("رزرو: {} | {}", quantity, note));
    Ok(())
}

#[tauri::command]
fn get_reservations(db: State<Db>) -> Result<Vec<ReservationRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT r.id, r.part_id, p.code, p.name, p.unit, r.work_order_id,
                COALESCE(w.wo_number,''), r.quantity, r.status, r.note, r.created_by, r.created_at
         FROM reservations r
         JOIN parts p ON p.id = r.part_id
         LEFT JOIN work_orders w ON w.id = r.work_order_id
         ORDER BY r.id DESC LIMIT 200"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(ReservationRow {
            id: row.get(0)?, part_id: row.get(1)?, code: row.get(2)?, name: row.get(3)?, unit: row.get(4)?,
            work_order_id: row.get(5)?, wo_number: row.get(6)?, quantity: row.get(7)?,
            status: row.get(8)?, note: row.get(9)?, created_by: row.get(10)?, created_at: row.get(11)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_reservation_status(db: State<Db>, id: i64, status: String) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    if !["رزرو شده", "صدور شده", "لغو شده"].contains(&status.as_str()) {
        return Err("وضعیت نامعتبر است.".to_string());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    if status == "صدور شده" {
        // صدور از رزرو: کسر واقعی از موجودی + ثبت در دستورکار
        let (part_id, qty, wo_id): (i64, f64, Option<i64>) = conn.query_row(
            "SELECT part_id, quantity, work_order_id FROM reservations WHERE id=?1 AND status='رزرو شده'",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).map_err(|_| "رزرو یافت نشد یا قبلاً صادر شده است.".to_string())?;
        conn.execute(
            "INSERT INTO stock_transactions (part_id, txn_type, quantity, ref_type, ref_id, note, created_by) VALUES (?1,'صدور',?2,'work_order',?3,'صدور از رزرو',?4)",
            params![part_id, -qty.abs(), wo_id.unwrap_or(0), user.username],
        ).ok();
        if let Some(w) = wo_id {
            conn.execute(
                "INSERT OR IGNORE INTO work_order_parts (work_order_id, part_id, quantity, unit_price) VALUES (?1,?2,?3,0)",
                params![w, part_id, qty],
            ).ok();
        }
        conn.execute("UPDATE reservations SET status='صدور شده', fulfilled_at=datetime('now') WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute("UPDATE reservations SET status=?1 WHERE id=?2", params![status, id]).map_err(|e| e.to_string())?;
    }
    log_audit(&conn, Some(&user), "update", "reservation", id, &status);
    Ok(())
}

// ---------- BOM (دستور مصرف materials) ----------
#[tauri::command]
fn get_bom(db: State<Db>, equipment_id: i64) -> Result<Vec<BomItem>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT b.id, p.id, p.code, p.name, p.unit, b.quantity, b.note
         FROM bom_items b JOIN parts p ON p.id = b.part_id WHERE b.equipment_id=?1 ORDER BY p.code"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![equipment_id], |row| {
        Ok(BomItem {
            id: row.get(0)?, part_id: row.get(1)?, code: row.get(2)?, name: row.get(3)?,
            unit: row.get(4)?, quantity: row.get(5)?, note: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_bom_item(db: State<Db>, equipment_id: i64, part_id: i64, quantity: f64, note: String) -> Result<(), String> {
    let user = require_perm(&db, PERM_DEVICES)?;
    if quantity <= 0.0 { return Err("مقدار باید بزرگ‌تر از صفر باشد.".to_string()); }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO bom_items (equipment_id, part_id, quantity, note) VALUES (?1,?2,?3,?4)
         ON CONFLICT(equipment_id, part_id) DO UPDATE SET quantity=quantity+excluded.quantity",
        params![equipment_id, part_id, quantity, note],
    ).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "update", "bom", equipment_id, &format!("افزودن قطعه {} × {}", part_id, quantity));
    Ok(())
}

#[tauri::command]
fn remove_bom_item(db: State<Db>, id: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_DEVICES)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM bom_items WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "update", "bom", 0, "حذف آیتم BOM");
    Ok(())
}

// ---------- RCA (تحلیل علت ریشه‌ای) ----------
#[derive(Serialize)]
struct RcaRow {
    id: i64,
    work_order_id: Option<i64>,
    wo_number: String,
    machine_name: String,
    title: String,
    failure_mode: String,
    failure_cause: String,
    consequence: String,
    method: String,
    status: String,
    created_by: String,
    created_at: String,
}

#[derive(Deserialize)]
struct RcaInput {
    id: Option<i64>,
    work_order_id: Option<i64>,
    title: String,
    #[serde(default)] failure_mode: String,
    #[serde(default)] failure_cause: String,
    #[serde(default)] consequence: String,
    #[serde(default)] method: String,
    #[serde(default)] status: String,
}

#[derive(Serialize)]
struct RcaWhy { id: i64, step: i64, answer: String }

#[derive(Serialize)]
struct RcaAction {
    id: i64,
    description: String,
    responsible: String,
    due_date: String,
    status: String,
}

#[tauri::command]
fn get_rcas(db: State<Db>) -> Result<Vec<RcaRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT r.id, r.work_order_id, COALESCE(w.wo_number,''), COALESCE(m.name,''),
                r.title, r.failure_mode, r.failure_cause, r.consequence, r.method, r.status,
                r.created_by, r.created_at
         FROM rcas r
         LEFT JOIN work_orders w ON w.id = r.work_order_id
         LEFT JOIN machines m ON m.id = w.machine_id
         ORDER BY r.id DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(RcaRow {
            id: row.get(0)?, work_order_id: row.get(1)?, wo_number: row.get(2)?, machine_name: row.get(3)?,
            title: row.get(4)?, failure_mode: row.get(5)?, failure_cause: row.get(6)?,
            consequence: row.get(7)?, method: row.get(8)?, status: row.get(9)?,
            created_by: row.get(10)?, created_at: row.get(11)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_rca(db: State<Db>, rca: RcaInput) -> Result<i64, String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    if rca.title.trim().is_empty() { return Err("عنوان تحلیل الزامی است.".to_string()); }
    let method = if rca.method.is_empty() { "5 Why".to_string() } else { rca.method };
    let status = if rca.status.is_empty() { "باز".to_string() } else { rca.status };
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = match rca.id {
        Some(id) => {
            conn.execute(
                "UPDATE rcas SET work_order_id=?1, title=?2, failure_mode=?3, failure_cause=?4,
                 consequence=?5, method=?6, status=?7,
                 completed_at=CASE WHEN ?7='بسته شده' THEN datetime('now') ELSE completed_at END WHERE id=?8",
                params![rca.work_order_id, rca.title, rca.failure_mode, rca.failure_cause,
                        rca.consequence, method, status, id],
            ).map(|_| id)
        }
        None => conn.execute(
            "INSERT INTO rcas (work_order_id, title, failure_mode, failure_cause, consequence, method, status, created_by)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![rca.work_order_id, rca.title, rca.failure_mode, rca.failure_cause,
                    rca.consequence, method, status, user.username],
        ).map(|_| conn.last_insert_rowid()),
    }.map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), if rca.id.is_some() { "update" } else { "create" },
              "rca", id, &rca.title);
    Ok(id)
}

#[tauri::command]
fn delete_rca(db: State<Db>, id: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM rcas WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "delete", "rca", id, "");
    Ok(())
}

#[tauri::command]
fn get_rca_detail(db: State<Db>, rca_id: i64) -> Result<(Vec<RcaWhy>, Vec<RcaAction>), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let whys = {
        let mut stmt = conn.prepare("SELECT id, step, answer FROM rca_whys WHERE rca_id=?1 ORDER BY step")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![rca_id], |row| {
            Ok(RcaWhy { id: row.get(0)?, step: row.get(1)?, answer: row.get(2)? })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let actions = {
        let mut stmt = conn.prepare("SELECT id, description, responsible, due_date, status FROM rca_actions WHERE rca_id=?1 ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![rca_id], |row| {
            Ok(RcaAction {
                id: row.get(0)?, description: row.get(1)?, responsible: row.get(2)?,
                due_date: row.get(3)?, status: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    Ok((whys, actions))
}

#[tauri::command]
fn save_rca_why(db: State<Db>, rca_id: i64, step: i64, answer: String) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO rca_whys (rca_id, step, answer) VALUES (?1,?2,?3)
         ON CONFLICT(rca_id, step) DO UPDATE SET answer=excluded.answer",
        params![rca_id, step, answer],
    ).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "update", "rca", rca_id, &format!("چرا {}: {}", step, answer));
    Ok(())
}

#[tauri::command]
fn add_rca_action(db: State<Db>, rca_id: i64, description: String, responsible: String, due_date: String) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    if description.trim().is_empty() { return Err("شرح اقدام الزامی است.".to_string()); }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO rca_actions (rca_id, description, responsible, due_date) VALUES (?1,?2,?3,?4)",
        params![rca_id, description, responsible, due_date],
    ).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "create", "rca_action", rca_id, &description);
    Ok(())
}

#[tauri::command]
fn set_rca_action_status(db: State<Db>, id: i64, status: String) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE rca_actions SET status=?1 WHERE id=?2", params![status, id]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "update", "rca_action", id, &status);
    Ok(())
}

#[tauri::command]
fn remove_rca_action(db: State<Db>, id: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM rca_actions WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "delete", "rca_action", id, "");
    Ok(())
}

// ---------- داشبورد KPI ----------
#[derive(Serialize)]
struct Kpis {
    assets_total: i64,
    equipment_count: i64,
    wo_total: i64,
    wo_open: i64,
    wo_in_progress: i64,
    wo_completed: i64,
    wo_emergency: i64,
    pm_total: i64,
    pm_overdue: i64,
    pm_near: i64,
    parts_low_stock: i64,
    parts_total: i64,
    parts_consumed_cost: f64,
    mttr_days: f64,
    pm_compliance: f64,
    monthly_trend: Vec<(String, i64)>,
    top_failure_modes: Vec<(String, i64)>,
}

#[tauri::command]
fn get_kpis(db: State<Db>) -> Result<Kpis, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let q = |sql: &str| -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0)
    };
    let today = chrono::Utc::now().date_naive();

    let (pm_total, pm_overdue, pm_near) = {
        let mut stmt = conn.prepare(
            "SELECT p.interval_unit, p.next_due_date, p.next_due_meter,
                    COALESCE((SELECT MAX(value) FROM meter_readings mr WHERE mr.asset_id = p.asset_id), 0)
             FROM pm_programs p WHERE p.is_active = 1"
        ).map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, Option<f64>, f64)> = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        }).map_err(|e| e.to_string())?
        .collect::<Result<_, _>>().map_err(|e| e.to_string())?;
        let mut total = 0; let mut overdue = 0; let mut near = 0;
        for (unit, nd, nm, cur) in rows {
            total += 1;
            if METER_UNITS.contains(&unit.as_str()) {
                if let Some(d) = nm { if cur >= d { overdue += 1; } else if d > 0.0 && cur >= d * 0.9 { near += 1; } }
            } else if !nd.is_empty() {
                if let Ok(d) = chrono::NaiveDate::parse_from_str(&nd, "%Y-%m-%d") {
                    let diff = (d - today).num_days();
                    if diff < 0 { overdue += 1; } else if diff <= 7 { near += 1; }
                }
            }
        }
        (total, overdue, near)
    };

    let mttr: Option<f64> = conn.query_row(
        "SELECT AVG(julianday(h.created_at) - julianday(date(w.created_at)))
         FROM work_orders w
         JOIN work_order_history h ON h.work_order_id = w.id AND h.to_status = 'تکمیل شده'
         WHERE h.id = (SELECT id FROM work_order_history WHERE work_order_id = w.id AND to_status = 'تکمیل شده' ORDER BY id DESC LIMIT 1)",
        [], |r| r.get(0),
    ).ok().flatten();

    let (pm_done, pm_all): (i64, i64) = conn.query_row(
        "SELECT SUM(CASE WHEN status IN ('تکمیل شده','بسته شده') THEN 1 ELSE 0 END), COUNT(*)
         FROM work_orders WHERE pm_program_id IS NOT NULL",
        [], |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap_or((0, 0));

    let mut monthly_trend = Vec::new();
    for i in (0..6).rev() {
        let d = today - chrono::Months::new(i as u32);
        let key = d.format("%Y-%m").to_string();
        let c: i64 = conn.query_row(
            "SELECT COUNT(*) FROM work_orders WHERE strftime('%Y-%m', created_at) = ?1",
            params![key], |r| r.get(0)).unwrap_or(0);
        monthly_trend.push((key, c));
    }

    let top_failure_modes: Vec<(String, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT failure_mode, COUNT(*) c FROM work_orders
             WHERE failure_mode != '' GROUP BY failure_mode ORDER BY c DESC LIMIT 5"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };

    Ok(Kpis {
        assets_total: q("SELECT COUNT(*) FROM assets"),
        equipment_count: q("SELECT COUNT(*) FROM assets WHERE level='equipment'"),
        wo_total: q("SELECT COUNT(*) FROM work_orders"),
        wo_open: q("SELECT COUNT(*) FROM work_orders WHERE status IN ('درخواست','تأیید شده')"),
        wo_in_progress: q("SELECT COUNT(*) FROM work_orders WHERE status='در حال انجام'"),
        wo_completed: q("SELECT COUNT(*) FROM work_orders WHERE status IN ('تکمیل شده','بسته شده')"),
        wo_emergency: q("SELECT COUNT(*) FROM work_orders WHERE priority='اورژانسی'"),
        pm_total, pm_overdue, pm_near,
        parts_low_stock: q("SELECT COUNT(*) FROM parts p WHERE p.min_stock > 0 AND
            COALESCE((SELECT SUM(t.quantity) FROM stock_transactions t WHERE t.part_id=p.id),0) -
            COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.part_id=p.id AND r.status='رزرو شده'),0) <= p.min_stock"),
        parts_total: q("SELECT COUNT(*) FROM parts"),
        parts_consumed_cost: conn.query_row("SELECT COALESCE(SUM(quantity*unit_price),0) FROM work_order_parts", [], |r| r.get(0)).unwrap_or(0.0),
        mttr_days: (mttr.unwrap_or(0.0) * 10.0).round() / 10.0,
        pm_compliance: if pm_all > 0 { ((pm_done as f64 / pm_all as f64) * 100.0 * 10.0).round() / 10.0 } else { 0.0 },
        monthly_trend,
        top_failure_modes,
    })
}

// ---------- تقویم تعمیرات ----------
#[derive(Serialize)]
struct CalendarEvent {
    date: String,
    kind: String, // wo / pm
    title: String,
    status: String,
    ref_id: i64,
}

#[tauri::command]
fn get_calendar(db: State<Db>, month: String) -> Result<Vec<CalendarEvent>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut events = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT date(COALESCE(NULLIF(w.start_date,''), date(w.created_at))) as d,
                w.wo_number || ' — ' || m.name, w.status, w.id
         FROM work_orders w JOIN machines m ON m.id = w.machine_id
         WHERE strftime('%Y-%m', COALESCE(NULLIF(w.start_date,''), date(w.created_at))) = ?1
         ORDER BY d"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![month], |row| {
        Ok(CalendarEvent { date: row.get(0)?, kind: "wo".to_string(), title: row.get(1)?, status: row.get(2)?, ref_id: row.get(3)? })
    }).map_err(|e| e.to_string())?;
    events.extend(rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?);

    let mut stmt2 = conn.prepare(
        "SELECT p.next_due_date, p.code || ' — ' || p.title, p.id
         FROM pm_programs p WHERE p.is_active = 1 AND strftime('%Y-%m', p.next_due_date) = ?1"
    ).map_err(|e| e.to_string())?;
    let rows2 = stmt2.query_map(params![month], |row| {
        Ok(CalendarEvent { date: row.get(0)?, kind: "pm".to_string(), title: row.get(1)?, status: "سررسید PM".to_string(), ref_id: row.get(2)? })
    }).map_err(|e| e.to_string())?;
    events.extend(rows2.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?);
    Ok(events)
}

// ---------- برنامه‌ریزی منابع (بار تکنسین‌ها) ----------
#[derive(Serialize)]
struct WorkloadRow {
    technician: String,
    open_count: i64,
    in_progress: i64,
    completed: i64,
}

#[tauri::command]
fn get_technician_workload(db: State<Db>) -> Result<Vec<WorkloadRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT COALESCE(NULLIF(assigned_to,''), '(بدون تکنسین)'),
                SUM(CASE WHEN status IN ('درخواست','تأیید شده') THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'در حال انجام' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status IN ('تکمیل شده','بسته شده') THEN 1 ELSE 0 END)
         FROM work_orders GROUP BY assigned_to ORDER BY 2 DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(WorkloadRow {
            technician: row.get(0)?, open_count: row.get(1)?,
            in_progress: row.get(2)?, completed: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------- Condition Monitoring (پایش وضعیت) ----------
#[derive(Serialize)]
struct ConditionPoint {
    id: i64,
    asset_id: i64,
    asset_code: String,
    asset_name: String,
    name: String,
    parameter: String,
    unit: String,
    warning_limit: Option<f64>,
    alarm_limit: Option<f64>,
    direction: String,
    is_active: bool,
    latest_value: Option<f64>,
    latest_at: String,
    status: String, // ok / warning / alarm / nodata
}

#[derive(Deserialize)]
struct ConditionPointInput {
    id: Option<i64>,
    asset_id: i64,
    name: String,
    #[serde(default)] parameter: String,
    #[serde(default)] unit: String,
    #[serde(default)] warning_limit: Option<f64>,
    #[serde(default)] alarm_limit: Option<f64>,
    #[serde(default)] direction: String,
    #[serde(default)] is_active: bool,
}

#[derive(Serialize)]
struct ConditionReading {
    id: i64,
    value: f64,
    note: String,
    measured_by: String,
    created_at: String,
}

fn eval_condition(value: f64, warning: Option<f64>, alarm: Option<f64>, direction: &str) -> String {
    let high_bad = direction != "down";
    if high_bad {
        if let Some(a) = alarm { if value >= a { return "alarm".to_string(); } }
        if let Some(w) = warning { if value >= w { return "warning".to_string(); } }
    } else {
        if let Some(a) = alarm { if value <= a { return "alarm".to_string(); } }
        if let Some(w) = warning { if value <= w { return "warning".to_string(); } }
    }
    "ok".to_string()
}

#[tauri::command]
fn get_condition_points(db: State<Db>, asset_id: Option<i64>) -> Result<Vec<ConditionPoint>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    // rusqlite به تعداد دقیق پارامترها حساس است؛ هر دو مسیر جداگانه ساخته می‌شوند
    let base = "SELECT p.id, p.asset_id, a.code, a.name, p.name, p.parameter, p.unit,
                p.warning_limit, p.alarm_limit, p.direction, p.is_active,
                (SELECT r.value FROM condition_readings r WHERE r.point_id = p.id ORDER BY r.id DESC LIMIT 1),
                COALESCE((SELECT MAX(r.created_at) FROM condition_readings r WHERE r.point_id = p.id), '')
                FROM condition_points p JOIN assets a ON a.id = p.asset_id ";
    let (sql, arg): (String, Option<i64>) = match asset_id {
        Some(a) => (format!("{} WHERE p.asset_id = ?1 ORDER BY a.code, p.id", base), Some(a)),
        None => (format!("{} WHERE p.is_active = 1 ORDER BY a.code, p.id", base), None),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = match arg {
        Some(a) => stmt.query(params![a]),
        None => stmt.query([]),
    }.map_err(|e| e.to_string())?;
    let rows = rows.mapped(|row| {
        let warn: Option<f64> = row.get(7)?;
        let alarm: Option<f64> = row.get(8)?;
        let dir: String = row.get(9)?;
        let latest: Option<f64> = row.get(11)?;
        let status = match latest {
            Some(v) => eval_condition(v, warn, alarm, &dir),
            None => "nodata".to_string(),
        };
        Ok(ConditionPoint {
            id: row.get(0)?, asset_id: row.get(1)?, asset_code: row.get(2)?, asset_name: row.get(3)?,
            name: row.get(4)?, parameter: row.get(5)?, unit: row.get(6)?,
            warning_limit: warn, alarm_limit: alarm, direction: dir,
            is_active: row.get::<_, i64>(10)? == 1,
            latest_value: latest, latest_at: row.get(12)?, status,
        })
    });
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_condition_point(db: State<Db>, point: ConditionPointInput) -> Result<i64, String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    if point.name.trim().is_empty() { return Err("نام نقطه اندازه‌گیری الزامی است.".to_string()); }
    if point.direction != "down" && point.direction != "up" {
        return Err("جهت آستانه نامعتبر است.".to_string());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let active = if point.is_active { 1 } else { 0 };
    let id = match point.id {
        Some(id) => conn.execute(
            "UPDATE condition_points SET asset_id=?1, name=?2, parameter=?3, unit=?4,
             warning_limit=?5, alarm_limit=?6, direction=?7, is_active=?8 WHERE id=?9",
            params![point.asset_id, point.name, point.parameter, point.unit,
                    point.warning_limit, point.alarm_limit, point.direction, active, id],
        ).map(|_| id),
        None => conn.execute(
            "INSERT INTO condition_points (asset_id, name, parameter, unit, warning_limit, alarm_limit, direction, is_active)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![point.asset_id, point.name, point.parameter, point.unit,
                    point.warning_limit, point.alarm_limit, point.direction, active],
        ).map(|_| conn.last_insert_rowid()),
    }.map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), if point.id.is_some() { "update" } else { "create" },
              "condition_point", id, &point.name);
    Ok(id)
}

#[tauri::command]
fn delete_condition_point(db: State<Db>, id: i64) -> Result<(), String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM condition_points WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&user), "delete", "condition_point", id, "");
    Ok(())
}

#[tauri::command]
fn record_condition_reading(db: State<Db>, point_id: i64, value: f64, note: String) -> Result<String, String> {
    let user = require_perm(&db, PERM_WORKORDERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO condition_readings (point_id, value, note, measured_by) VALUES (?1,?2,?3,?4)",
        params![point_id, value, note, user.username],
    ).map_err(|e| e.to_string())?;
    let (warn, alarm, dir, name, asset_id): (Option<f64>, Option<f64>, String, String, i64) = conn.query_row(
        "SELECT warning_limit, alarm_limit, direction, name, asset_id FROM condition_points WHERE id=?1",
        params![point_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ).map_err(|e| e.to_string())?;
    let status = eval_condition(value, warn, alarm, &dir);
    log_audit(&conn, Some(&user), "create", "condition_reading", point_id,
              &format!("{} = {} ({})", name, value, status));
    // هشدار: ایجاد خودکار دستورکار در صورت عبور از آستانه آلارم
    if status == "alarm" {
        let open_exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM work_orders WHERE condition_point_id=?1 AND status NOT IN ('لغو شده','بسته شده')",
            params![point_id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if open_exists == 0 {
            let mname: String = conn.query_row("SELECT name FROM machines WHERE id=?1", params![asset_id], |r| r.get(0))
                .unwrap_or_default();
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM work_orders", [], |r| r.get(0)).unwrap_or(0);
            let wo_number = format!("WO-{:05}", count + 1);
            conn.execute(
                "INSERT INTO work_orders (machine_id, wo_number, description, priority, assigned_to, wo_type, failure_mode, requested_by, status, condition_point_id)
                 VALUES (?1,?2,?3,'بالا','','پیشگیرانه','خرابی ناشی از پایش وضعیت',?4,'درخواست',?5)",
                params![asset_id, wo_number, format!("هشدار CM: {} ({}) = {} — تعمیرات پیش‌بینانه", name, mname, value), "CM-Monitor", point_id],
            ).ok();
            return Ok(format!("⚠️ آلارم! دستورکار پیش‌بینانه {} ایجاد شد.", wo_number));
        }
        return Ok("⚠️ آلارم! (دستورکار باز قبلاً وجود دارد)".to_string());
    }
    Ok(format!("خواندن ثبت شد — وضعیت: {}", if status == "warning" { "⚠️ هشدار" } else { "✅ نرمال" }))
}

#[tauri::command]
fn get_condition_readings(db: State<Db>, point_id: i64) -> Result<Vec<ConditionReading>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, value, note, measured_by, created_at FROM condition_readings WHERE point_id=?1 ORDER BY id DESC LIMIT 50"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![point_id], |row| {
        Ok(ConditionReading {
            id: row.get(0)?, value: row.get(1)?, note: row.get(2)?,
            measured_by: row.get(3)?, created_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// بررسی کلی نقاط و ایجاد دستورکارهای پیش‌بینانه (برای هشدارهای بدون WO)
#[tauri::command]
fn generate_condition_work_orders(db: State<Db>) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.warning_limit, p.alarm_limit, p.direction, p.asset_id, a.name
         FROM condition_points p JOIN assets a ON a.id = p.asset_id WHERE p.is_active = 1"
    ).map_err(|e| e.to_string())?;
    let points: Vec<(i64, String, Option<f64>, Option<f64>, String, i64, String)> =
        stmt.query_map([], |row| Ok((
            row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?,
        ))).map_err(|e| e.to_string())?
        .collect::<Result<_, _>>().map_err(|e| e.to_string())?;

    let mut generated = 0;
    for (pid, pname, warn, alarm, dir, asset_id, aname) in points {
        let latest: Option<f64> = conn.query_row(
            "SELECT value FROM condition_readings WHERE point_id=?1 ORDER BY id DESC LIMIT 1",
            params![pid], |r| r.get(0)).ok().flatten();
        let v = match latest { Some(v) => v, None => continue };
        let status = eval_condition(v, warn, alarm, &dir);
        if status != "alarm" && status != "warning" { continue; }
        let open_exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM work_orders WHERE condition_point_id=?1 AND status NOT IN ('لغو شده','بسته شده')",
            params![pid], |r| r.get(0)).map_err(|e| e.to_string())?;
        if open_exists > 0 { continue; }
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM work_orders", [], |r| r.get(0)).unwrap_or(0);
        let wo_number = format!("WO-{:05}", count + 1);
        let priority = if status == "alarm" { "بالا" } else { "متوسط" };
        conn.execute(
            "INSERT INTO work_orders (machine_id, wo_number, description, priority, wo_type, failure_mode, requested_by, status, condition_point_id)
             VALUES (?1,?2,?3,?4,'پیشگیرانه','خرابی ناشی از پایش وضعیت','CM-Monitor','درخواست',?5)",
            params![asset_id, wo_number,
                    format!("{} CM: {} ({}) = {}", if status == "alarm" { "آلارم" } else { "هشدار" }, pname, aname, v),
                    priority, pid],
        ).map_err(|e| e.to_string())?;
        generated += 1;
        log_audit(&conn, None, "create", "work_order", asset_id,
                  &format!("{} (پیش‌بینانه از CM)", wo_number));
    }
    Ok(generated)
}

// ---------- مدیریت کاربران ----------
#[tauri::command]
fn get_users(db: State<Db>) -> Result<Vec<UserRow>, String> {
    require_perm(&db, PERM_USERS)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT u.id, u.username, u.full_name, r.name, u.role_id, u.is_active, u.created_at
         FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(UserRow {
            id: row.get(0)?, username: row.get(1)?, full_name: row.get(2)?,
            role_name: row.get(3)?, role_id: row.get(4)?,
            is_active: row.get::<_, i64>(5)? == 1, created_at: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_user(db: State<Db>, user: UserInput) -> Result<(), String> {
    let actor = require_perm(&db, PERM_USERS)?;
    if user.username.trim().is_empty() {
        return Err("نام کاربری الزامی است.".to_string());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let active = if user.is_active { 1 } else { 0 };
    let uid = match user.id {
        Some(id) => {
            if let Some(pw) = &user.password {
                if !pw.is_empty() {
                    conn.execute("UPDATE users SET password_hash=?1 WHERE id=?2",
                        params![hash_password(pw, "cmms-default-salt"), id]).map_err(|e| e.to_string())?;
                }
            }
            conn.execute(
                "UPDATE users SET username=?1, full_name=?2, role_id=?3, is_active=?4 WHERE id=?5",
                params![user.username, user.full_name, user.role_id, active, id],
            ).map(|_| id)
        }
        None => {
            let pw = user.password.clone().unwrap_or_default();
            if pw.is_empty() { return Err("رمز عبور برای کاربر جدید الزامی است.".to_string()); }
            conn.execute(
                "INSERT INTO users (username, full_name, password_hash, role_id, is_active) VALUES (?1,?2,?3,?4,?5)",
                params![user.username, user.full_name, hash_password(&pw, "cmms-default-salt"), user.role_id, active],
            ).map(|_| conn.last_insert_rowid())
        }
    }.map_err(|e| {
        if e.to_string().contains("UNIQUE") { "این نام کاربری قبلاً ثبت شده است.".to_string() } else { e.to_string() }
    })?;
    log_audit(&conn, Some(&actor), if user.id.is_some() { "update" } else { "create" },
              "user", uid, &user.username);
    Ok(())
}

#[tauri::command]
fn delete_user(db: State<Db>, id: i64) -> Result<String, String> {
    let actor = require_perm(&db, PERM_USERS)?;
    if actor.id == id {
        return Err("نمی‌توانید حساب خودتان را حذف کنید.".to_string());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let username: String = conn.query_row("SELECT username FROM users WHERE id=?1", params![id], |r| r.get(0))
        .map_err(|_| "کاربر یافت نشد.".to_string())?;
    conn.execute("DELETE FROM users WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    log_audit(&conn, Some(&actor), "delete", "user", id, &username);
    Ok("کاربر حذف شد.".to_string())
}

// ---------- مدیریت نقش‌ها ----------
#[tauri::command]
fn get_roles(db: State<Db>) -> Result<Vec<Role>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, name, permissions FROM roles ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        let perms: String = row.get(2)?;
        Ok(Role {
            id: row.get(0)?, name: row.get(1)?,
            permissions: serde_json::from_str(&perms).unwrap_or_default(),
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_role(db: State<Db>, role: RoleInput) -> Result<(), String> {
    let actor = require_perm(&db, PERM_USERS)?;
    if role.name.trim().is_empty() {
        return Err("نام نقش الزامی است.".to_string());
    }
    let perms = serde_json::to_string(&role.permissions).map_err(|e| e.to_string())?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let rid = match role.id {
        Some(id) => conn.execute(
            "UPDATE roles SET name=?1, permissions=?2 WHERE id=?3",
            params![role.name, perms, id]).map(|_| id),
        None => conn.execute(
            "INSERT INTO roles (name, permissions) VALUES (?1,?2)",
            params![role.name, perms]).map(|_| conn.last_insert_rowid()),
    }.map_err(|e| {
        if e.to_string().contains("UNIQUE") { "این نقش قبلاً ثبت شده است.".to_string() } else { e.to_string() }
    })?;
    log_audit(&conn, Some(&actor), if role.id.is_some() { "update" } else { "create" },
              "role", rid, &role.name);
    Ok(())
}

// ---------- تأییدها ----------
#[tauri::command]
fn get_approvals(db: State<Db>) -> Result<Vec<ApprovalRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, action, entity_type, entity_id, entity_label, status, requested_by,
                created_at, decided_by, decided_at, note FROM approvals ORDER BY id DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(ApprovalRow {
            id: row.get(0)?, action: row.get(1)?, entity_type: row.get(2)?,
            entity_id: row.get(3)?, entity_label: row.get(4)?, status: row.get(5)?,
            requested_by: row.get(6)?, created_at: row.get(7)?, decided_by: row.get(8)?,
            decided_at: row.get(9)?, note: row.get(10)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn decide_approval(db: State<Db>, id: i64, approve: bool, note: String) -> Result<String, String> {
    let user = require_perm(&db, PERM_APPROVE)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let (entity_type, entity_id): (String, i64) = conn.query_row(
        "SELECT entity_type, entity_id FROM approvals WHERE id=?1 AND status='در انتظار'",
        params![id], |r| Ok((r.get(0)?, r.get(1)?))
    ).map_err(|_| "درخواست یافت نشد یا قبلاً بررسی شده است.".to_string())?;

    let status = if approve { "تأیید شده" } else { "رد شده" };
    conn.execute(
        "UPDATE approvals SET status=?1, decided_by=?2, decided_at=datetime('now'), note=?3 WHERE id=?4",
        params![status, user.username, note, id],
    ).map_err(|e| e.to_string())?;

    // اجرای عملیات در صورت تأیید (فعلاً: حذف دستگاه)
    if approve && entity_type == "work_order" {
        conn.execute("UPDATE work_orders SET status='تأیید شده' WHERE id=?1 AND status='درخواست'", params![entity_id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO work_order_history (work_order_id, from_status, to_status, note, changed_by) VALUES (?1,'درخواست','تأیید شده','تأیید دستورکار اورژانسی',?2)",
            params![entity_id, user.username],
        ).ok();
    } else if approve && entity_type == "asset" {
        let children: i64 = conn.query_row("SELECT COUNT(*) FROM assets WHERE parent_id=?1", params![entity_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if children > 0 { return Err("دارایی دارای زیرمجموعه است؛ حذف لغو شد.".to_string()); }
        let wo: i64 = conn.query_row("SELECT COUNT(*) FROM work_orders WHERE machine_id=?1", params![entity_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if wo > 0 { return Err("برای این تجهیز سفارش تعمیر ثبت شده؛ حذف لغو شد.".to_string()); }
        conn.execute("DELETE FROM assets WHERE id=?1", params![entity_id]).map_err(|e| e.to_string())?;
    } else if approve && entity_type == "machine" {
        conn.execute("DELETE FROM machines WHERE id=?1", params![entity_id])
            .map_err(|e| e.to_string())?;
    }
    log_audit(&conn, Some(&user), "decide_approval", &entity_type, entity_id,
              &format!("{} → {}", status, note));
    Ok(format!("درخواست {} شد.", status))
}

// ---------- گزارش فعالیت ----------
#[tauri::command]
fn get_audit_log(db: State<Db>) -> Result<Vec<AuditRow>, String> {
    require_perm(&db, PERM_AUDIT)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, username, action, entity_type, entity_id, details, created_at
         FROM audit_log ORDER BY id DESC LIMIT 500"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(AuditRow {
            id: row.get(0)?, username: row.get(1)?, action: row.get(2)?,
            entity_type: row.get(3)?, entity_id: row.get(4)?,
            details: row.get(5)?, created_at: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------- اجرای اپلیکیشن ----------
fn main() {
    let app_dir = std::path::PathBuf::from(
        std::env::var("APPDATA").expect("APPDATA not set")
    ).join("com.cmms.app");
    std::fs::create_dir_all(&app_dir).expect("cannot create app data dir");
    let conn = Connection::open(app_dir.join("cmms.db")).expect("cannot open database");
    migrate(&conn).expect("migration failed");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Db { conn: Mutex::new(conn), user: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            login, logout, get_current_user,
            get_machines,
            get_assets, save_asset, delete_asset, get_asset_classes,
            get_asset_documents, save_asset_document, delete_asset_document, pick_file,
            get_checklist_items, add_checklist_item, remove_checklist_item,
            create_work_order, get_work_orders, set_work_order_status, update_work_order,
            get_work_order_history, get_field_history,
            get_parts, save_part, get_work_order_parts, add_work_order_part, remove_work_order_part,
            get_job_plans, save_job_plan, delete_job_plan, get_job_plan_steps, add_job_plan_step,
            remove_job_plan_step, get_job_plan_parts, add_job_plan_part, remove_job_plan_part,
            get_pm_programs, save_pm_program, delete_pm_program, generate_pm_work_orders,
            record_meter_reading, get_meter_readings,
            stock_in, stock_adjust, get_stock_transactions,
            reserve_part, get_reservations, set_reservation_status,
            get_bom, add_bom_item, remove_bom_item,
            get_rcas, save_rca, delete_rca, get_rca_detail, save_rca_why,
            get_kpis, get_calendar, get_technician_workload,
            get_condition_points, save_condition_point, delete_condition_point,
            record_condition_reading, get_condition_readings, generate_condition_work_orders,
            add_rca_action, set_rca_action_status, remove_rca_action,
            get_users, save_user, delete_user,
            get_roles, save_role,
            get_approvals, decide_approval,
            get_audit_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
