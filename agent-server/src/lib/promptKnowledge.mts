/**
 * #439 Step 1 — エージェントに渡す知識の配線を、宣言表で 1 か所に置く。
 *
 * ★ **まだ誰も呼ばない。** この段階では挙動を 1 byte も変えない (移行は Step 2 以降)。
 *
 * ## なぜ要るか
 *
 * 配線が 2 流派に割れている:
 *   - **agent が自分で読む** … Light v1 / Light v2
 *   - **呼び出し側が組む**   … dispatcher (Deep / 委譲 / 統合) / 会話モード
 * 片方の流派で新しい入口を作ると、もう片方の規律が効かない。**実績が 2 件ある**:
 *   - #437 会話モードだけ organon も語彙も受け取っていなかった (2026-09-13 に発覚)
 *   - `synthesize` の Deep Codex 分岐が `buildDeepPrompt` を通らない (同日、調査中に発覚)
 *
 * ## 表は「契約」であって「現状」ではない
 *
 * ★★ **現状を書いてはいけない。** 取り残しを `use: false` で書くと、**取り残しが仕様に化ける**。
 *   現状は Step 0 の特性化テスト (`promptAssembly.test.mts`) が押さえている。
 *   契約と現状のズレは `KNOWN_GAPS` に明示し、件数をテストで固定する。
 *
 * ## 「どう並べるか」は共通化しない
 *
 * ★ 経路ごとに要件が本当に違う —— Deep は user prompt の末尾に concat / Light は system prompt /
 *   会話モードは **セッションの安定接頭辞** (途中で変わると Realtime のセッションが崩れる)。
 *   **文字列連結まで共通化すると壊れる。** ここで決めるのは「何を渡すか」だけ。
 */

/** 渡しうる知識の部品。★ ここに 1 つ足すと、全経路の profile が埋まっていないと型が通らない。 */
export const PART_IDS = ['system', 'roomPrompt', 'memory', 'organon', 'vocab'] as const;
export type PartId = (typeof PART_IDS)[number];

/** 入口。★ docs/07 と #439 の地図に載っているものを全部並べる (表に無い経路が取り残しになる)。 */
export type RouteId =
  | 'lightV1'
  | 'lightV2'
  | 'deep'
  | 'delegateLightV2'
  | 'delegateDeep'
  | 'synthesize'
  | 'conversation';

/**
 * 使うか / 使わないか。★ **外すなら理由が要る。**
 * 「× は意図か忘れか」を docs/07 の散文から型へ昇格させるのが、この表の主目的。
 */
export type Decision = { use: true } | { use: false; reason: string };

type Profile = Record<PartId, Decision>;

const LIGHT_V2: Profile = {
  system: { use: true },
  roomPrompt: { use: true },
  memory: { use: true },
  organon: { use: true },
  vocab: { use: true },
};

const DEEP: Profile = {
  // ★ Deep は自前の前置き (MCP ツールの使い方 + organon 記法の指示) を持つ。
  //   共通の system prompt を重ねると指示が二重になる。
  system: { use: false, reason: 'Deep は自前の前置きを持つ。重ねると指示が二重になる' },
  roomPrompt: { use: false, reason: 'ルーム固有 prompt は Light 系の仕組み。Deep は未対応' },
  // ★ 意図的に外している。Deep は get_messages で自分で履歴を取りに行く前提。
  memory: { use: false, reason: 'Deep は get_messages で自分で履歴を取る (#295 以来の設計)' },
  organon: { use: true },
  vocab: { use: true },
};

/**
 * ★ 統合 (synthesize) の契約。**現状は organon / vocab が入っていない** が、
 *   ここには「入るべき」を書く。ズレは KNOWN_GAPS 側に出す。
 */
const SYNTHESIZE: Profile = {
  system: { use: false, reason: '統合は自前の前置きを持つ (Deep と同じ理由)' },
  roomPrompt: { use: false, reason: '複数ルームの結果を編むので、単一ルームの prompt は当たらない' },
  memory: { use: false, reason: '各ルームの結果が入力なので、別途の履歴は要らない' },
  // ★ 固有名詞は「編む」段でも出る。各室の結果に崩れた語が残っていれば、統合文にも残る。
  organon: { use: true },
  vocab: { use: true },
};

