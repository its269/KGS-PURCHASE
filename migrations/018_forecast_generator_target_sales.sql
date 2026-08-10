-- Target Sales is a manual planning input (defaults to Estimate + Buffer).
ALTER TABLE `forecast_generator_inputs`
  ADD COLUMN `target_sales` DECIMAL(18,4) NULL AFTER `buffer_inventory`;
