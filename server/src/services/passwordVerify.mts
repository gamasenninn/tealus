/**
 * #362 パスワード照合 — ★ 存在しないユーザーでも同じだけ計算する。
 *
 * `POST /api/auth/login` は、ユーザーが見つからないと bcrypt を踏まずに 401 を返していた。
 * 実測 (#362、サーバログ):
 *
 *   存在しない ID → 401 / 1〜2ms    (bcrypt を踏まない)
 *   存在する ID   → 401 / 約 51ms   (bcrypt が走る)
 *
 * ★ 25 倍以上の差があり、外から「その ID は存在するか」を数えられる。
 *   総当たりの前段として ID を絞り込めてしまうので、差を消す。
 *
 * 方法は、ユーザーが無いときも**実在しないダミーの hash**と照合すること。
 * ★ 結果は compare の戻り値に関係なく必ず false にする (ダミーが「たまたま通る」余地を残さない)。
 */
import bcrypt from 'bcrypt';
import { SALT_ROUNDS } from '../constants/config.mts';

/**
 * ダミーの hash。★ コストは本番の SALT_ROUNDS と揃える (違うと計算量が変わり、時間差が戻る)。
 * 元の平文は生成時に捨てた乱数 32 バイトで、どこにも残していない。
 * (`SALT_ROUNDS` を変えたら、ここも同じコストで作り直すこと。テストが差を検出する)
 */
export const DUMMY_HASH = '$2b$10$JwKixv2fEsLUgQZJhqwBAe5zdXA9G4WXOIQgtbTYhEQ7P6X.i5Rci';

/** bcrypt の差し替え口 (テスト用)。既定は本物 */
export interface PasswordVerifyDeps {
  compare?: (password: string, hash: string) => Promise<boolean>;
}

/**
 * パスワードを照合する。
 *
 * @param password 入力されたパスワード
 * @param hash     保存されている hash。★ ユーザーが居ない / hash が無い場合は null や空文字を渡す
 * @returns 一致すれば true。hash が無い場合は**必ず false** (ただし計算時間は同じ)
 */
export async function verifyPassword(
  password: string,
  hash: string | null | undefined,
  deps: PasswordVerifyDeps = {},
): Promise<boolean> {
  const compare = deps.compare ?? bcrypt.compare;
  if (!hash) {
    await compare(password, DUMMY_HASH); // 時間だけ揃える
    return false;
  }
  return compare(password, hash);
}

/** SALT_ROUNDS と DUMMY_HASH のコストが揃っているか (起動時の自己点検用) */
export function dummyHashCost(): number {
  return Number(DUMMY_HASH.split('$')[2]);
}

/** 揃っていなければ true (= 直す必要がある) */
export function isDummyHashCostStale(): boolean {
  return dummyHashCost() !== SALT_ROUNDS;
}
