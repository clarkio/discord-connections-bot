CREATE TABLE `players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`discord_id` text NOT NULL,
	`discord_name` text NOT NULL,
	`is_opted_in` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_discord_id_unique` ON `players` (`discord_id`);--> statement-breakpoint
CREATE TABLE `results` (
	`discord_id` text NOT NULL,
	`puzzle_number` integer NOT NULL,
	`guess_rows` text NOT NULL,
	`solved_order` text NOT NULL,
	`mistakes` integer NOT NULL,
	`rainbows` integer NOT NULL,
	`failed` integer NOT NULL,
	`posted_at` text NOT NULL,
	PRIMARY KEY(`discord_id`, `puzzle_number`),
	FOREIGN KEY (`discord_id`) REFERENCES `players`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scores` (
	`discord_id` text NOT NULL,
	`puzzle_number` integer NOT NULL,
	`daily_score` real NOT NULL,
	`is_win` integer DEFAULT 0 NOT NULL,
	`is_tie` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`discord_id`, `puzzle_number`),
	FOREIGN KEY (`discord_id`,`puzzle_number`) REFERENCES `results`(`discord_id`,`puzzle_number`) ON UPDATE no action ON DELETE no action
);
