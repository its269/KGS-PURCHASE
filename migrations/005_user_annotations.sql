-- Migration 005: Setup user_annotations table for persistent manual inputs
USE db_purchase;

CREATE TABLE IF NOT EXISTS `user_annotations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `module` VARCHAR(50) NOT NULL, -- 'po', 'supplier', etc.
  `ref_id` VARCHAR(100) NOT NULL, -- Order # or Vendor ID
  `field_key` VARCHAR(50) NOT NULL, -- 'eta', 'userStatus', 'leadTime'
  `field_value` TEXT,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_annotation` (`module`, `ref_id`, `field_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
