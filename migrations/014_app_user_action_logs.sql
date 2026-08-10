-- Migration 014: per-user action / input activity log (admin review)
-- Destination: MYSQL_PURCHASE_DATABASE (default db_purchase)

CREATE TABLE IF NOT EXISTS `app_user_action_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `module` VARCHAR(50) NULL,
  `ref_id` VARCHAR(100) NULL,
  `field_key` VARCHAR(50) NULL,
  `detail` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ual_user_created` (`user_id`, `created_at`),
  KEY `idx_ual_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
