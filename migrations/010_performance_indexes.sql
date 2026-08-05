-- Migration 010: Performance indexes for hot list/filter/aggregate paths
-- Compatible with existing data. Safe to re-run (checks information_schema).

-- Inventory DB indexes
USE `db_kelin_inventory`;

-- company + warehouse catalog listing
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND INDEX_NAME = 'idx_inv_company_wh'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE inventory_items ADD INDEX idx_inv_company_wh (company_id, default_warehouse, branch_id, on_hand)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND INDEX_NAME = 'idx_inv_company_branch'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE inventory_items ADD INDEX idx_inv_company_branch (company_id, branch_id, default_warehouse)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND INDEX_NAME = 'idx_inv_status'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE inventory_items ADD INDEX idx_inv_status (item_status)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Purchase DB indexes
USE `db_purchase`;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_periodic_sales' AND INDEX_NAME = 'idx_pps_date_inv'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE product_periodic_sales ADD INDEX idx_pps_date_inv (document_date, inventory_id(64))',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_periodic_sales' AND INDEX_NAME = 'idx_pps_date_branch_inv'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE product_periodic_sales ADD INDEX idx_pps_date_branch_inv (document_date, branch_name(64), inventory_id(64))',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_history' AND INDEX_NAME = 'idx_ph_status_date'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE purchase_history ADD INDEX idx_ph_status_date (status, order_date)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_history' AND INDEX_NAME = 'idx_ph_order_date'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE purchase_history ADD INDEX idx_ph_order_date (order_date)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_order_details' AND INDEX_NAME = 'idx_pod_inventory'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE purchase_order_details ADD INDEX idx_pod_inventory (inventory_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_order_details' AND INDEX_NAME = 'idx_pod_warehouse_inv'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE purchase_order_details ADD INDEX idx_pod_warehouse_inv (warehouse_id, inventory_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_annotations' AND INDEX_NAME = 'idx_ua_module'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE user_annotations ADD INDEX idx_ua_module (module)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
