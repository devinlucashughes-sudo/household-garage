CREATE TABLE `tires` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`car_id` integer NOT NULL,
	`position` text,
	`brand` text,
	`model` text,
	`size` text,
	`dot` text,
	`installed_date` text NOT NULL,
	`installed_miles` integer,
	`service_id` integer,
	`removed_date` text,
	`removed_miles` integer,
	`notes` text,
	`request_key` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`car_id`) REFERENCES `cars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `service_records`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tires_request_key_unique` ON `tires` (`request_key`);--> statement-breakpoint
CREATE INDEX `tires_car` ON `tires` (`car_id`);--> statement-breakpoint
CREATE TABLE `tread_readings` (
	`service_id` integer PRIMARY KEY NOT NULL,
	`lf` integer,
	`rf` integer,
	`lr` integer,
	`rr` integer,
	FOREIGN KEY (`service_id`) REFERENCES `service_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `maintenance_schedules` ADD `asks_tread` integer DEFAULT false NOT NULL;