CREATE TABLE `fuel_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`car_id` integer NOT NULL,
	`date` text NOT NULL,
	`miles` integer NOT NULL,
	`gallons_milli` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`full_tank` integer NOT NULL,
	`missed_fillups` integer DEFAULT false NOT NULL,
	`notes` text,
	`request_key` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`car_id`) REFERENCES `cars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fuel_records_request_key_unique` ON `fuel_records` (`request_key`);--> statement-breakpoint
CREATE INDEX `fuel_records_car_date` ON `fuel_records` (`car_id`,`date`);--> statement-breakpoint
CREATE TABLE `import_draft_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`draft_id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`bytes` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `import_drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_draft_receipts_draft` ON `import_draft_receipts` (`draft_id`);--> statement-breakpoint
CREATE TABLE `import_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`car_id` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`source_label` text,
	`idempotency_key` text NOT NULL,
	`token_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_record_id` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`car_id`) REFERENCES `cars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `import_tokens`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_drafts_idempotency_key_unique` ON `import_drafts` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `import_drafts_status_created` ON `import_drafts` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `import_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_tokens_token_hash_unique` ON `import_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `maintenance_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`car_id` integer NOT NULL,
	`title` text NOT NULL,
	`interval_miles` integer,
	`interval_months` integer,
	`baseline_date` text,
	`baseline_miles` integer,
	`last_service_id` integer,
	`source_draft_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`notes` text,
	`request_key` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`car_id`) REFERENCES `cars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_service_id`) REFERENCES `service_records`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_draft_id`) REFERENCES `import_drafts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maintenance_schedules_request_key_unique` ON `maintenance_schedules` (`request_key`);--> statement-breakpoint
CREATE INDEX `maintenance_schedules_car` ON `maintenance_schedules` (`car_id`);