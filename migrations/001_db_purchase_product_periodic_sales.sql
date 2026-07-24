-- Migration 001: Create db_purchase database and product_periodic_sales table
-- Run this against your MySQL server before using the periodic-sales export feature.
-- Source: Supabase product_periodic_sales table

CREATE DATABASE IF NOT EXISTS `db_purchase`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `db_purchase`;

CREATE TABLE IF NOT EXISTS `product_periodic_sales` (
  `id`               VARCHAR(36)    NOT NULL,
  `branch_name`      TEXT           NULL,
  `order_type`       TEXT           NULL,
  `financial_period` TEXT           NULL,
  `document_date`    DATE           NULL,
  `description`      TEXT           NULL,
  `qty`              DECIMAL(18, 4) NULL,
  `total_amount`     DECIMAL(18, 4) NULL,
  `item_class`       TEXT           NULL,
  `inventory_id`     TEXT           NULL,
  `posting_class`    TEXT           NULL,
  `last_sync`        DATETIME       NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_branch_name`  (`branch_name`(64)),
  INDEX `idx_inventory_id` (`inventory_id`(64)),
  INDEX `idx_document_date` (`document_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
