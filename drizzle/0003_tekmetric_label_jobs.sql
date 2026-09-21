CREATE TABLE IF NOT EXISTS tekmetric_label_jobs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	ro_number TEXT NOT NULL,
	verification_id INTEGER,
	target_label TEXT NOT NULL,
	current_label TEXT NOT NULL DEFAULT '',
	detail_url TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	claimed_at TEXT,
	completed_at TEXT,
	last_error TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tekmetric_label_jobs_status_idx ON tekmetric_label_jobs (status, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tekmetric_label_jobs_ro_idx ON tekmetric_label_jobs (ro_number, created_at DESC);
--> statement-breakpoint
ALTER TABLE ro_verification_cycles ADD COLUMN tekmetric_label_status TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE ro_verification_cycles ADD COLUMN tekmetric_label_target TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE ro_verification_cycles ADD COLUMN tekmetric_label_error TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE ro_verification_cycles ADD COLUMN tekmetric_label_updated_at TEXT;
--> statement-breakpoint
ALTER TABLE ro_verification_cycles ADD COLUMN tekmetric_label_job_id INTEGER;
