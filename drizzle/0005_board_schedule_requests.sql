-- Writer schedule inbox. Safe to re-run (IF NOT EXISTS). The Tech Board API also creates this lazily.
-- Board D1 only. These rows never write to Tekmetric and never place a job.
CREATE TABLE IF NOT EXISTS board_schedule_requests (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	text TEXT NOT NULL,
	submitter TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL DEFAULT 'writer',
	status TEXT NOT NULL DEFAULT 'open',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	done_by TEXT NOT NULL DEFAULT '',
	done_at TEXT
);
