-- Planning fields synced from Acumatica StockItem catalog
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS vendor_id VARCHAR(100) NULL AFTER posting_class,
  ADD COLUMN IF NOT EXISTS lead_time_days INT NULL AFTER vendor_id,
  ADD COLUMN IF NOT EXISTS safety_stock DECIMAL(18,4) NULL AFTER lead_time_days,
  ADD COLUMN IF NOT EXISTS moq DECIMAL(18,4) NULL AFTER safety_stock;
