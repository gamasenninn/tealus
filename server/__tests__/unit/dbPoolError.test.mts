/**
 * DB の接続の束は、待機中の接続が切られても落ちない (2026-09-28)
 *
 * ★ DB のコンテナを作り直した瞬間に、待機中の接続が「terminating connection due to administrator command」で
 *   切られ、受け止める処理が無いため「処理されなかった例外」になった (本体は全体の受け止め口が拾って生き残った)。
 * ★ pg の Pool は、待機中の接続のエラーを 'error' で知らせる。受け止める処理が無いと、その場で例外になる。
 */
import { pool } from '../../src/db/pool.mts';
import { logger } from '../../src/utils/logger.mts';

describe('DB の接続の束の切断', () => {
  it('★ 切断の知らせを受け止め、例外にせず警告を残す', () => {
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    expect(() => pool.emit('error', new Error('terminating connection due to administrator command'), {})).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('terminating connection'));
  });
});
