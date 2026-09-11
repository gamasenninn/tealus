/**
 * codex 経路のモデル可否ガード (2026-09-11)
 *
 * ★ 発端: 採用者環境 (v0.9) で Deep Codex が全面停止した (サポート班の報告 2026-09-10)。
 *   既定値 `AGENT_DEEP_CODEX_MODEL='gpt-5.4'` が ChatGPT アカウントでは使えず、
 *   ★★ 画面には `auth failed (unauthorized)` と出るため **再ログインへ誤誘導**した
 *   (#422 の修正は v0.9 に入っていない)。★★★ 採用者が自力で真因に到達した。
 *
 * ★★★★ 実測 (2026-09-10、subscription):
 *   gpt-5.4 ✗ / gpt-5.4-mini ✗ / gpt-5.5-mini ✗ / gpt-5.6 ✗ (採用者) / gpt-5.5 ○ / gpt-5.6-luna ○
 *   → ★ **mini は系統ごと不可。★★ 「新しければ良い」でもない** (5.6 は名前ごとに違う)。
 *
 * ★★★★★ 守る約束:
 *   1 ★ 止めない (warn だけ)。モデルの可否は外部で変わるので、コードが止めると
 *     正しい設定でも動かなくなる。★★ JWT_SECRET の throw とは性質が違う。
 *   2 ★ 「何を設定すればよいか」を必ず出す。★★ これが無いと再ログインへ誤誘導される。
 *   3 ★★★ **リストに無ければ安全、とは言わない**。実測した範囲しか知らない。
 */
import { checkCodexModels, KNOWN_UNSUPPORTED_CODEX_MODELS } from '../../src/utils/codexModelGuard.mts';

describe('codex 経路に入っているかの判定', () => {
  test('★ 既定では Deep は codex 経路に入らない (DEEP_AGENT_PROVIDER=claude)', () => {
    const r = checkCodexModels({ deepProvider: 'claude', deepAuth: 'subscription', deepModel: 'gpt-5.4' });
    expect(r).toHaveLength(0);
  });

  test('★★ provider=codex + subscription + 使えないモデル → 警告', () => {
    const r = checkCodexModels({ deepProvider: 'codex', deepAuth: 'subscription', deepModel: 'gpt-5.4' });
    expect(r).toHaveLength(1);
    expect(r[0].setting).toBe('AGENT_DEEP_CODEX_MODEL');
    expect(r[0].model).toBe('gpt-5.4');
  });

  test('★ API key 経路なら警告しない (mini も使える)', () => {
    const r = checkCodexModels({ deepProvider: 'codex', deepAuth: 'api-key', deepModel: 'gpt-5.4' });
    expect(r).toHaveLength(0);
  });

  test('★ 使えるモデルなら警告しない', () => {
    const r = checkCodexModels({ deepProvider: 'codex', deepAuth: 'subscription', deepModel: 'gpt-5.5' });
    expect(r).toHaveLength(0);
  });
});

describe('★★ Light v2 も同じ経路を通る', () => {
  test('★ backend=v2 + subscription + mini → 警告', () => {
    const r = checkCodexModels({ lightBackend: 'v2', lightAuth: 'subscription', lightModel: 'gpt-5.4-mini' });
    expect(r).toHaveLength(1);
    expect(r[0].setting).toBe('AGENT_LIGHT_MODEL');
  });

  test('★★ LIGHTV2_AUTH 未設定 (= API key 経路) なら警告しない', () => {
    const r = checkCodexModels({ lightBackend: 'v2', lightAuth: undefined, lightModel: 'gpt-5.4-mini' });
    expect(r).toHaveLength(0);
  });

  test('★ backend=v1 なら codex を通らないので警告しない', () => {
    const r = checkCodexModels({ lightBackend: 'v1', lightAuth: 'subscription', lightModel: 'gpt-5.4-mini' });
    expect(r).toHaveLength(0);
  });

  test('★★★ Deep と Light が両方駄目なら 2 件出る (★ 片方で止めない)', () => {
    const r = checkCodexModels({
      deepProvider: 'codex', deepAuth: 'subscription', deepModel: 'gpt-5.4',
      lightBackend: 'v2', lightAuth: 'subscription', lightModel: 'gpt-5.5-mini',
    });
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.setting).sort()).toEqual(['AGENT_DEEP_CODEX_MODEL', 'AGENT_LIGHT_MODEL']);
  });
});

describe('★★★ 既知の使えないモデル (実測ベース)', () => {
  test.each(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5-mini', 'gpt-5.6'])('%s は使えないものとして載っている', (m) => {
    expect(KNOWN_UNSUPPORTED_CODEX_MODELS).toContain(m);
  });

  test('★ 使えると実測したものは載せない', () => {
    expect(KNOWN_UNSUPPORTED_CODEX_MODELS).not.toContain('gpt-5.5');
    expect(KNOWN_UNSUPPORTED_CODEX_MODELS).not.toContain('gpt-5.6-luna');
  });

  test('★★★★ gpt-5.6 と gpt-5.6-luna を混同しない (★ 前方一致で判定していたら落ちる)', () => {
    const bad = checkCodexModels({ deepProvider: 'codex', deepAuth: 'subscription', deepModel: 'gpt-5.6' });
    const ok = checkCodexModels({ deepProvider: 'codex', deepAuth: 'subscription', deepModel: 'gpt-5.6-luna' });
    expect(bad).toHaveLength(1);
    expect(ok).toHaveLength(0);
  });
});

describe('★★★★★ 警告の中身 — ★ 再ログインへ誤誘導させないこと', () => {
  const one = () => checkCodexModels({ deepProvider: 'codex', deepAuth: 'subscription', deepModel: 'gpt-5.4' })[0];

  test('★ 何を設定すればよいかを書く', () => {
    expect(one().message).toContain('AGENT_DEEP_CODEX_MODEL=gpt-5.5');
  });

  test('★★ 認証の問題ではないと明示する (★★★ 表示が auth failed になるため)', () => {
    expect(one().message).toMatch(/認証|ログイン/);
  });

  test('★ 実測した日付を添える (★★ モデルの可否は変わるので、いつの情報か分かるように)', () => {
    expect(one().message).toMatch(/2026-09-\d\d/);
  });

  test('★★★ 「リストに無ければ安全」と読めない書き方にする', () => {
    expect(one().message).toMatch(/実測|確かめ/);
  });
});
