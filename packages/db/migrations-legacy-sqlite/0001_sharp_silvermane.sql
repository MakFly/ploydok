CREATE TABLE `builds` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`build_method` text,
	`image_tag` text,
	`container_id` text,
	`commit_sha` text,
	`log_path` text,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `builds_app_id_idx` ON `builds` (`app_id`);--> statement-breakpoint
CREATE INDEX `builds_status_idx` ON `builds` (`status`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`error` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`run_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_at_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
ALTER TABLE `apps` ADD `git_provider` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `repo_full_name` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `branch` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `root_dir` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `dockerfile_path` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `install_command` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `build_command` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `start_command` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `watch_paths` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `container_id` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `domain` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `build_method` text DEFAULT 'auto';--> statement-breakpoint
ALTER TABLE `apps` ADD `healthcheck_path` text DEFAULT '/';--> statement-breakpoint
ALTER TABLE `apps` ADD `healthcheck_port` integer;--> statement-breakpoint
ALTER TABLE `apps` ADD `healthcheck_interval_s` integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE `apps` ADD `healthcheck_timeout_s` integer DEFAULT 3;--> statement-breakpoint
ALTER TABLE `apps` ADD `healthcheck_retries` integer DEFAULT 6;--> statement-breakpoint
ALTER TABLE `apps` ADD `healthcheck_start_period_s` integer DEFAULT 0;