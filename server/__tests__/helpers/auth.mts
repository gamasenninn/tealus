/**
 * Test auth helper
 * Creates test users and returns their tokens.
 */
import bcrypt from 'bcrypt';
import '../../src/app.mts';
import { getTestPool } from './db.mts';
import { generateToken } from '../../src/middleware/auth.mts';
import { SALT_ROUNDS } from '../../src/constants/config.mts';

interface CreateTestUserOverrides {
  login_id?: string;
  display_name?: string;
  password?: string;
}

interface TestUser {
  token: string;
  user: {
    id: string;
    login_id: string;
    display_name: string;
    role: string;
    [key: string]: unknown;
  };
}

/**
 * テスト用の利用者を作り、{ token, user } を返す。
 *
 * ★ 2026-09-28: 以前は POST /api/auth/register を呼んでいたが、自己登録は「人の利用者が 0 人」の
 *   ときだけ開く形に閉じたので、テスト DB に直接作る (パスワードは本物と同じ bcrypt、鍵は本物と同じ generateToken)。
 *   role は 'user' (個別テストで admin が必要なら DB UPDATE する)。
 * ★ app を読み込むのは、本体の設定 (src/env.mts など) をテストと同じ順で確定させるため。
 */
export async function createTestUser(overrides: CreateTestUserOverrides = {}): Promise<TestUser> {
  const data = {
    login_id: overrides.login_id || 'EMP' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    display_name: overrides.display_name || 'テストユーザー',
    password: overrides.password || 'password123',
  };
  const password_hash = await bcrypt.hash(data.password, SALT_ROUNDS);
  const { rows: [user] } = await getTestPool().query<TestUser['user']>(
    `INSERT INTO users (login_id, display_name, password_hash, role)
     VALUES ($1, $2, $3, 'user')
     RETURNING id, login_id, display_name, avatar_url, status_message, role, is_active, created_at`,
    [data.login_id, data.display_name, password_hash]
  );
  return { token: generateToken(user), user };
}
