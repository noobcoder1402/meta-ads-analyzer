CREATE TABLE `ad_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`ad_id` text NOT NULL,
	`analyzer_version` text NOT NULL,
	`hook` text,
	`angle` text,
	`angle_secondary` text,
	`visual_summary` text,
	`dominant_colors` text,
	`text_density` text,
	`subject` text,
	`themes` text,
	`pain_points` text,
	`benefits` text,
	`target_persona` text,
	`emotional_tone` text,
	`primary_conversion_goal` text,
	`brand_voice` text,
	`analysis_failed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ad_id`) REFERENCES `ads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ad_analyses_ad_id_unique` ON `ad_analyses` (`ad_id`);--> statement-breakpoint
CREATE TABLE `ads` (
	`id` text PRIMARY KEY NOT NULL,
	`competitor_id` text NOT NULL,
	`library_id` text NOT NULL,
	`caption` text,
	`cta_label` text,
	`landing_url` text,
	`media_paths` text,
	`media_urls` text,
	`media_type` text,
	`is_active` integer DEFAULT true NOT NULL,
	`days_active` integer DEFAULT 0 NOT NULL,
	`variant_count` integer DEFAULT 1 NOT NULL,
	`placements` text DEFAULT '[]' NOT NULL,
	`first_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ads_library_id_unique` ON `ads` (`library_id`);--> statement-breakpoint
CREATE TABLE `competitor_syntheses` (
	`id` text PRIMARY KEY NOT NULL,
	`competitor_id` text NOT NULL,
	`dominant_angles` text,
	`top_hooks` text,
	`always_on_winners` text,
	`recent_pivots` text,
	`dominant_conversion_goal` text,
	`dominant_brand_voice` text,
	`active_experiments` text,
	`abandoned_patterns` text,
	`ads_analyzed_count` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `competitor_syntheses_competitor_id_unique` ON `competitor_syntheses` (`competitor_id`);--> statement-breakpoint
CREATE TABLE `competitors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`meta_page_id` text,
	`meta_page_url` text,
	`website_url` text,
	`favicon_url` text,
	`country` text DEFAULT 'US',
	`suggestion_reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `performance_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`ad_id` text NOT NULL,
	`score` real NOT NULL,
	`longevity_pts` real NOT NULL,
	`variant_pts` real NOT NULL,
	`placement_pts` real NOT NULL,
	`recency_pts` real NOT NULL,
	`explanation` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ad_id`) REFERENCES `ads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `performance_scores_ad_id_unique` ON `performance_scores` (`ad_id`);--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`priority` text NOT NULL,
	`rationale` text NOT NULL,
	`evidence_ad_ids` text DEFAULT '[]' NOT NULL,
	`stable_hash` text NOT NULL,
	`actioned_at` text,
	`archived_at` text,
	`last_generated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recommendations_stable_hash_unique` ON `recommendations` (`stable_hash`);--> statement-breakpoint
CREATE TABLE `scrape_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`competitor_id` text NOT NULL,
	`status` text NOT NULL,
	`country` text,
	`ads_found` integer DEFAULT 0,
	`ads_new` integer DEFAULT 0,
	`ads_unchanged` integer DEFAULT 0,
	`ads_went_inactive` integer DEFAULT 0,
	`error_message` text,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
