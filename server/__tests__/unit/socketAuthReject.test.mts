/**
 * 改善ループ 47 (2026-11-12) socket の認証で断った理由をログに残す。
 * ★ 鍵 (JWT 7 日) の期限切れが本体に見えるのは「次に REST を呼んだときの 401」だけで、
 *   socket の再接続で断った分は記録されていなかった (週 1 回の入り直しの数が過少になる)
 */
import jwt from 'jsonwebtoken';
import { socketAuthRejectLine } from '../../src/socket/authReject.mts';

const SECRET = 'test-secret-47';

describe('socketAuthRejectLine', () => {
  test('★ 期限切れは「期限切れ」と、鍵に書かれた利用者 (未検証) の先頭 8 文字・期限の時刻を出す', () => {
    const token = jwt.sign({ id: 'b29326a0-aaaa-bbbb-cccc-000000000000' }, SECRET, { expiresIn: -10 });
    let err: unknown;
    try { jwt.verify(token, SECRET); } catch (e) { err = e; }
    const line = socketAuthRejectLine(err, token, 'iPhone');
    expect(line).toContain('期限切れ');
    expect(line).toContain('b29326a0');
    expect(line).toContain('未検証');
    expect(line).toContain('iPhone');
    expect(line).not.toContain(token);   // ★ 鍵そのものは出さない
  });

  test('署名が違う鍵は「無効」と出し、期限切れとは分ける', () => {
    const token = jwt.sign({ id: 'deadbeef-0000' }, 'other-secret', { expiresIn: '1h' });
    let err: unknown;
    try { jwt.verify(token, SECRET); } catch (e) { err = e; }
    const line = socketAuthRejectLine(err, token, 'Win Chrome');
    expect(line).toContain('無効');
    expect(line).not.toContain('期限切れ');
    expect(line).not.toContain(token);
  });

  test('鍵が読めない (形が壊れている) ときも落ちずに 1 行を返す', () => {
    const line = socketAuthRejectLine(new Error('jwt malformed'), 'not-a-jwt', '');
    expect(line).toContain('無効');
    expect(line).toContain('?');
  });
});
