/**
 * #334 未適用 migration の起動時 warn (採用者保護、checkBuildArtifacts と同型)。
 * DB 非依存: query / warn を注入して pool に触れない。
 */
import { checkMigrations } from '../../src/services/migrationCheck.mts';

// テーブル不在時に pg が投げる undefined_table (42P01) を模した error
function undefinedTableError(): Error & { code: string } {
  const e = new Error('relation "dictionary_terms" does not exist') as Error & { code: string };
  e.code = '42P01';
  return e;
}

describe('checkMigrations', () => {
  test('テーブルが引ける → warn なし、ok=true', async () => {
    const warns: string[] = [];
    const ok = await checkMigrations({
      query: async () => ({ rows: [{ ok: 1 }] }),
      warn: (m) => warns.push(m),
    });
    expect(ok).toBe(true);
    expect(warns).toHaveLength(0);
  });

  test('テーブル不在 (42P01) → warn を出して ok=false', async () => {
    const warns: string[] = [];
    const ok = await checkMigrations({
      query: async () => { throw undefinedTableError(); },
      warn: (m) => warns.push(m),
    });
    expect(ok).toBe(false);
    // 採用者が次に打つコマンドが warn に含まれる
    expect(warns.join('\n')).toContain('npm run migrate');
    expect(warns.join('\n')).toContain('dictionary_terms');
    // 稼働は継続する旨 (壊れないと明示) が含まれる
    expect(warns.join('\n')).toMatch(/継続|フォールバック/);
  });

  test('DB 不達 (接続エラー等、42P01 以外) → warn は出すが ok=false (誤検出でなく DB 不明として)', async () => {
    const warns: string[] = [];
    const ok = await checkMigrations({
      query: async () => { throw new Error('ECONNREFUSED'); },
      warn: (m) => warns.push(m),
    });
    expect(ok).toBe(false);
    expect(warns.length).toBeGreaterThan(0);
  });

  test('query に SELECT が渡る (テーブル存在確認である)', async () => {
    let sql = '';
    await checkMigrations({
      query: async (s: string) => { sql = s; return { rows: [] }; },
      warn: () => {},
    });
    expect(sql.toLowerCase()).toContain('dictionary_terms');
  });
});

/**
 * v0.11.0 の監査 (2026-10-15): 起動時の確認は辞書の表 (023) しか見ていなかったので、034〜040 を流し忘れても
 * 起動ログは静かだった (034 を忘れるとログインもできないのに)。
 * ★ 台帳 (schema_migrations) とファイルを突き合わせ、未適用があれば名前つきで warn する
 */
describe('checkMigrations — 台帳とファイルの突き合わせ', () => {
  const ledgerQuery = (applied: string[]) => async (sql: string) => {
    if (sql.includes('schema_migrations')) return { rows: applied.map((filename) => ({ filename })) };
    return { rows: [{ ok: 1 }] };
  };

  test('★★ 未適用があれば件数と名前を warn し ok=false', async () => {
    const warns: string[] = [];
    const ok = await checkMigrations({
      query: ledgerQuery(['033_line_message_links.sql']),
      warn: (m) => warns.push(m),
      listFiles: () => ['033_line_message_links.sql', '034_user_notification_sound.sql', '040_removed_media.sql'],
    });
    expect(ok).toBe(false);
    const all = warns.join('\n');
    expect(all).toContain('未適用 2 件');
    expect(all).toContain('034_user_notification_sound.sql');
    expect(all).toContain('npm run migrate');
  });

  test('全部適用済みなら warn なし', async () => {
    const warns: string[] = [];
    const ok = await checkMigrations({
      query: ledgerQuery(['033_a.sql', '034_b.sql']),
      warn: (m) => warns.push(m),
      listFiles: () => ['033_a.sql', '034_b.sql'],
    });
    expect(ok).toBe(true);
    expect(warns).toHaveLength(0);
  });

  test('台帳が無い DB (v0.9.0 以前) では突き合わせない (runner が baseline を案内する)', async () => {
    const warns: string[] = [];
    const ok = await checkMigrations({
      query: async (sql: string) => {
        if (sql.includes('schema_migrations')) { throw undefinedTableError(); }
        return { rows: [{ ok: 1 }] };
      },
      warn: (m) => warns.push(m),
      listFiles: () => ['033_a.sql', '034_b.sql'],
    });
    expect(ok).toBe(true);
    expect(warns).toHaveLength(0);
  });
});
