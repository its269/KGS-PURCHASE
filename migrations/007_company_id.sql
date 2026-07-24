-- Migration 007: Separate ecommerce as its own company (not a branch)
-- Adds company_id to inventory_items and updates unique key.

USE db_kelin_inventory;

-- 1. Add company_id column
ALTER TABLE inventory_items
    ADD COLUMN IF NOT EXISTS company_id VARCHAR(50) NOT NULL DEFAULT 'main' AFTER inventory_id;

-- 2. Backfill existing rows
UPDATE inventory_items SET company_id = 'main' WHERE company_id IS NULL OR TRIM(company_id) = '';

-- 3. Remove ecommerce misclassified as a branch under main company
DELETE FROM inventory_items
WHERE company_id = 'main'
  AND default_warehouse != '__catalog__'
  AND UPPER(TRIM(branch_id)) IN ('ECOM', 'ECOMMERCE', 'E-COMMERCE', 'E COMMERCE');

-- 4. Rebuild primary key to include company_id (MySQL 8+)
-- Drop old PK if it exists, then add composite PK
SET @pk_exists = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'inventory_items'
      AND CONSTRAINT_TYPE = 'PRIMARY KEY'
);

-- Note: run-migration.js handles PK migration safely for environments without IF NOT EXISTS on ADD COLUMN
