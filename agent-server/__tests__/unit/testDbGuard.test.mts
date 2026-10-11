/**
 * ★ #572 テストは本番 DB につながない。
 *
 * agent-server の config.mts は起動時に .env (本番の DB 設定) を読む。sessionManager の pool は
 * 読み込んだ瞬間にその設定で作られるので、DB を差し替え忘れたテストは本番 DB に問い合わせていた
 * (2026-10-10 17:15、room_members に 'u1' を投げた跡が本番の Postgres のログに 26 行)。
 * jest.setup.js でテスト用の DB を先に決めて、ここで見張る。
 */
import { pool } from '../../src/context/sessionManager.mts';

test('★ sessionManager の pool はテスト用の DB を指す (本番の 5432/tealus ではない)', () => {
  const cs = (pool as unknown as { options: { connectionString?: string } }).options.connectionString ?? '';
  expect(cs).toContain('tealus_test');
  expect(cs).not.toMatch(/:5432\/tealus$/);
});
