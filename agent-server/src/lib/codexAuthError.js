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

const AUTH_FAIL_PATTERNS = [
  // 6/5 観察 fixture (= 高信頼度)
  { kind: 'session_ended', re: /Your session has ended/i },
  { kind: 'refresh_failed', re: /Failed to refresh token/i },
  // SDK / CLI の error 文言として観察可能な候補 (= 中信頼度、conservative)
  { kind: 'unauthorized', re: /\b401\b|\bunauthorized\b/i },
  { kind: 'token_expired', re: /token[_ ]expired|invalid[_ ]token/i },
];

/**
 * error message を解析して認証切れ系か判定。
 *
 * @param {string|undefined} message - ThreadErrorEvent.message / Error.message / stderr
 * @returns {{ isAuth: boolean, kind: string|null, raw: string|undefined }}
 *   isAuth=true なら retry skip、user に再 login 案内推奨。
 *   複数 pattern hit 時は最初の hit を kind に返す (= deterministic)。
 */
function detectCodexAuthError(message) {
  if (!message || typeof message !== 'string') {
    return { isAuth: false, kind: null, raw: message };
  }
  for (const { kind, re } of AUTH_FAIL_PATTERNS) {
    if (re.test(message)) {
      return { isAuth: true, kind, raw: message };
    }
  }
  return { isAuth: false, kind: null, raw: message };
}

/**
 * user 向け日本語 1 行案内 (= raw 詳細は log only 推奨)。
 *
 * 文言設計 (= memory feedback_japanese_plain_language.md 適用):
 *   - 「subscription」「authentication」を日本語化 (= ChatGPT のサインイン)
 *   - 30 字以内 1 行、行動指示 (= codex login + 再起動) を明示
 */
function buildAuthFailUserMessage() {
  return 'ChatGPT のサインインが切れました。サーバーで `codex login` を実行して再起動してください。';
}

module.exports = { detectCodexAuthError, buildAuthFailUserMessage, AUTH_FAIL_PATTERNS };
