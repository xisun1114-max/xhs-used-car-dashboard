CREATE TABLE `note_uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`note_id` text NOT NULL,
	`actor` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `maintenance_tasks` ADD `resolution_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_tasks` ADD `notes_html` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `maintenance_tasks` SET `resolution_status` = 'done' WHERE `status` = 'completed';
