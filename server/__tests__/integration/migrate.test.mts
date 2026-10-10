import fs from 'node:fs';
import path from 'node:path';
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

  test('★ #557 止まったときの案内に「Docker の初回起動で作った DB」の場合がある', async () => {
    await migrate(CFG, silent);
    const p = new pg.Pool(CFG);
    await p.query('DROP TABLE schema_migrations');
    await p.end();
    await expect(migrate(CFG, silent)).rejects.toThrow(/Docker の初回起動/);
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

  /**
   * ★★★ #500 v0.9.0 から上げる形: 026 まで流してあり、台帳が無い。
   *   上限なしの baseline だと 027 以降が流れないまま「適用済み」になる。
   */
  async function makeV090Db(): Promise<string[]> {
    const dir = path.join(import.meta.dirname, '../../src/db/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const p = new pg.Pool(CFG);
    for (const f of files.filter((f) => f <= '026_message_form_type.sql')) {
      await p.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
    await p.end();
    return files.filter((f) => f > '026_message_form_type.sql');
  }

  test('★★★ v0.9.0 の DB で止まったとき、上限つきの baseline を案内する', async () => {
    await makeV090Db();
    await expect(migrate(CFG, silent)).rejects.toThrow(/--baseline-through/);
  });

  test('★★★★ 上限つき baseline のあと、通常実行で 027 以降が流れる', async () => {
    const rest = await makeV090Db();
    expect(rest.length).toBeGreaterThan(0);
    await migrate(CFG, { baselineThrough: '026_message_form_type.sql', log: () => {} });
    const lines: string[] = [];
    await migrate(CFG, { log: (m) => lines.push(m) });
    for (const f of rest) expect(lines).toContain(`Running migration: ${f}`);
    // ★ 実際に表ができている (033)
    expect((await q<{ n: string }>("SELECT count(*) n FROM information_schema.tables WHERE table_name='line_message_links'"))[0].n).toBe('1');
  });

  test('★ 上限に存在しない名前を渡したら、何も記録せずに止まる', async () => {
    await makeV090Db();
    await expect(migrate(CFG, { baselineThrough: '026_typo.sql', log: () => {} })).rejects.toThrow(/026_typo/);
    expect((await q<{ n: string }>("SELECT count(*) n FROM information_schema.tables WHERE table_name='schema_migrations'"))[0].n).toBe('0');
  });
});
