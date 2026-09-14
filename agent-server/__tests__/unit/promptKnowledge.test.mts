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
  type PartId,
  type RouteId,
} from '../../src/lib/promptKnowledge.mts';

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
  it('★ 既知のズレは 2 件 (★★ synthesize / conversation)', () => {
    // 増えたら「新しい取り残しが入った」。減ったら「直った」。
    // どちらもこのテストが落ちて、人に気づかせる。
    // ★ 2 件目は表を書いたことで見つかったもの (会話モードの memory)。
    expect(KNOWN_GAPS.map((g) => g.route)).toEqual(['synthesize', 'conversation']);
  });

  it('★★★★ 直す順番に制約があるズレは、その制約を書いている', () => {
    // ★ 「直せると分かっている」と「今直してよい」は別。
    //   会話モードの memory は #437 の速度測定が未了なので、先に足すと前後比較が壊れる。
    const conv = KNOWN_GAPS.find((g) => g.route === 'conversation');
    expect(conv?.note).toContain('#437');
  });

  it('★★ ズレには「意図か忘れか」の判定と、その根拠が要る', () => {
    for (const gap of KNOWN_GAPS) {
      expect(gap.verdict).toBe('oversight');
      expect(gap.evidence.length).toBeGreaterThanOrEqual(2);
      // ★ 覆る条件を書く。書けない判定は判定ではない。
      expect(gap.overturnedIf.trim().length).toBeGreaterThan(0);
    }
  });

  it('★★★ ズレている部品は 契約側では use: true になっている', () => {
    // 表に現状 (×) を書くと取り残しが仕様に化ける。契約は「入るべき」で書く。
    for (const gap of KNOWN_GAPS) {
      for (const part of gap.missing) {
        expect(PROFILES[gap.route as RouteId][part].use).toBe(true);
      }
    }
  });
});
