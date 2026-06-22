CREATE TABLE `ai_insight_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`report_json` text NOT NULL,
	`data_fingerprint` text NOT NULL,
	`model` text NOT NULL,
	`brand_count` integer NOT NULL,
	`ad_count` integer NOT NULL,
	`generated_at` text DEFAULT (datetime('now')) NOT NULL
);
