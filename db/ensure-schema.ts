const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS shop_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    total_sales REAL NOT NULL,
    gross_profit REAL NOT NULL,
    labor_sales REAL NOT NULL,
    technicians_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS shop_snapshots_captured_idx ON shop_snapshots(captured_at DESC)`,
  `CREATE TABLE IF NOT EXISTS service_writer_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    writers_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS job_board_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repair_orders_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reader_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL,
    detail TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    build_hash TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS ro_diagnosis_watch (
    ro_number TEXT PRIMARY KEY,
    needs_diag_present INTEGER NOT NULL DEFAULT 0,
    last_label TEXT NOT NULL DEFAULT '',
    last_seen_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ro_verification_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ro_number TEXT NOT NULL,
    customer TEXT NOT NULL,
    vehicle TEXT NOT NULL,
    service_writer TEXT NOT NULL,
    detail_url TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    section TEXT NOT NULL,
    diagnosed_at TEXT NOT NULL,
    verify_label_seen_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    verified_at TEXT,
    verified_by TEXT,
    verification_note TEXT NOT NULL DEFAULT '',
    last_seen_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ro_verification_status_idx
    ON ro_verification_cycles (status, diagnosed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ro_sold_hours_watch (
    ro_number TEXT PRIMARY KEY, sold_hours REAL NOT NULL DEFAULT 0, last_seen_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ro_sold_hours_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ro_number TEXT NOT NULL,
    customer TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '',
    hours_delta REAL NOT NULL, week_key TEXT NOT NULL, captured_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ro_sold_hours_events_week_idx
    ON ro_sold_hours_events (week_key, captured_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ro_sold_hours_watch_v2 (
    ro_number TEXT PRIMARY KEY, sold_hours REAL NOT NULL DEFAULT 0, last_seen_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ro_sold_hours_events_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ro_number TEXT NOT NULL,
    customer TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '',
    hours_delta REAL NOT NULL, week_key TEXT NOT NULL, captured_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ro_sold_hours_events_v2_week_idx
    ON ro_sold_hours_events_v2 (week_key, captured_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ticket_audit_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date TEXT NOT NULL,
    audits_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ticket_audit_dispositions (
    ro_number TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    hide_until TEXT,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS delta_ai_audits (
    ro_number TEXT PRIMARY KEY,
    customer TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '',
    service_writer TEXT NOT NULL DEFAULT '', detail_url TEXT NOT NULL DEFAULT '',
    source_hash TEXT NOT NULL, conclusion TEXT NOT NULL, summary TEXT NOT NULL,
    review_json TEXT NOT NULL, captured_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS delta_ai_audits_active_idx
    ON delta_ai_audits (active DESC, captured_at DESC)`,
  `CREATE TABLE IF NOT EXISTS delta_ai_cleared (
    ro_number TEXT PRIMARY KEY, source_hash TEXT NOT NULL, cleared_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS goal_miss_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    tickets_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS steer_opportunity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunities_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS steer_opportunity_actions (
    opportunity_key TEXT NOT NULL,
    list_date TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (opportunity_key, list_date)
  )`,
  `CREATE TABLE IF NOT EXISTS schedule_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_date TEXT NOT NULL,
    hour_key TEXT NOT NULL,
    hour_label TEXT NOT NULL,
    employees_json TEXT NOT NULL,
    appointments_json TEXT NOT NULL,
    raw_text TEXT NOT NULL DEFAULT '',
    captured_at TEXT NOT NULL,
    UNIQUE(schedule_date, hour_key)
  )`,
  `CREATE INDEX IF NOT EXISTS schedule_snapshots_date_idx
    ON schedule_snapshots (schedule_date DESC, hour_key DESC)`,
  `CREATE TABLE IF NOT EXISTS schedule_capture_request (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS schedule_snapshot_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_date TEXT NOT NULL,
    hour_key TEXT NOT NULL,
    object_key TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    UNIQUE(schedule_date, hour_key)
  )`,
  `CREATE TABLE IF NOT EXISTS lot_walk_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'uploaded',
    video_key TEXT NOT NULL,
    video_filename TEXT NOT NULL,
    video_size INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    error_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tekmetric_customer_history (
    customer_key TEXT PRIMARY KEY, customer_name TEXT NOT NULL,
    customer_url TEXT NOT NULL, vehicles_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tekmetric_paid_ro_history (
    ro_number TEXT PRIMARY KEY, customer_key TEXT NOT NULL,
    customer_name TEXT NOT NULL, vehicle TEXT NOT NULL DEFAULT '',
    ro_url TEXT NOT NULL DEFAULT '', posted_date TEXT NOT NULL DEFAULT '',
    odometer_out TEXT NOT NULL DEFAULT '', total REAL NOT NULL DEFAULT 0,
    detail_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS tekmetric_paid_ro_customer_idx
    ON tekmetric_paid_ro_history(customer_key, posted_date DESC)`,
  `CREATE TABLE IF NOT EXISTS warranty_claims (
    ro_number TEXT PRIMARY KEY,
    claim_json TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'needs_review',
    claim_number TEXT NOT NULL DEFAULT '',
    payment_amount REAL NOT NULL DEFAULT 0,
    review_note TEXT NOT NULL DEFAULT '',
    captured_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS warranty_claim_original_overrides (
    ro_number TEXT PRIMARY KEY,
    original_ro_number TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS payroll_week_inputs (
    week_start TEXT PRIMARY KEY,
    inputs_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_secrets (
    name TEXT PRIMARY KEY,
    encrypted_value TEXT NOT NULL,
    iv TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

const ALTER_STATEMENTS = [
  `ALTER TABLE reader_status ADD COLUMN version TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE reader_status ADD COLUMN build_hash TEXT NOT NULL DEFAULT ''`,
];

export async function ensureSchema(database: D1Database): Promise<void> {
  await database.batch(TABLE_STATEMENTS.map((sql) => database.prepare(sql)));
  for (const sql of ALTER_STATEMENTS) {
    try {
      await database.prepare(sql).run();
    } catch {
      // Column already exists on databases created from the rebuilt schema.
    }
  }
}
