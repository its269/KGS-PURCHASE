-- Per-SKU Forecast Generator planning inputs (estimate + buffer)
CREATE TABLE IF NOT EXISTS `forecast_generator_inputs` (
  `company_id` VARCHAR(64) NOT NULL DEFAULT 'main',
  `branch_id` VARCHAR(100) NOT NULL,
  `inventory_id` VARCHAR(100) NOT NULL,
  `estimate_sales` DECIMAL(18,4) NULL,
  `buffer_inventory` DECIMAL(18,4) NULL,
  `updated_by` INT UNSIGNED NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`company_id`, `branch_id`, `inventory_id`),
  KEY `idx_fgi_branch` (`branch_id`),
  KEY `idx_fgi_item` (`inventory_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
