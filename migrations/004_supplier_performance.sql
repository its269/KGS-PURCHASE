-- Migration 004: Add supplier performance and purchase history
USE db_purchase;

CREATE TABLE IF NOT EXISTS `purchase_history` (
  `order_nbr` VARCHAR(50) PRIMARY KEY,
  `vendor_id` VARCHAR(50),
  `status` VARCHAR(50),
  `order_date` DATE,
  `promised_date` DATE,
  `receipt_date` DATE,
  `total_amount` DECIMAL(18, 4),
  `last_sync` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_vendor_history` (`vendor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `supplier_performance` (
  `vendor_id` VARCHAR(50) PRIMARY KEY,
  `reliability_score` DECIMAL(5, 2),
  `total_orders` INT,
  `late_orders` INT,
  `last_updated` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
