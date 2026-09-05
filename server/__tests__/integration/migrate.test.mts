import pg from 'pg';
import { migrate } from '../../src/db/migrate.mts';

/**
 * #406 台帳の実挙動。★ **再生の経路をテストで通す** —— ここが通っていなかったから、
 * 「空の DB では動くが本番では落ちる」を長く見逃していた。
 */
const CFG: pg.PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'tealus_test',
  user: process.env.DB_USER || 'tealus_test',
  password: process.env.DB_PASSWORD || 'tealus_test',
};

async function wipe(): Promise<void> {
  const p = new pg.Pool(CFG);
  await p.query(`DO $$ DECLARE r RECORD; BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public') LOOP
      EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP; END $$;`);
  await p.end();
}
async function q<T extends pg.QueryResultRow>(sql: string): Promise<T[]> {
  const p = new pg.Pool(CFG);
  const { rows } = await p.query<T>(sql);
  await p.end();
  return rows;
}
const silent = { log: () => {} };

jest.setTimeout(60000);

describe('migrate — 台帳 (#406)', () => {
  beforeEach(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  test('★ 空の DB では全部流れ、台帳に記録される', async () => {
    await migrate(CFG, silent);
    const led = await q<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename');
    expect(led.length).toBeGreaterThan(20);
    expect(led[0].filename).toMatch(/^001_/);
    // 実際にテーブルができている
    expect((await q<{ n: string }>("SELECT count(*) n FROM information_schema.tables WHERE table_name='rooms'"))[0].n).toBe('1');
  });

  test('★★★ 2 回流しても落ちない (これが #406 の本体)', async () => {
    await migrate(CFG, silent);
    await expect(migrate(CFG, silent)).resolves.toBeUndefined();
  });

  test('★★ 2 回目は 1 件も実行しない (再生しない)', async () => {
    await migrate(CFG, silent);
    const lines: string[] = [];
    await migrate(CFG, { log: (m) => lines.push(m) });
    expect(lines.some((l) => l.includes('Running migration'))).toBe(false);
    expect(lines.some((l) => l.includes('適用済み'))).toBe(true);
  });

  test('★★★★ form 型のデータが在っても 2 回目が通る (実際に踏んだ形)', async () => {
    await migrate(CFG, silent);
    const p = new pg.Pool(CFG);
    await p.query(`INSERT INTO users (login_id, display_name, password_hash) VALUES ('t1','T','x')`);
    await p.query(`INSERT INTO rooms (type, name) VALUES ('group','R')`);
    await p.query(`INSERT INTO messages (room_id, sender_id, content, type)
      SELECT r.id, u.id, 'form です', 'form' FROM rooms r, users u LIMIT 1`);
    await p.end();
    // ★ 台帳が無かった頃は、ここで 008 が form を知らない制約を張り直して落ちていた
    await expect(migrate(CFG, silent)).resolves.toBeUndefined();
    expect((await q<{ n: string }>("SELECT count(*) n FROM messages WHERE type='form'"))[0].n).toBe('1');
  });

  test('★★ 台帳が無いのにテーブルが在る DB は、止めて baseline を案内する', async () => {
    await migrate(CFG, silent);
    const p = new pg.Pool(CFG);
    await p.query('DROP TABLE schema_migrations');   // 台帳だけ消す = 既存 DB の形
    await p.end();
    await expect(migrate(CFG, silent)).rejects.toThrow(/baseline/);
  });

  test('★ --baseline は記録するだけで、実行しない', async () => {
    await migrate(CFG, silent);
    const p = new pg.Pool(CFG);
    await p.query('DROP TABLE schema_migrations');
    await p.end();
    const lines: string[] = [];
    await migrate(CFG, { baseline: true, log: (m) => lines.push(m) });
    expect(lines.some((l) => l.includes('Running migration'))).toBe(false);
    const led = await q<{ n: string }>('SELECT count(*) n FROM schema_migrations');
    expect(Number(led[0].n)).toBeGreaterThan(20);
    // baseline 後は通常実行が通る
    await expect(migrate(CFG, silent)).resolves.toBeUndefined();
  });
});
