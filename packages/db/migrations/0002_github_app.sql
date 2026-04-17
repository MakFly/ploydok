CREATE TABLE `github_app` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`client_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`client_secret_enc` blob NOT NULL,
	`client_secret_nonce` blob NOT NULL,
	`pem_enc` blob NOT NULL,
	`pem_nonce` blob NOT NULL,
	`webhook_secret_enc` blob NOT NULL,
	`webhook_secret_nonce` blob NOT NULL,
	`created_at` integer NOT NULL
);
