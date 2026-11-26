/**
 * #439 Step 1 — 知識配線の宣言表。★ まだ誰も呼ばない (挙動変更ゼロ)。
 *
 * ★ 何のための表か
 *   配線が「agent が自分で読む」(Light 系) と「呼び出し側が組む」(dispatcher / 会話モード) の
 *   2 流派に割れていて、片方で新しい入口を作るともう片方の規律が効かない。
 *   実績 2 件: #437 (会話モードだけ organon も語彙も受け取っていなかった) と
 *   synthesize の Deep Codex 分岐 (buildDeepPrompt を通らない)。
 *
 * ★★ 表は **契約 (あるべき配線)** を書く。**現状ではない。**
 *   現状は Step 0 の特性化テストが押さえている。両者のズレは KNOWN_GAPS に明示し、
 *   件数をテストで固定する —— ★ 表に現状を書くと、**取り残しを「仕様」として凍結**してしまう。
 */
import {
  PROFILES,
  KNOWN_GAPS,
  PART_IDS,
  partsFor,
  type KnownGap,
  type PartId,
  type RouteId,
} from '../../src/lib/promptKnowledge.mts';

/**
 * KNOWN_GAPS の 1 件が守るべき決まり。破っている点を並べて返す (空なら合格)。
 * ★ 改善ループ 127: 以前は for (gap of KNOWN_GAPS) の中にだけ expect があり、KNOWN_GAPS が 0 件
 *   (下で固定している) なので検証 0 件で必ず通っていた。決まりを関数にし、仮のズレでも確かめる
 */
function gapViolations(gap: KnownGap): string[] {
  const v: string[] = [];
  if (gap.verdict !== 'oversight') v.push('verdict');                          // 意図なら表 (契約) の側で外す
  if (gap.evidence.length < 2) v.push('evidence');
  if (gap.overturnedIf.trim().length === 0) v.push('overturnedIf');            // ★ 覆る条件を書く。書けない判定は判定ではない
  for (const part of gap.missing) {
    if (PROFILES[gap.route][part].use !== true) v.push(`contract:${part}`);    // 契約は「入るべき」で書く
  }
  return v;
}

describe('#439 Step 1 — 宣言表', () => {
  it('経路を 7 本とも持つ', () => {
    // ★ docs/07 と #439 の地図に載っている入口をすべて並べる。
    //   「表に無い経路」は取り残しの温床なので、数を固定する。
    expect(Object.keys(PROFILES).sort()).toEqual(
      ['conversation', 'deep', 'delegateDeep', 'delegateLightV2', 'lightV1', 'lightV2', 'synthesize'].sort(),
    );
  });

  it('★ 部品を足したら全経路が埋まっていないとコンパイルが通らない形になっている', () => {
    // 型では表せないので、ここで実行時にも確かめる (★ 部品追加時の取り残し検出)。
    for (const [route, profile] of Object.entries(PROFILES)) {
      for (const part of PART_IDS) {
        expect(profile[part as PartId]).toBeDefined();
      }
      expect(Object.keys(profile).sort()).toEqual([...PART_IDS].sort());
      expect(route).toBeTruthy();
    }
  });

  it('★★ 外すなら理由が要る (★ 空文字も不可)', () => {
    // 「× は意図か忘れか」を型に昇格させるのがこの表の主目的。
    for (const profile of Object.values(PROFILES)) {
      for (const part of PART_IDS) {
        const d = profile[part as PartId];
        if (!d.use) expect(d.reason.trim().length).toBeGreaterThan(0);
      }
    }
    // ★ 外した部品が 1 つも無いと上の expect は 1 回も走らない (改善ループ 127)
    const excluded = Object.values(PROFILES).flatMap((p) => PART_IDS.filter((part) => !p[part as PartId].use));
    expect(excluded.length).toBeGreaterThan(0);
  });

  it('委譲は本体と同じ配線 (★ 別物にすると片方だけ直る)', () => {
    // D は B へ、E は C へ合流する。同じ object を指すことで drift を構造的に防ぐ。
    expect(PROFILES.delegateLightV2).toBe(PROFILES.lightV2);
    expect(PROFILES.delegateDeep).toBe(PROFILES.deep);
  });

  it('partsFor は使う部品だけを返す', () => {
    expect(partsFor('lightV2')).toEqual(expect.arrayContaining(['organon', 'vocab']));
    expect(partsFor('deep')).not.toContain('roomPrompt');
  });
});

describe('#439 Step 1 — 契約と現状のズレ', () => {
  it('★ 既知のズレは 0 件', () => {
    // 増えたら「新しい取り残しが入った」。減ったら「直った」。
    // どちらもこのテストが落ちて、人に気づかせる。
    // ★ synthesize は Step 2 (2026-09-14) で 2 → 1、会話モードの memory は 2026-09-27 に 1 → 0 と
    //   **直させられた**。仕組みが設計どおり働いた例として残す。
    expect(KNOWN_GAPS.map((g) => g.route)).toEqual([]);
  });

  it('★★ 載っているズレはどれも決まりを守る (判定・根拠 2 つ以上・覆る条件・契約側は use: true)', () => {
    for (const gap of KNOWN_GAPS) expect(gapViolations(gap)).toEqual([]);
  });

  describe('★★★ 決まりそのもの (KNOWN_GAPS が 0 件でも走る)', () => {
    // 契約で使う部品 (lightV2 の organon) と、契約で外している部品 (deep の roomPrompt) を例に使う
    const ok: KnownGap = {
      route: 'lightV2', missing: ['organon'], verdict: 'oversight',
      evidence: ['a', 'b'], overturnedIf: '入れると遅くなると測れたら', issue: '#439',
    };
    it('前提: 例に使う部品の契約', () => {
      expect(PROFILES.lightV2.organon.use).toBe(true);
      expect(PROFILES.deep.roomPrompt.use).toBe(false);
    });
    it('守っているズレは合格', () => {
      expect(gapViolations(ok)).toEqual([]);
    });
    it('意図 (intent) と判定したものは載せない', () => {
      expect(gapViolations({ ...ok, verdict: 'intent' })).toEqual(['verdict']);
    });
    it('根拠が 1 つでは足りない', () => {
      expect(gapViolations({ ...ok, evidence: ['a'] })).toEqual(['evidence']);
    });
    it('覆る条件が空白だけでは足りない', () => {
      expect(gapViolations({ ...ok, overturnedIf: '  ' })).toEqual(['overturnedIf']);
    });
    it('契約で外している部品をズレに載せると落ちる (現状を表に書くと取り残しが仕様に化ける)', () => {
      expect(gapViolations({ ...ok, route: 'deep', missing: ['roomPrompt'] })).toEqual(['contract:roomPrompt']);
    });
  });
});
