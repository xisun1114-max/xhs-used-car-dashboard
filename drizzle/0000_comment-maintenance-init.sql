CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_tasks` (
	`task_id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`task_date` text NOT NULL,
	`cycle_number` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`nickname` text DEFAULT '' NOT NULL,
	`link` text NOT NULL,
	`publish_date` text NOT NULL,
	`priority` text NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`cadence_days` integer DEFAULT 1 NOT NULL,
	`reasons` text DEFAULT '[]' NOT NULL,
	`spend_3d` real DEFAULT 0 NOT NULL,
	`spend_7d` real DEFAULT 0 NOT NULL,
	`spend_total` real DEFAULT 0 NOT NULL,
	`active_days_7d` integer DEFAULT 0 NOT NULL,
	`action_clicks_3d` integer DEFAULT 0 NOT NULL,
	`comments_total` integer DEFAULT 0 NOT NULL,
	`comments_3d` integer,
	`comments_7d` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`review_done` integer DEFAULT false NOT NULL,
	`placement_done` integer DEFAULT false NOT NULL,
	`dealer_guard_done` integer DEFAULT false NOT NULL,
	`reply_done` integer DEFAULT false NOT NULL,
	`recheck_done` integer DEFAULT false NOT NULL,
	`placement_count` integer DEFAULT 0 NOT NULL,
	`risk_tag` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`completed_at` text,
	`completed_comments` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
