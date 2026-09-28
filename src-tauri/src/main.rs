use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

struct Db(Mutex<Connection>);

// ---------- مدل‌ها ----------
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
    warranty_status: String, // "معتبر" یا "منقضی"
}

#[derive(Deserialize)]
struct MachineInput {
    id: Option<i64>,
    code: String,
    name: String,
    #[serde(default)] model: String,
    #[serde(default)] serial_number: String,
    #[serde(default)] manufacturer: String,
    #[serde(default)] manufacturer_phone: String,
    #[serde(default)] manufacturer_email: String,
    #[serde(default)] manufacturer_website: String,
    #[serde(default)] purchase_date: String,
    #[serde(default)] warranty_months: i64,
    #[serde(default)] location: String,
    #[serde(default)] description: String,
}

#[derive(Serialize)]
struct ChecklistItem {
    id: i64,
    description: String,
}

#[derive(Serialize)]
struct WorkOrder {
    id: i64,
    wo_number: String,
    machine_name: String,
    description: String,
    priority: String,
    status: String,
    assigned_to: String,
    created_at: String,
}

#[derive(Deserialize)]
struct WorkOrderInput {
    description: String,
    #[serde(default)] priority: String,
    #[serde(default)] assigned_to: String,
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
        check_type TEXT NOT NULL,               -- daily / weekly / monthly
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
    ")?;
    Ok(())
}

// ---------- کامندها ----------
#[tauri::command]
fn get_machines(db: State<Db>) -> Result<Vec<Machine>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, code, name, model, serial_number, manufacturer, manufacturer_phone,
                manufacturer_email, manufacturer_website, purchase_date, warranty_months,
                location, description FROM machines ORDER BY code"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        let months: i64 = row.get(10)?;
        let purchase: String = row.get(9)?;
        let warranty_status = if months > 0 && !purchase.is_empty() {
            let valid = chrono::NaiveDate::parse_from_str(&purchase, "%Y-%m-%d")
                .map(|d| d + chrono::Duration::days(months * 30))
                .map(|end| end >= chrono::Utc::now().date_naive())
                .unwrap_or(false);
            if valid { "معتبر".to_string() } else { "منقضی".to_string() }
        } else { "نامشخص".to_string() };
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

#[tauri::command]
fn save_machine(db: State<Db>, machine: MachineInput) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match machine.id {
        Some(id) => conn.execute(
            "UPDATE machines SET code=?1, name=?2, model=?3, serial_number=?4, manufacturer=?5,
             manufacturer_phone=?6, manufacturer_email=?7, manufacturer_website=?8,
             purchase_date=?9, warranty_months=?10, location=?11, description=?12 WHERE id=?13",
            params![machine.code, machine.name, machine.model, machine.serial_number,
                    machine.manufacturer, machine.manufacturer_phone, machine.manufacturer_email,
                    machine.manufacturer_website, machine.purchase_date, machine.warranty_months,
                    machine.location, machine.description, id],
        ),
        None => conn.execute(
            "INSERT INTO machines (code, name, model, serial_number, manufacturer,
             manufacturer_phone, manufacturer_email, manufacturer_website,
             purchase_date, warranty_months, location, description)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![machine.code, machine.name, machine.model, machine.serial_number,
                    machine.manufacturer, machine.manufacturer_phone, machine.manufacturer_email,
                    machine.manufacturer_website, machine.purchase_date, machine.warranty_months,
                    machine.location, machine.description],
        ),
    }.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_machine(db: State<Db>, id: i64) -> Result<(), String> {
    db.0.lock().map_err(|e| e.to_string())?
        .execute("DELETE FROM machines WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_checklist_items(db: State<Db>, machine_id: i64, check_type: String) -> Result<Vec<ChecklistItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
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
    db.0.lock().map_err(|e| e.to_string())?
        .execute("INSERT OR IGNORE INTO checklist_items (machine_id, check_type, description) VALUES (?1,?2,?3)",
                 params![machine_id, check_type, description])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_checklist_item(db: State<Db>, id: i64) -> Result<(), String> {
    db.0.lock().map_err(|e| e.to_string())?
        .execute("DELETE FROM checklist_items WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn create_work_order(db: State<Db>, machine_id: i64, order: WorkOrderInput) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM work_orders", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let wo_number = format!("WO-{:05}", count + 1);
    conn.execute(
        "INSERT INTO work_orders (machine_id, wo_number, description, priority, assigned_to) VALUES (?1,?2,?3,?4,?5)",
        params![machine_id, wo_number, order.description, order.priority, order.assigned_to],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_work_orders(db: State<Db>) -> Result<Vec<WorkOrder>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT w.id, w.wo_number, m.name, w.description, w.priority, w.status, w.assigned_to, w.created_at
         FROM work_orders w JOIN machines m ON m.id = w.machine_id
         ORDER BY w.id DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(WorkOrder {
            id: row.get(0)?, wo_number: row.get(1)?, machine_name: row.get(2)?,
            description: row.get(3)?, priority: row.get(4)?, status: row.get(5)?,
            assigned_to: row.get(6)?, created_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_work_order_status(db: State<Db>, id: i64, status: String) -> Result<(), String> {
    db.0.lock().map_err(|e| e.to_string())?
        .execute("UPDATE work_orders SET status=?1 WHERE id=?2", params![status, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- اجرای اپلیکیشن ----------
fn main() {
    let app_dir = tauri::path::BaseDirectory::AppData
        .resolve("", &tauri::Config::default())
        .expect("cannot resolve app data dir");
    std::fs::create_dir_all(&app_dir).expect("cannot create app data dir");
    let conn = Connection::open(app_dir.join("cmms.db")).expect("cannot open database");
    migrate(&conn).expect("migration failed");

    tauri::Builder::default()
        .manage(Db(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            get_machines, save_machine, delete_machine,
            get_checklist_items, add_checklist_item, remove_checklist_item,
            create_work_order, get_work_orders, set_work_order_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
