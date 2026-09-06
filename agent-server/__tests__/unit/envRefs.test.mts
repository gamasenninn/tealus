/**
 * #419 ルームの MCP 設定から資格情報を追い出す。
 *
 * ★ ルームの workspace には `mcp_config.json` があり、そこに **DB の接続文字列が平文**で
 *   入っていた。filesystem MCP の root がその workspace なので、**`read_file` で読める**
 *   (2026-09-06 に #418 で読み取り系が全許可になり、声からも届くようになった)。
 *
 * ★★ 直し方は「設定ファイルには `${VAR}` の参照だけを書き、実体は agent-server の .env に置く」。
 *   .env は workspace の外にあるので、**filesystem MCP からは届かない**。
 *
 * ★★★ 展開は **設定を読むすべての経路**で効かないと意味がない
 *   (roomMcpManager / lightV2 / deep の 3 か所が同じファイルを読む)。
 */
const { expandEnvRefs } = require('../../src/lib/envRefs.mts') as {
  expandEnvRefs: <T>(value: T, env?: Record<string, string | undefined>) => T;
};

describe('expandEnvRefs — 設定の ${VAR} を実体に置き換える (#419)', () => {
  const env = { HKSDB_DSN: 'mysql://u:p@h:3306/d', TAVILY_API_KEY: 'tvly-xxx' };

  test('★ 文字列の中の ${VAR} を置き換える', () => {
    expect(expandEnvRefs('${HKSDB_DSN}', env)).toBe('mysql://u:p@h:3306/d');
  });

  test('★ 文字列の一部でも置き換える (前後が残る)', () => {
    expect(expandEnvRefs('--dsn=${HKSDB_DSN}', env)).toBe('--dsn=mysql://u:p@h:3306/d');
  });

  test('★ 1 つの文字列に 2 つ以上あっても全部置き換える', () => {
    expect(expandEnvRefs('${TAVILY_API_KEY}/${TAVILY_API_KEY}', env)).toBe('tvly-xxx/tvly-xxx');
  });

  test('★★ 配列とオブジェクトの中まで入っていく (args / env に入るため)', () => {
    const def = {
      command: 'npx',
      args: ['-y', '@bytebase/dbhub@latest', '--dsn', '${HKSDB_DSN}'],
      env: { KEY: '${TAVILY_API_KEY}' },
    };
    expect(expandEnvRefs(def, env)).toEqual({
      command: 'npx',
      args: ['-y', '@bytebase/dbhub@latest', '--dsn', 'mysql://u:p@h:3306/d'],
      env: { KEY: 'tvly-xxx' },
    });
  });

  test('★★ 元のオブジェクトを書き換えない (読み込み元を汚さない)', () => {
    const def = { args: ['${HKSDB_DSN}'] };
    expandEnvRefs(def, env);
    expect(def.args[0]).toBe('${HKSDB_DSN}');
  });

  test('★★★ 定義されていない変数は、そのまま残す (勝手に空文字にしない)', () => {
    // ★ 空にすると `mysql://:@h/d` のような**それらしく見えて壊れている**値になり、
    //   原因が分かりにくくなる。★★ 残せば起動が失敗して名前がそのままログに出る。
    expect(expandEnvRefs('${NOPE}', env)).toBe('${NOPE}');
  });

  test('★ ${...} でない $ は触らない', () => {
    expect(expandEnvRefs('価格は $100 です', env)).toBe('価格は $100 です');
  });

  test('★ 数値や真偽値はそのまま返す', () => {
    expect(expandEnvRefs({ timeout: 30, enabled: true, nothing: null }, env))
      .toEqual({ timeout: 30, enabled: true, nothing: null });
  });
});
