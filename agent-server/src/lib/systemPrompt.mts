/**
 * #439 Step 5 — system prompt の読み込みを 1 本にする。
 *
 * ★ light.mts と lightV2.mts に **バイト単位で同じ実装**が 2 つあった (定数も同じ)。
 *   知識の部品 5 つのうち `system` だけが、中央に無いまま 2 か所で重複していた形。
 *
 * ★★ 評価のタイミングは変えていない。`CONFIG_DIR` は **module 読み込み時**に決まる
 *   (従来と同じ)。呼ばれるたびに読み直す形にすると、test が env を後から差し替えたときに
 *   挙動が変わる —— **重複を消すついでに意味を変えない**。
 *
 * ★★★ `import.meta.dirname` の深さは `src/agents/` と `src/lib/` で同じなので、
 *   `../../config` は移動後も `agent-server/config` を指す (実測で確認)。
 */
import path from 'node:path';
import fs from 'node:fs';

// AGENT_CONFIG_DIR env で override 可能 (test isolation 用、production では unset で default)
const CONFIG_DIR = process.env.AGENT_CONFIG_DIR || path.join(import.meta.dirname, '..', '..', 'config');

/** カスタム prompt がこれ未満なら「書きかけ」とみなして default に落とす。 */
const MIN_CUSTOM_PROMPT_LENGTH = 50;

/**
 * system prompt を読む。
 *
 * 1. `config/system_prompt.md` があればそれを使う (カスタム、ただし 50 文字以上)
 * 2. なければ `config/default_system_prompt.md`
 * 3. どちらも読めなければ既定の 1 行
 */
export function loadSystemPrompt(): string {
  const customPath = path.join(CONFIG_DIR, 'system_prompt.md');
  const defaultPath = path.join(CONFIG_DIR, 'default_system_prompt.md');
  try {
    if (fs.existsSync(customPath)) {
      const content = fs.readFileSync(customPath, 'utf8').trim();
      if (content && content.length >= MIN_CUSTOM_PROMPT_LENGTH) return content;
    }
    if (fs.existsSync(defaultPath)) {
      return fs.readFileSync(defaultPath, 'utf8').trim();
    }
  } catch {}
  return 'あなたはTealusのAIアシスタントです。';
}
