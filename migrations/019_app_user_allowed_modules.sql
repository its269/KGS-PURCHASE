-- Restrict a user to specific app modules (empty/NULL = all modules).
ALTER TABLE `app_users`
  ADD COLUMN `allowed_modules` VARCHAR(255) NULL AFTER `role`;
