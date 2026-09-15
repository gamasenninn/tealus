/**
 * ★ `docs/02_DB設計.md` が実スキーマから置いていかれていないかを見張る (2026-09-15)。
 *
 * ## なぜ要るか
 *
 * ★ 2026-09-15 の突き合わせで、**docs/02 は 9 本しか載せていなかった。migration は 23 本作る。**
 *   ★★ 落ちていた中に `message_edits` があり、**その意味論 (過去の版だけを持ち、最新版は
 *   `messages.content` にある) がどこにも書かれていなかった。**
 *   ★★★ そのせいで手直しの台帳が **最後の遷移 44% を落としていた** (#440)。
 *
 * ## ★★ DB に繋がない
 *
 * migration の `CREATE TABLE` を読む。★ テストを machine 非依存に保つ約束 (docs/05 §3)。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DOC = path.resolve(ROOT, '../docs/02_DB設計.md');
const MIGRATIONS = path.join(ROOT, 'src/db/migrations');

/** migration が作るテーブル名。★ `schema_migrations` は台帳なので対象外 (#406)。 */
function tablesFromMigrations(): string[] {
  const out = new Set<string>();
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/gi)) {
      out.add(m[1].toLowerCase());
    }
  }
  out.delete('schema_migrations');
  return [...out].sort();
}

describe('docs/02 DB設計 — ★ 実スキーマから置いていかれない形にする', () => {
  const doc = fs.readFileSync(DOC, 'utf8');

  it('★★★★ migration が作るテーブルが、全部 設計書に出てくる', () => {
    const missing = tablesFromMigrations().filter((t) => !doc.includes(t));
    // ★ 落ちたら **設計書に足す**。★★ テストを緩めない ——
    //   緩めた瞬間に「9 本しか載っていない」が再演する
    expect(missing).toEqual([]);
  });

  it('★★ 取り違えると害が出る 2 つの意味論が書いてある', () => {
    // ★ message_edits: 「過去の版だけ / 最新は messages.content」を落とすと 44% 落ちる (#440)
    expect(doc).toContain('最新版は `messages.content` にある');
    // ★★ voice_transcriptions: 行を数えると発話を二重に数える (2026-09-15 実測で 56% 水増し)
    expect(doc).toContain('行を数えると発話を二重に数える');
  });
});
