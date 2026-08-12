CREATE TABLE `negative_monitor_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`note_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`from_deadline` text DEFAULT '' NOT NULL,
	`to_deadline` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
