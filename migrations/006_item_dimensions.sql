-- Item packaging dimensions (app-managed, not synced to Acumatica)
USE db_kelin_inventory;

CREATE TABLE IF NOT EXISTS `item_dimensions` (
  `inventory_id` VARCHAR(100) NOT NULL,
  `pcs_per_box` DECIMAL(18,4) NULL,
  `length_m` DECIMAL(18,6) NULL,
  `height_m` DECIMAL(18,6) NULL,
  `width_m` DECIMAL(18,6) NULL,
  `weight_kg` DECIMAL(18,4) NULL,
  `cbm` DECIMAL(18,8) NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`inventory_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
