-- Migration 011: PO destination branch index table for fast branch filters
-- Avoids correlated EXISTS + UPPER(TRIM()) on purchase_order_details.

USE `db_purchase`;

CREATE TABLE IF NOT EXISTS `purchase_order_dest` (
  `order_nbr` VARCHAR(64) NOT NULL,
  `branch_id` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`order_nbr`, `branch_id`),
  KEY `idx_podest_branch` (`branch_id`, `order_nbr`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill from existing PO line warehouse/branch columns (normalized uppercase)
INSERT IGNORE INTO purchase_order_dest (order_nbr, branch_id)
SELECT DISTINCT
  d.order_nbr,
  UPPER(TRIM(COALESCE(NULLIF(d.warehouse_id, ''), d.branch_id)))
FROM purchase_order_details d
WHERE COALESCE(NULLIF(TRIM(d.warehouse_id), ''), NULLIF(TRIM(d.branch_id), '')) IS NOT NULL
  AND TRIM(COALESCE(NULLIF(d.warehouse_id, ''), d.branch_id)) != '';
