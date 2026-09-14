/**
 * #438 doctor — 起動時の設定で決まっていたことを、起動時に言う。
 *
 * ★ 受け入れ条件の芯は「**採用第 2 号が踏んだ 3 件が 3 件とも出ること**」。
 *   3 件とも気づいたのは人であってコードではなく、3 件とも起動した時点の設定で決まっていた。
 *
 * ★★ 守る約束 (f8ac2f1 の判断を継ぐ):
 *   1 止めない (warn だけ)
 *   2 「何を設定すればよいか」を必ず出す (★ 無いと再ログインへ誤誘導される = #431 の再演)
 *   3 「リストに無ければ安全」とは言わない
 *   4 ★ 値を出さない。資格情報は形・長さ・指紋だけ
 */
import { runDoctor, fingerprint, type Finding } from '../../src/lib/doctor.mts';

const ids = (fs: Finding[]): string[] => fs.map((f) => f.id).sort();

describe('#438 doctor — 採用第 2 号が踏んだ 3 件', () => {
  it('★ 2026-09-10 Deep のモデルが ChatGPT アカウントで使えない', () => {
    const f = runDoctor({
      DEEP_AGENT_PROVIDER: 'codex',
      DEEP_CODEX_AUTH: 'subscription',
      AGENT_DEEP_CODEX_MODEL: 'gpt-5.4',
    });
    expect(ids(f)).toContain('codex-model');
    const hit = f.find((x) => x.id === 'codex-model')!;
    // ★ 約束 2: 何を設定すればよいかが出る
    expect(hit.fix).toContain('AGENT_DEEP_CODEX_MODEL');
    // ★ #431 の再演を防ぐ 1 行
    expect(hit.detail).toContain('ログインし直しても直りません');
  });

  it('★★ 2026-09-11 Deep だけ直して Light が取り残された', () => {
    // ★ この形が本 issue の芯。片方を直しても、もう片方が残っていることを言う。
    const f = runDoctor({
      DEEP_AGENT_PROVIDER: 'codex',
      DEEP_CODEX_AUTH: 'subscription',
      AGENT_DEEP_CODEX_MODEL: 'gpt-5.5', // ★ 直した
      AGENT_LIGHT_BACKEND: 'v2',
      LIGHTV2_AUTH: 'subscription',
      AGENT_LIGHT_MODEL: 'gpt-5.4-mini', // ★ 取り残し
    });
    const hit = f.find((x) => x.id === 'codex-model');
    expect(hit?.fix).toContain('AGENT_LIGHT_MODEL');
  });

  it('★★★ 経路ごとのモデルを 1 か所に並べる (★ 片方だけ直したことに気づける形)', () => {
    // ★ 警告が出ない設定でも、どの経路が何を指しているかは必ず出す。
    //   2026-09-11 の取り残しは「Deep を直したので終わったつもり」で起きた。
    const f = runDoctor({ AGENT_LIGHT_MODEL: 'gpt-5.4-mini', AGENT_DEEP_CODEX_MODEL: 'gpt-5.5' });
    const table = f.find((x) => x.id === 'route-models')!;
    expect(table.level).toBe('info');
    expect(table.detail).toContain('AGENT_LIGHT_MODEL');
    expect(table.detail).toContain('AGENT_DEEP_CODEX_MODEL');
  });
});

describe('#438 doctor — 必須 env', () => {
  it('欠けを出す。★ 何を設定すればよいかも出す', () => {
    const f = runDoctor({});
    const hit = f.find((x) => x.id === 'required-env')!;
    expect(hit.level).toBe('warn');
    expect(hit.detail).toContain('TEALUS_BOT_ID');
    expect(hit.fix.length).toBeGreaterThan(0);
  });

  it('揃っていれば warn を出さない', () => {
    const f = runDoctor({
      TEALUS_BOT_ID: 'bot', TEALUS_BOT_PASS: 'pw', TEALUS_API_URL: 'http://x',
    });
    expect(ids(f)).not.toContain('required-env');
  });
});

describe('#438 doctor — ★ 値を 1 文字も出さない (約束 4)', () => {
  const SECRET = 'sk-verysecretvalue-1234567890';

  it('資格情報の値が出力のどこにも出ない', () => {
    const f = runDoctor({ TEALUS_BOT_ID: 'bot', TEALUS_BOT_PASS: SECRET, OPENAI_API_KEY: SECRET });
    const all = JSON.stringify(f);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('verysecret');
  });

  it('★ 指紋は 形・長さ・sha256 先頭 8 桁だけ', () => {
    const fp = fingerprint(SECRET);
    expect(fp).toMatch(/^len=\d+ sha=[0-9a-f]{8}$/);
    expect(fp).not.toContain(SECRET.slice(0, 6));
  });

  it('未設定は「未設定」と言う (★ 空文字の指紋を出さない)', () => {
    // 空文字の sha256 を出すと、設定されているように見える。
    expect(fingerprint(undefined)).toBe('(未設定)');
    expect(fingerprint('')).toBe('(未設定)');
  });
});

describe('#438 doctor — 約束', () => {
  it('★ 例外を投げない (止めない)', () => {
    // 診断が失敗しても起動は続く。★ JWT_SECRET の throw とは性質が違う。
    expect(() => runDoctor({ AGENT_DEEP_CODEX_MODEL: undefined as unknown as string })).not.toThrow();
  });

  it('★★ 「全部 OK」を強く言わない', () => {
    // 沈黙を合格と読ませない。確かめた項目を並べるだけにする。
    const f = runDoctor({ TEALUS_BOT_ID: 'b', TEALUS_BOT_PASS: 'p', TEALUS_API_URL: 'u' });
    const text = f.map((x) => x.detail + x.fix).join(' ');
    expect(text).not.toMatch(/問題ありません|すべて OK|全部 OK/);
    // ★ 代わりに「確かめた項目」を出す
    expect(ids(f)).toContain('checked');
  });

  it('★★★ 外部を叩かない (起動時に呼べる)', () => {
    // 起動のたびに外部を叩くと、外部の不調で起動が遅くなる / 課金が増える。
    // 実測する口は別に分ける (#438 の「2 段にする」)。
    const started = Date.now();
    runDoctor({});
    expect(Date.now() - started).toBeLessThan(200);
  });
});
