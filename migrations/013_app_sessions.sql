-- Persistent app sessions — survive server restarts; cleared only on explicit logout
CREATE TABLE IF NOT EXISTS `app_sessions` (
  `session_id` VARCHAR(64) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `active_company_id` VARCHAR(32) NOT NULL DEFAULT 'main',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`session_id`),
  KEY `idx_app_sessions_user` (`user_id`),
  KEY `idx_app_sessions_seen` (`last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
