CREATE TABLE `budget_fuel_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`car_id` integer NOT NULL,
	`date` text NOT NULL,
	`total_cents` integer NOT NULL,
	`payee` text NOT NULL,
	`memo` text NOT NULL,
	`source_file` text NOT NULL,
	`source_record` integer NOT NULL,
	`source_key` text NOT NULL,
	`imported_at` integer NOT NULL,
	FOREIGN KEY (`car_id`) REFERENCES `cars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_fuel_payments_source_key_unique` ON `budget_fuel_payments` (`source_key`);--> statement-breakpoint
CREATE INDEX `budget_fuel_payments_car_date` ON `budget_fuel_payments` (`car_id`,`date`);