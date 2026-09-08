/**
 * passwordVerify ユニットテスト (#362)
 *
 * ★ 存在しない login_id は bcrypt を踏まずに即 401 を返していたため、応答時間で
 *   「その ID は存在するか」が外から判別できた (実測: 1〜2ms vs 約 51ms = 25 倍以上)。
 *   ユーザーが見つからないときも同じだけ計算させて、差を消す。
 */
import * as mod from '../../src/services/passwordVerify.mts';
import { SALT_ROUNDS } from '../../src/constants/config.mts';

/** bcrypt.compare の呼ばれ方を見るための差し替え */
function spyBcrypt(result: boolean) {
  const calls: Array<{ password: string; hash: string }> = [];
  return {
    calls,
    compare: async (password: string, hash: string): Promise<boolean> => {
      calls.push({ password, hash });
      return result;
    },
  };
}

describe('存在するユーザー', () => {
  test('hash と照合して、一致すれば true', async () => {
    const b = spyBcrypt(true);
    await expect(mod.verifyPassword('pw', '$2b$10$realhash', { compare: b.compare })).resolves.toBe(true);
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0].hash).toBe('$2b$10$realhash');
  });

  test('一致しなければ false', async () => {
    const b = spyBcrypt(false);
    await expect(mod.verifyPassword('pw', '$2b$10$realhash', { compare: b.compare })).resolves.toBe(false);
  });
});

describe('★ 存在しないユーザー (応答時間差を作らない)', () => {
  test('hash が null でも bcrypt を 1 回踏む', async () => {
    const b = spyBcrypt(false);
    await mod.verifyPassword('pw', null, { compare: b.compare });
    expect(b.calls).toHaveLength(1);
  });

  test('hash が空文字でも bcrypt を 1 回踏む', async () => {
    const b = spyBcrypt(false);
    await mod.verifyPassword('pw', '', { compare: b.compare });
    expect(b.calls).toHaveLength(1);
  });

  test('★ 踏むのは実在しない hash なので、結果は必ず false', async () => {
    // ★ bcrypt が true を返す差し替えでも false にする = ダミー照合が
    //   「たまたま通る」ことがあってはいけない
    const b = spyBcrypt(true);
    await expect(mod.verifyPassword('pw', null, { compare: b.compare })).resolves.toBe(false);
  });

  test('ダミーの hash は bcrypt の形をしている (compare が即エラーで返らない)', async () => {
    expect(mod.DUMMY_HASH).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  test('★ ダミーの hash のコストは、本番の SALT_ROUNDS と同じ', () => {
    // 違うと計算量が変わり、消したはずの時間差が戻る
    expect(mod.dummyHashCost()).toBe(SALT_ROUNDS);
    expect(mod.isDummyHashCostStale()).toBe(false);
  });
});
