CREATE TABLE IF NOT EXISTS tekmetric_webhook_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	delivery_id TEXT NOT NULL UNIQUE,
	event_family TEXT NOT NULL,
	event_name TEXT NOT NULL,
	source_event TEXT NOT NULL DEFAULT '',
	shop_id TEXT NOT NULL DEFAULT '',
	shop_matches INTEGER NOT NULL DEFAULT 1,
	repair_order_id TEXT NOT NULL DEFAULT '',
	repair_order_number TEXT NOT NULL DEFAULT '',
	appointment_id TEXT NOT NULL DEFAULT '',
	payment_id TEXT NOT NULL DEFAULT '',
	inspection_id TEXT NOT NULL DEFAULT '',
	order_id TEXT NOT NULL DEFAULT '',
	customer TEXT NOT NULL DEFAULT '',
	vehicle TEXT NOT NULL DEFAULT '',
	service_writer TEXT NOT NULL DEFAULT '',
	label TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT '',
	hours REAL,
	amount REAL,
	decision TEXT NOT NULL DEFAULT '',
	occurred_at TEXT,
	received_at TEXT NOT NULL,
	raw_headers_json TEXT NOT NULL DEFAULT '{}',
	raw_body TEXT NOT NULL,
	payload_json TEXT NOT NULL DEFAULT '{}',
	truncated INTEGER NOT NULL DEFAULT 0,
	side_effects_json TEXT NOT NULL DEFAULT '[]'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tekmetric_webhook_events_received_idx ON tekmetric_webhook_events (received_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tekmetric_webhook_events_ro_idx ON tekmetric_webhook_events (repair_order_number, received_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tekmetric_webhook_signals (
	signal_key TEXT PRIMARY KEY,
	event_id INTEGER,
	event_name TEXT NOT NULL,
	repair_order_number TEXT NOT NULL DEFAULT '',
	detail TEXT NOT NULL DEFAULT '',
	occurred_at TEXT NOT NULL,
	received_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ro_approval_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	ro_number TEXT NOT NULL,
	customer TEXT NOT NULL DEFAULT '',
	vehicle TEXT NOT NULL DEFAULT '',
	decision TEXT NOT NULL,
	hours REAL,
	occurred_at TEXT NOT NULL,
	received_at TEXT NOT NULL,
	webhook_event_id INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ro_approval_events_ro_idx ON ro_approval_events (ro_number, occurred_at DESC);