const CONVERSATION: Profile = {
  // ★ 会話モードは Realtime のセッション instructions を使う。Light の system prompt は形が違う。
  system: { use: false, reason: 'Realtime のセッション instructions を使う (形が違う)' },
  roomPrompt: { use: true },
  // ★★ 2026-09-14 に小野さんが「単に忘れていた。入れたほうがよい」と判定。
  //   → 契約は use: true。**現状の配線はまだ false** なので KNOWN_GAPS に出す。
  memory: { use: true },
  organon: { use: true },
  vocab: { use: true },
};

export const PROFILES: Record<RouteId, Profile> = {
  lightV1: LIGHT_V2, // ★ v1 と v2 で配線は同じ (実装が別なだけ)
  lightV2: LIGHT_V2,
  deep: DEEP,
  // ★ 委譲は本体へ合流する。**同じ object を指す**ことで、片方だけ直る事故を構造的に防ぐ。
  delegateLightV2: LIGHT_V2,
  delegateDeep: DEEP,
  synthesize: SYNTHESIZE,
  conversation: CONVERSATION,
};

/** その経路で実際に渡す部品。 */
export function partsFor(route: RouteId): PartId[] {
  const profile = PROFILES[route];
  return PART_IDS.filter((p) => profile[p].use);
}

/**
 * 契約と現状のズレ。★ **直すまで消さない。直したら消す。**
 *
 * 件数をテストで固定しているので、増えれば「新しい取り残しが入った」、
 * 減れば「直った」で、どちらもテストが落ちて人に気づかせる。
 */
export interface KnownGap {
  route: RouteId;
  missing: PartId[];
  /** 意図か忘れか。★ 判定せずに置かない。 */
  verdict: 'intent' | 'oversight';
  evidence: string[];
  /** ★ 覆る条件。書けない判定は判定ではない。 */
  overturnedIf: string;
  /** ★ 直す順番に制約があるなら書く (★★ 測定条件を壊す変更は、測り終える前に入れない)。 */
  note?: string;
  issue: string;
}

export const KNOWN_GAPS: KnownGap[] = [
  {
    route: 'synthesize',
    missing: ['organon', 'vocab'],
    verdict: 'oversight',
    evidence: [
      '2026-06-14 16:20 buildDeepPrompt を「通常 dispatch と委譲で共有するため」に抽出 (コミットに明記)',
      '2026-06-15 17:07 その翌日に synthesize を新設し、通さず直渡し。コミットは再入防止まで細かいのに知識の判断は一言も無い',
      '同じ関数の中で Light v2 分岐は自己配線で受け取っている (= 「統合には要らない」なら両分岐とも外すはず)',
    ],
    overturnedIf: '当時「統合には語彙を渡さない」と判断した記録が出てきたら取り下げる (現在は記録が 1 つも無いことが根拠)',
    issue: '#439',
  },
  {
    route: 'conversation',
    missing: ['memory'],
    verdict: 'oversight',
    evidence: [
      '#437 (2026-09-13) で organon と語彙は入れたが、memory だけ入れていない',
      'memory を外す判断の記録が、issue にも commit にも設計書にも 1 つも無い',
      '2026-09-14 小野さんが「単に忘れていた。入れたほうがよい」と判定 (= 人の明示)',
    ],
    overturnedIf: '会話モードで memory を外す理由が実測で出たら取り下げる (例: 接頭辞が伸びて立ち上がりが有意に遅くなる)',
    // ★★ 直す順番の制約。#437 の「立ち上がりの速さを n>50 で引き直す」が未了で、
    //   memory を先に足すと **prompt の量が変わって前後比較が壊れる**。
    //   2026-09-13 に組み込んだ 45KB の効果を測り終えてから入れる。
    //   ★ 「直せると分かっている」と「今直してよい」は別。
    note: '★ #437 の立ち上がり速度を n>50 で引き直してから入れる (先に足すと測定条件が変わる)',
    issue: '#439',
  },
];
