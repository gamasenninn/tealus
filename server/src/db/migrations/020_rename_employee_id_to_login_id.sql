-- #167 users.employee_id → users.login_id にリネーム
-- 背景: OSS 公開を前に「社員番号」という日本企業限定の命名を汎用化する。
-- 詳細: docs/02_DB設計.md と Issue #167 を参照。

ALTER TABLE users RENAME COLUMN employee_id TO login_id;
