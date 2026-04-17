CREATE TABLE `env_vars` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`secret` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `env_vars_app_key_unique` ON `env_vars` (`app_id`,`key`);--> statement-breakpoint
CREATE INDEX `env_vars_app_id_idx` ON `env_vars` (`app_id`);