/**
 * #590 ダッシュボードの基本設定 (settings.json) のうち、今の Light の経路で読まれていない項目と理由。
 *
 * ★ 読むのは Light v1 (light.mts / lightTools.mts の getSetting) だけ。本番の v2 (lightV2.mts、codex-sdk) は読まない。
 *   以前は画面が何も言わず、変えても何も起きなかった (10-12 調査、本番の settings.json は {})。
 *   消さずにグレーアウトする (10-12 利用者判断)。画面はこの返り値で灰色にし、理由を添える
 * ★ v1 で読まれている項目の一覧は __tests__/unit/settingsEffect.test.mts がコードと突き合わせる
 */
const NEVER_READ: Record<string, string> = {
  tool_tavily: 'どの経路からも読まれていません (Tavily 検索は MCP の設定で入り切りします)',
  tool_filesystem: 'どの経路からも読まれていません (ファイル操作は部屋ごとの MCP で決まります)',
  context_messages: 'どの経路からも読まれていません (#230 で会話履歴の件数の設定は外しました)',
};

const V1_ONLY: Record<string, string> = {
  tool_code_interpreter: '今の AI (Light v2) は読みません。Light v1 のときだけ効きます',
  tool_generate_image: '今の AI (Light v2) は読みません。Light v1 のときだけ効きます (v2 の画像生成は tealus MCP の道具)',
  max_turns: '今の AI (Light v2) は読みません。Light v1 のときだけ効きます',
};

export function inactiveAgentSettings(lightBackend: string | undefined): Record<string, string> {
  return lightBackend === 'v1' ? { ...NEVER_READ } : { ...NEVER_READ, ...V1_ONLY };
}
