-- Migration 022: Add 'guest' to users.role CHECK constraint (#282 Phase A)
--
-- 既存 CHECK constraint (role IN ('admin', 'user')) を拡張、guest role を追加。
-- - 既存 user data は影響なし (= role 値はそのまま保持)
-- - 新規 guest role insert / 既存 user の guest UPDATE が可能に
-- - 不正 role (例: 'superadmin') は依然 reject
-- - default 値 'user' は保持 (breaking change なし)
--
-- 関連: tealus#282 (ゲストユーザ role 拡張、#124 pivot)、Tealus 根幹原則の正典化
-- (= AI と人間の区別は最小限、interaction primitive は同じ)

DO $$ BEGIN
  -- 既存 inline-defined CHECK constraint を drop (= 002_user_role.sql で作成)
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  -- 新規 CHECK constraint で guest を追加
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'guest'));
END $$;
