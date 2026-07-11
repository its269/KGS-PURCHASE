-- Migration 008: Pre-computed replenishment rows for fast module loading
USE db_purchase;

CREATE TABLE IF NOT EXISTS `replenishment_cache` (
  `company_id` VARCHAR(50) NOT NULL DEFAULT 'main',
  `branch_id` VARCHAR(100) NOT NULL,
  `inventory_id` VARCHAR(100) NOT NULL,
  `description` VARCHAR(500) NULL,
  `current_stock` DECIMAL(18,4) DEFAULT 0,
  `qty_sold_90` DECIMAL(18,4) DEFAULT 0,
  `sales_velocity` DECIMAL(18,6) DEFAULT 0,
  `days_remaining` INT DEFAULT 0,
  `suggested_qty` DECIMAL(18,4) DEFAULT 0,
  `priority_level` VARCHAR(20) NOT NULL DEFAULT 'Low',
  `lead_time_days` INT DEFAULT 0,
  `vendor_id` VARCHAR(100) NULL,
  `branch_order_qty` DECIMAL(18,4) DEFAULT 0,
  `main_inventory` DECIMAL(18,4) DEFAULT 0,
  `coming_po` DECIMAL(18,4) DEFAULT 0,
  `total_branch_replenishment` DECIMAL(18,4) DEFAULT 0,
  `sales_scope` VARCHAR(50) NULL,
  `restock_source` VARCHAR(255) NULL,
  `what_to_do` TEXT NULL,
  `ai_preview` TEXT NULL,
  `ai_insights_json` JSON NULL,
  `is_main_warehouse_view` TINYINT(1) NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`company_id`, `branch_id`, `inventory_id`),
  KEY `idx_repl_branch_priority` (`company_id`, `branch_id`, `priority_level`),
  KEY `idx_repl_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
