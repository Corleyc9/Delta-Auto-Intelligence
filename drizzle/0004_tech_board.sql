-- Tech Board Phase 1. Safe to re-run (IF NOT EXISTS); the API also creates these lazily.
CREATE TABLE IF NOT EXISTS `board_jobs` (
	`ro` text PRIMARY KEY NOT NULL,
	`vehicle` text DEFAULT '' NOT NULL,
	`customer` text DEFAULT '' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`detail_url` text DEFAULT '' NOT NULL,
	`tech` text DEFAULT 'UN' NOT NULL,
	`assigned_tech` text,
	`labor_guide_hours` real DEFAULT 0 NOT NULL,
	`tech_estimate_hours` real,
	`lane_date` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`start_minute` integer DEFAULT 0 NOT NULL,
	`duration_minutes` integer DEFAULT 60 NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`placed_by` text DEFAULT 'auto' NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`in_diag_block` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`updated_at` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`custom` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`duration_override_minutes` integer,
	`linked_ro` text,
	`carried_over` integer DEFAULT 0 NOT NULL,
	`ro_number` text DEFAULT '' NOT NULL,
	`job_name` text DEFAULT '' NOT NULL,
	`job_order` integer DEFAULT 0 NOT NULL,
	`logged_seconds` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `board_jobs_lane_idx` ON `board_jobs` (`lane_date`,`tech`,`position`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tech_capacity` (
	`initials` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`day_minutes` integer DEFAULT 480 NOT NULL,
	`diag_block_minutes` integer DEFAULT 120 NOT NULL,
	`day_start_minute` integer DEFAULT 480 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `tech_capacity` (`initials`,`name`,`sort_order`) VALUES
	('MC','Mike Cook',0),('AN','Andrew Nelson',1),('BC','Beau Corley',2),('MB','Mario Butler',3),('SW','Stacy Williams',4);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `board_job_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ro` text NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`percent_complete` real,
	`comment` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `board_job_updates_ro_idx` ON `board_job_updates` (`ro`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tech_time_off` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`initials` text NOT NULL,
	`date` text NOT NULL,
	`start_minute` integer DEFAULT 0 NOT NULL,
	`end_minute` integer DEFAULT 0 NOT NULL,
	`all_day` integer DEFAULT 0 NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tech_time_off_date_idx` ON `tech_time_off` (`date`,`initials`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `board_pool_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ro` text NOT NULL,
	`tech` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`decided_by` text,
	`decided_at` text
);
-- (former Phase 3 placeholder, now built): tech_time_off (id, initials, date, start_minute, minutes, status, requested_at, approved_by)

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tech_pins (
	initials TEXT PRIMARY KEY,
	salt TEXT NOT NULL,
	pin_hash TEXT NOT NULL,
	iterations INTEGER NOT NULL,
	failed_attempts INTEGER NOT NULL DEFAULT 0,
	locked_until TEXT,
	updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS board_suggestions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	text TEXT NOT NULL,
	category TEXT NOT NULL DEFAULT 'Other',
	submitter TEXT NOT NULL DEFAULT '',
	submitter_tech TEXT,
	source TEXT NOT NULL DEFAULT 'writer',
	status TEXT NOT NULL DEFAULT 'New',
	reply TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS board_change_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	source TEXT NOT NULL,
	actor TEXT NOT NULL DEFAULT '',
	action TEXT NOT NULL,
	ro TEXT NOT NULL DEFAULT '',
	body_json TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `board_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`ro` text NOT NULL,
	`job_key` text NOT NULL,
	`kind` text DEFAULT '' NOT NULL,
	`percent` integer,
	`message` text NOT NULL,
	`dedupe_key` text NOT NULL UNIQUE,
	`source` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`posted_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `board_events_unposted` ON `board_events` (`posted_at`, `id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `board_job_status` (
	`ro` text NOT NULL,
	`job_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`technician` text DEFAULT '' NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`ro`, `job_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `board_notify_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer,
	`ok` integer NOT NULL,
	`status` integer,
	`error` text DEFAULT '' NOT NULL,
	`at` text NOT NULL
);
