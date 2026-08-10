-- Per-user branch access (non-admin accounts)
CREATE TABLE IF NOT EXISTS `app_user_branches` (
  `user_id` INT UNSIGNED NOT NULL,
  `branch_id` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`user_id`, `branch_id`),
  KEY `idx_aub_branch` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
