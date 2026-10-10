/**
 * #565 AI (codex) の子プロセスに渡す環境変数。許可した一覧だけを渡す。
 *
 * ★ 以前は agent-server の環境変数をそのまま渡していて、AI がシェルで動かすコマンドにも
 *   鍵・パスワード・DB の接続情報が届いていた (codex は名前に KEY/SECRET/TOKEN を含むものを隠すが、
 *   *_PASS・DB_PASSWORD などは隠れない)。
 * ★ codex の API キーは codex-sdk (CODEX_API_KEY) / buildCodexExecEnv (OPENAI_API_KEY) が明示して足す。
 *   AI の道具 (tealus-mcp など) が要るものは道具の設定で個別に渡す (lightV2.mts / deep.mts)。
 * ★ 足すときは「AI のシェルに見えてよいか」で決める。名前は大文字小文字を問わない (Windows の Path / PATH)
 */
const ALLOWED = new Set([
  // 実行の場所・一時ファイル・ホーム
  'PATH', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432',
  'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432',
  // Windows の基本
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'OS', 'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'COMPUTERNAME', 'USERNAME', 'USERDOMAIN',
  // POSIX の基本・言語・端末
  'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TZ',
  // プロキシ (社内ネットワーク)
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  // codex 自身の置き場 (Deep codex は CODEX_HOME を明示して上書きする)
  'CODEX_HOME',
]);

export function agentChildEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && ALLOWED.has(k.toUpperCase())) env[k] = v;
  }
  return env;
}
