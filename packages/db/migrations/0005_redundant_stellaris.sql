CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`hostname` text NOT NULL,
	`tls_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_hostname_unique` ON `domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `domains_app_id_idx` ON `domains` (`app_id`);