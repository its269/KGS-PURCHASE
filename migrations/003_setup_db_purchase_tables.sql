-- Migration 003: Setup all required tables in db_purchase
-- Destination: db_purchase

USE db_purchase;

-- 1. inventory_items
CREATE TABLE IF NOT EXISTS `inventory_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `inventory_id` VARCHAR(100) NOT NULL,
  `default_warehouse` VARCHAR(100) NOT NULL,
  `inventory_name` VARCHAR(255),
  `item_class` VARCHAR(100),
  `default_price` DECIMAL(18, 4) DEFAULT 0,
  `item_status` VARCHAR(50) DEFAULT 'active',
  `base_unit` VARCHAR(50),
  `type` VARCHAR(50),
  `posting_class` VARCHAR(100),
  `branch_id` VARCHAR(100),
  `site_id` VARCHAR(100),
  `on_hand` DECIMAL(18, 4) DEFAULT 0,
  `available` DECIMAL(18, 4) DEFAULT 0,
  `last_sync` DATETIME,
  UNIQUE KEY `uq_inv_warehouse` (`inventory_id`, `default_warehouse`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. product_periodic_sales
CREATE TABLE IF NOT EXISTS `product_periodic_sales` (
  `id` VARCHAR(255) NOT NULL,
  `branch_name` VARCHAR(255),
  `order_type` VARCHAR(50),
  `financial_period` VARCHAR(50),
  `document_date` DATE,
  `description` TEXT,
  `qty` DECIMAL(18, 4),
  `total_amount` DECIMAL(18, 4),
  `item_class` VARCHAR(100),
  `inventory_id` VARCHAR(100),
  `posting_class` VARCHAR(100),
  `last_sync` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_branch_name` (`branch_name`(64)),
  INDEX `idx_inventory_id` (`inventory_id`(64)),
  INDEX `idx_document_date` (`document_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. branches
CREATE TABLE IF NOT EXISTS `branches` (
  `branch_id` VARCHAR(100) PRIMARY KEY,
  `branch_name` VARCHAR(255),
  `active` TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
