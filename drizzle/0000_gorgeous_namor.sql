CREATE TABLE `ro_diagnosis_watch` (
	`ro_number` text PRIMARY KEY NOT NULL,
	`needs_diag_present` integer DEFAULT 0 NOT NULL,
	`last_label` text DEFAULT '' NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ro_verification_cycles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ro_number` text NOT NULL,
	`customer` text NOT NULL,
	`vehicle` text NOT NULL,
	`service_writer` text NOT NULL,
	`detail_url` text DEFAULT '' NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`section` text NOT NULL,
	`diagnosed_at` text NOT NULL,
	`verify_label_seen_at` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`verified_at` text,
	`verified_by` text,
	`verification_note` text DEFAULT '' NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ro_verification_status_idx` ON `ro_verification_cycles` (`status`,`diagnosed_at`);