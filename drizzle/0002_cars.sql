CREATE TABLE `cars` (
	`id` integer PRIMARY KEY NOT NULL,
	`nickname` text NOT NULL,
	`year` integer,
	`make` text,
	`model` text,
	`trim` text,
	`engine` text,
	`color` text,
	`plate` text,
	`vin` text,
	`vin_details` text,
	`vin_decoded_at` integer,
	`reference` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `odometer_readings` (
	`id` integer PRIMARY KEY NOT NULL,
	`car_id` integer NOT NULL,
	`miles` integer NOT NULL,
	`read_at` integer NOT NULL,
	`source` text NOT NULL,
	`source_id` integer,
	`note` text,
	`created_by` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`car_id`) REFERENCES `cars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `odometer_readings_car_read_at` ON `odometer_readings` (`car_id`,`read_at`);