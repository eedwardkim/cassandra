ALTER TABLE `trades` ADD `authorize_tx` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `onchain_trade_id` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `trades_network_onchain_trade_id` ON `trades` (`network`,`onchain_trade_id`);
