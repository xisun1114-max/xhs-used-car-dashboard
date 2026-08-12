CREATE TABLE `operation_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`note_id` text NOT NULL,
	`cycle_number` integer NOT NULL,
	`operation_type` text NOT NULL,
	`actor` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `maintenance_tasks` ADD `review_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_tasks` ADD `placement_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_tasks` ADD `dealer_guard_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_tasks` ADD `reply_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_tasks` ADD `recheck_status` text DEFAULT 'pending' NOT NULL;