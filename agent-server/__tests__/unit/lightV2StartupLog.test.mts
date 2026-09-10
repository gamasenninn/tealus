/**
 * LightV2 の起動ログ (2026-09-10)
 *
 * ★ なぜ必要か: 2026-09-10 の朝礼で Light が 400 で落ちた
 *   ("The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account")。
 *   ★★ **起動ログに model が無かったため、どのモデルで走っていたかをログから言えなかった。**
 *   Deep 側は #423 で `model=` を出すようにしてあり、Light だけ取り残されていた。
 *
 * ★★★ 守る不変条件: **ログに出る model は、実際に thread に渡す model と同じ**。
 *   (別々に組み立てると、片方だけ変えたときに静かにずれる = 計器が嘘をつく)
 */
import { formatLightV2StartupLog } from '../../src/agents/lightV2.mts';

describe('起動ログの書式', () => {
  test('subscription のときは auth=subscription', () => {
    const line = formatLightV2StartupLog({ apiKey: undefined, mcpServers: ['tealus'], model: 'gpt-5.5' });
    expect(line).toContain('auth=subscription');
  });

  test('API key のときは auth=API key', () => {
    const line = formatLightV2StartupLog({ apiKey: 'sk-xxx', mcpServers: ['tealus'], model: 'gpt-5.5' });
    expect(line).toContain('auth=API key');
  });

  test('★ API key の値そのものは出さない', () => {
    const line = formatLightV2StartupLog({ apiKey: 'sk-secret-value', mcpServers: [], model: 'gpt-5.5' });
    expect(line).not.toContain('sk-secret-value');
  });

  test('mcp_servers を並べる', () => {
    const line = formatLightV2StartupLog({
      apiKey: undefined, mcpServers: ['tealus', 'workspace-fs', 'tavily'], model: 'gpt-5.5',
    });
    expect(line).toContain('mcp_servers=tealus,workspace-fs,tavily');
  });

  test('★★ model を出す (これが無くて 2026-09-10 に原因特定が遅れた)', () => {
    const line = formatLightV2StartupLog({ apiKey: undefined, mcpServers: [], model: 'gpt-5.5' });
    expect(line).toContain('model=gpt-5.5');
  });

  test('★ model が未設定なら、空にせず「未設定」と分かる形で出す', () => {
    // ★ 空文字で出すと「出し忘れ」と区別が付かない。silent に見えないようにする
    const line = formatLightV2StartupLog({ apiKey: undefined, mcpServers: [], model: undefined });
    expect(line).toMatch(/model=\(未設定\)/);
  });

  test('LightV2 の札が付いている (ログの grep 先)', () => {
    const line = formatLightV2StartupLog({ apiKey: undefined, mcpServers: [], model: 'gpt-5.5' });
    expect(line.startsWith('[LightV2] ')).toBe(true);
  });
});

describe('★★★ ログに出る model と、thread に渡す model が同じこと', () => {
  test('同じ値を渡せば、ログにもその値が出る', () => {
    // ★ 実装が config を 2 回別々に読むと、ここが通っても本番でずれる。
    //   そのため実装側は「1 つの変数を両方に使う」形にしてある (lightV2.mts の該当箇所参照)。
    for (const m of ['gpt-5.5', 'gpt-5.6-luna', 'gpt-4o-mini']) {
      expect(formatLightV2StartupLog({ apiKey: undefined, mcpServers: [], model: m })).toContain(`model=${m}`);
    }
  });
});
