/**
 * agent-server の DB の接続の束は、待機中の接続が切られても落ちない (2026-09-28)
 *
 * ★ agent-server には全体の受け止め口 (uncaughtException) が無い。受け止める処理が無いまま
 *   DB が再起動すると、待機中の接続のエラーでプロセスごと落ちる。
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { pool } from '../../src/context/sessionManager.mts';
import { logger } from '../../src/lib/logger.mts';

describe('agent-server の DB の接続の束の切断', () => {
  afterAll(async () => { await pool.end(); });

  it('★ 切断の知らせを受け止め、例外にせず警告を残す', () => {
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    expect(() => pool.emit('error', new Error('terminating connection due to administrator command'), {})).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('terminating connection'));
  });
});
