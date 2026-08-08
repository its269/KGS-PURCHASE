-- Migration 011: product_inventory_items — Acumatica sync destination
-- inventory_items remains the view/read-only source for the UI.
-- Destination: MYSQL_INVENTORY_DATABASE (default db_kelin_inventory)

CREATE TABLE IF NOT EXISTS `product_inventory_items` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `inventory_id` VARCHAR(100) NOT NULL,
  `default_warehouse` VARCHAR(100) NOT NULL DEFAULT '__catalog__',
  `inventory_name` VARCHAR(255) NULL,
  `item_class` VARCHAR(100) NULL,
  `default_price` DECIMAL(18,4) DEFAULT 0,
  `item_status` VARCHAR(50) DEFAULT 'active',
  `base_unit` VARCHAR(50) NULL DEFAULT '',
  `type` VARCHAR(50) NULL,
  `posting_class` VARCHAR(100) NULL DEFAULT '',
  `branch_id` VARCHAR(100) NULL,
  `site_id` VARCHAR(100) NULL,
  `on_hand` DECIMAL(18,4) DEFAULT 0,
  `available` DECIMAL(18,4) DEFAULT 0,
  `last_sync` DATETIME NULL,
  `company_id` VARCHAR(50) NOT NULL DEFAULT 'main',
  `vendor_id` VARCHAR(100) NULL,
  `lead_time_days` INT NULL,
  `safety_stock` DECIMAL(18,4) NULL,
  `moq` DECIMAL(18,4) NULL,
  PRIMARY KEY (`inventory_id`, `default_warehouse`, `company_id`),
  UNIQUE KEY `uq_inv_warehouse` (`inventory_id`, `default_warehouse`, `company_id`),
  KEY `idx_inventory_row_id` (`id`),
  KEY `idx_inv_company_wh` (`company_id`, `default_warehouse`, `branch_id`, `on_hand`),
  KEY `idx_inv_company_branch` (`company_id`, `branch_id`, `default_warehouse`),
  KEY `idx_inv_status` (`item_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
