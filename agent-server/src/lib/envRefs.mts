/**
 * #419 設定ファイルの `${VAR}` を環境変数の実体に置き換える。
 *
 * ★ **なぜ要るか**: ルームの `mcp_config.json` に **DB の接続文字列が平文**で入っていた。
 *   filesystem MCP の root がその workspace なので、**`read_file` で読める**
 *   (#418 で読み取り系が全許可になり、音声からも届くようになった)。
 *
 * ★★ 設定には `${HKSDB_DSN}` の**参照だけ**を書き、実体は agent-server の `.env` に置く。
 *   `.env` は workspace の外なので、**filesystem MCP からは届かない**。
 *
 * ★★★ **設定を読むすべての経路で使うこと。** 同じファイルを 3 か所が読んでいる:
 *   - `mcp/roomMcpManager.mts` (会話モード / in-process MCP)
 *   - `agents/lightV2.mts`     (codex にメモリで渡す)
 *   - `agents/deep.mts`        (claude 用にファイルへ書き出す。★ 書き出し先は workspace の外)
 *   1 か所でも忘れると、そこだけ `${VAR}` のまま子プロセスへ渡って**静かに繋がらなくなる**。
 */
import { logger } from './logger.mts';

const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * `${VAR}` を `env` の値に置き換える。文字列・配列・オブジェクトの中まで入る。
 *
 * ★ **定義されていない変数はそのまま残す。** 空文字にすると `mysql://:@host/db` のような
 *   **それらしく見えて壊れている**値になり、原因が分かりにくくなる。
 *   残せば接続が失敗し、**変数名がそのままログに出る**ので追える。
 * ★ 元の値は書き換えない (読み込み元を汚さない)。
 */
export function expandEnvRefs<T>(value: T, env: Record<string, string | undefined> = process.env): T {
  if (typeof value === 'string') {
    return value.replace(REF, (whole, name: string) => {
      const v = env[name];
      if (v === undefined) {
        logger.warn(`[envRefs] 環境変数 ${name} が未定義です (設定の \${${name}} をそのまま渡します)`);
        return whole;
      }
      return v;
    }) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => expandEnvRefs(v, env)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expandEnvRefs(v, env);
    }
    return out as unknown as T;
  }
  return value;
}
