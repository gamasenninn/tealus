/**
 * Codex SDK / CLI 認証エラー検出 helper (pre-α、#292 default 'v2' flip 前提)
 *
 * 6/5 サポート班観測 (= 藤井さん環境):
 *   [LightV2] stream error: Reconnecting... 5/5
 *   Failed to refresh token: Your session has ended
 *
 * これを ThreadErrorEvent.message / Error.message / proc.stderr 経由で detect、
 * user に「ChatGPT のサインインが切れました」案内を出すための pure function helper。
 *
 * light (= SDK in-process) + deep (= CLI spawn) の error 経路で共通使用、
 * SDK upgrade 時の追従点を 1 file に集約 (= 1 instrument 主義)。
 *
 * 注: 6/8 Day 23 dogfood で観測した
 *   [LightV2] post-turn stream error: Failed to parse item: ☐☐☐...
 * は Windows taskkill 出力混入の別 root cause、本 helper では false 返却 (= 既存 ignore 維持)。
 */

interface AuthFailPattern {
  kind: string;
  re: RegExp;
}

export const AUTH_FAIL_PATTERNS: AuthFailPattern[] = [
  // 6/5 観察 fixture (= 高信頼度)
  { kind: 'session_ended', re: /Your session has ended/i },
  { kind: 'refresh_failed', re: /Failed to refresh token/i },
  // SDK / CLI の error 文言として観察可能な候補 (= 中信頼度、conservative)
  { kind: 'unauthorized', re: /\b401\b|\bunauthorized\b/i },
  { kind: 'token_expired', re: /token[_ ]expired|invalid[_ ]token/i },
];

/**
 * ★★ 認証**ではない**と分かっている形 (#422)。★ 認証パターンより先に見る。
 *
 * 2026-09-06: codex が古くてモデル一覧を解釈できず落ちたのに「サインインが切れました」と
 * 案内し、★ 利用者にブラウザログインを繰り返させた。誤判定の理由は
 * **76KB のモデル一覧 JSON の中の `unauthorized` の 1 語**に中信頼度パターンが反応したこと。
 */
export const NON_AUTH_PATTERNS: AuthFailPattern[] = [
  // codex が新しいモデル一覧を解釈できない (= CLI が古い)
  { kind: 'cli_outdated', re: /failed to decode models response|codex_models_manager/i },
];

/**
 * ★ 判定に使う範囲を絞る (#422)。
 *
 * ★★ **`body: {` から後ろは見ない。** サーバから返った JSON の中身であって、
 *   codex の言い分ではない。そこに出てくる語で原因を決めてはいけない。
 * ★ さらに先頭 2000 字までに限る (長大な stderr の末尾に紛れた 1 語で判定しない)。
 */
export function classifiableSlice(message: string): string {
  const bodyAt = message.search(/\bbody:\s*[{[]/i);
  const head = bodyAt >= 0 ? message.slice(0, bodyAt) : message;
  return head.slice(0, 2000);
}

export interface CodexAuthErrorResult {
  isAuth: boolean;
  kind: string | null;
  raw: string | undefined;
}

/**
 * error message を解析して認証切れ系か判定。
 *
 * @param message - ThreadErrorEvent.message / Error.message / stderr
 * @returns isAuth=true なら retry skip、user に再 login 案内推奨。
 *   複数 pattern hit 時は最初の hit を kind に返す (= deterministic)。
 */
export function detectCodexAuthError(message: string | undefined): CodexAuthErrorResult {
  if (!message || typeof message !== 'string') {
    return { isAuth: false, kind: null, raw: message };
  }
  const target = classifiableSlice(message);

  // ★★ 認証ではないと分かっている形を先に見る (#422)。順序が逆だと、
  //   モデル一覧の JSON に紛れた語で「認証切れ」と誤判定する。
  for (const { kind, re } of NON_AUTH_PATTERNS) {
    if (re.test(target)) {
      return { isAuth: false, kind, raw: message };
    }
  }
  for (const { kind, re } of AUTH_FAIL_PATTERNS) {
    if (re.test(target)) {
      return { isAuth: true, kind, raw: message };
    }
  }
  return { isAuth: false, kind: null, raw: message };
}

/**
 * ★ 判定の結果から、利用者に出す 1 行を作る (#422)。
 *
 * ★★ **分からないときは推測しない。** 間違った案内は、案内が無いより悪い ——
 *   2026-09-06 に「サインインが切れました」と出して、**利用者を無駄なログインに送り込んだ**。
 */
export function buildCodexErrorUserMessage(result: CodexAuthErrorResult): string {
  if (result.isAuth) return buildAuthFailUserMessage();
  if (result.kind === 'cli_outdated') {
    return 'codex が新しい応答を解釈できませんでした。サーバーで codex を更新してください (`npm i -g @openai/codex@alpha`)。';
  }
  // ★ 原因が分からないときは、原因を名乗らずに調べ先を出す
  return 'AI の起動に失敗しました。サーバーのログ (agent-server) を確認してください。';
}

/**
 * user 向け日本語 1 行案内 (= raw 詳細は log only 推奨)。
 *
 * 文言設計 (= memory feedback_japanese_plain_language.md 適用):
 *   - 「subscription」「authentication」を日本語化 (= ChatGPT のサインイン)
 *   - 30 字以内 1 行、行動指示 (= codex login + 再起動) を明示
 */
export function buildAuthFailUserMessage(): string {
  return 'ChatGPT のサインインが切れました。サーバーで `codex login` を実行して再起動してください。';
}
