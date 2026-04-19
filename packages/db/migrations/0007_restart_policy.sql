ALTER TABLE `apps` ADD `restart_policy` text DEFAULT 'unless-stopped' NOT NULL;--> statement-breakpoint
UPDATE `apps` SET `restart_policy` = 'unless-stopped' WHERE `restart_policy` IS NULL;
