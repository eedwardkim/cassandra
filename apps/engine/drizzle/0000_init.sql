CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`symbol` text,
	`ts` integer NOT NULL,
	`status` text NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `bias_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`ts` integer NOT NULL,
	`irrationality` real NOT NULL,
	`edge_bps` integer NOT NULL,
	`json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bias_symbol_ts` ON `bias_reports` (`symbol`,`ts`);--> statement-breakpoint
CREATE TABLE `chain_txs` (
	`hash` text NOT NULL,
	`network` text NOT NULL,
	`kind` text NOT NULL,
	`ref` text,
	`state` text NOT NULL,
	`block` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`hash`, `network`)
);
--> statement-breakpoint
CREATE TABLE `commits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`forecast_id` text NOT NULL,
	`symbol` text NOT NULL,
	`market_key` text NOT NULL,
	`network` text NOT NULL,
	`chain_id` integer NOT NULL,
	`onchain_id` integer,
	`probability_bps` integer NOT NULL,
	`reasoning_hash` text NOT NULL,
	`salt` text NOT NULL,
	`commitment` text NOT NULL,
	`state` text NOT NULL,
	`commit_tx` text,
	`commit_block` integer,
	`reveal_tx` text,
	`outcome_yes` integer,
	`brier_bps2` integer,
	`score_tx` text,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`symbol` text PRIMARY KEY NOT NULL,
	`event_ticker` text NOT NULL,
	`label` text NOT NULL,
	`category` text NOT NULL,
	`expiry_date` text,
	`status` text NOT NULL,
	`tracked` integer DEFAULT false NOT NULL,
	`resolution_side` text,
	`resolved_at` text,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`ticker` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text NOT NULL,
	`raw_category` text,
	`status` text NOT NULL,
	`volume` real DEFAULT 0 NOT NULL,
	`expiry_date` text,
	`exclusive` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `forecasts` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`ts` integer NOT NULL,
	`cache_key` text NOT NULL,
	`p_bps` integer NOT NULL,
	`lo_bps` integer NOT NULL,
	`hi_bps` integer NOT NULL,
	`mid_bps` integer NOT NULL,
	`reasoning_hash` text NOT NULL,
	`model` text NOT NULL,
	`source` text NOT NULL,
	`json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `forecasts_symbol_ts` ON `forecasts` (`symbol`,`ts`);--> statement-breakpoint
CREATE INDEX `forecasts_cache` ON `forecasts` (`cache_key`);--> statement-breakpoint
CREATE TABLE `index_history` (
	`ts` integer PRIMARY KEY NOT NULL,
	`value` real NOT NULL,
	`contracts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ticks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`ts` integer NOT NULL,
	`bid_bps` integer,
	`ask_bps` integer,
	`no_ask_bps` integer,
	`mid_bps` integer NOT NULL,
	`last_bps` integer,
	`volume` real,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ticks_symbol_ts` ON `ticks` (`symbol`,`ts`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`forecast_id` text,
	`outcome` text NOT NULL,
	`side` text NOT NULL,
	`price_bps` integer NOT NULL,
	`quantity` integer NOT NULL,
	`notional_cents` integer NOT NULL,
	`edge_bps` integer NOT NULL,
	`category` integer NOT NULL,
	`state` text NOT NULL,
	`reason` text,
	`client_order_id` text NOT NULL,
	`order_id` text,
	`order_status` text,
	`filled_quantity` text,
	`record_tx` text,
	`record_block` integer,
	`network` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
