-- #167 users.employee_id → users.login_id にリネーム
-- 背景: OSS 公開を前に「社員番号」という日本企業限定の命名を汎用化する。
-- 詳細: docs/02_DB設計.md と Issue #167 を参照。
--
-- 冪等化: 本 migration は docker-entrypoint-initdb.d と npm run migrate の
-- 両方から実行される可能性があるため、column の存在チェックを行う。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'employee_id'
  ) THEN
    ALTER TABLE users RENAME COLUMN employee_id TO login_id;
  END IF;
END $$;
