-- Forecast Generator stock snapshot in db_purchase (synced from Acumatica inventory)
CREATE TABLE IF NOT EXISTS `forecast_item_stock` (
  `company_id` VARCHAR(64) NOT NULL DEFAULT 'main',
  `inventory_id` VARCHAR(100) NOT NULL,
  `warehouse_id` VARCHAR(100) NOT NULL,
  `branch_id` VARCHAR(100) NULL,
  `site_id` VARCHAR(100) NULL,
  `item_name` VARCHAR(255) NULL,
  `item_class` VARCHAR(100) NULL,
  `default_price` DECIMAL(18,4) DEFAULT 0,
  `on_hand` DECIMAL(18,4) DEFAULT 0,
  `available` DECIMAL(18,4) DEFAULT 0,
  `item_status` VARCHAR(50) NULL,
  `last_sync` DATETIME NULL,
  PRIMARY KEY (`company_id`, `inventory_id`, `warehouse_id`),
  KEY `idx_fis_branch` (`company_id`, `branch_id`),
  KEY `idx_fis_site` (`company_id`, `site_id`),
  KEY `idx_fis_class` (`item_class`),
  KEY `idx_fis_name` (`inventory_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
