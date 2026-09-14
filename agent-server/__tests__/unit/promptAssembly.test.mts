/**
 * #439 Step 0 — prompt 組み立ての特性化テスト。
 *
 * ★ これは「良い設計を守るテスト」ではない。**今の出力を 1 byte も動かさないための防壁**。
 *   #439 は 5 部品 × 7 経路の配線を一本化する案で、移行の等価性を保証するものが他に無い。
 *
 * ★★ 知識の loader (organon / vocab) は mock で固定する。ここで測りたいのは
 *   **組み立て**であって、loader の中身ではない (中身は env と file に依存して動く)。
 *
 * ★★★ 期待値は verbatim。テンプレートから組み立て直すと「同じ式を 2 回書く」ことになり、
 *   ★ 言い換えは検算にならない (2026-09-14 に別件で踏んだ)。
 */
jest.mock('dotenv', () => ({ config: jest.fn() }));
// ★ dispatcher を import すると router → OpenAI client が module 読み込み時に作られ、
//   鍵が無い環境で落ちる。既存の dispatcher.test.mts と同じく router を mock する。
jest.mock('../../src/router/index.mts', () => ({ route: jest.fn() }));
jest.mock('../../src/agents/light.mts', () => ({ processLight: jest.fn() }));
jest.mock('../../src/agents/lightV2.mts', () => ({ processLight: jest.fn(), processLightV2: jest.fn() }));
// ★ mock が 4 つ要るのは、**文字列を組み立てるだけの関数を呼ぶため**。
//   dispatcher を import すると router / light / lightV2 が module 読み込み時に
//   OpenAI client を作る。#439 が言う「配線が経路ごとに手作業」の副作用がここにも出ている。
//   ★★ Step 1 で純関数を別 module へ出せば、この mock は全部不要になる。
jest.mock('../../src/lib/organonContext.mts', () => ({
  loadOrganonPolysemeForPrompt: () => '<<ORG>>',
  isInjectEnabled: () => false,
  logOrganonInjectState: () => {},
}));
jest.mock('../../src/lib/vocabContext.mts', () => ({
  loadVocabForPrompt: () => '<<VOC>>',
}));

import { buildLightPrompt, buildDeepPrompt } from '../../src/webhook/dispatcher.mts';

describe('#439 Step 0 — buildLightPrompt の特性化', () => {
  it('replyHint 無し', () => {
    expect(buildLightPrompt('R1', 'Q1')).toBe('現在のルーム ID: R1\n\nユーザーの質問: Q1');
  });

  it('replyHint 付き (★ ルーム ID の直後・改行なしで差し込まれる)', () => {
    expect(buildLightPrompt('R1', 'Q1', ' / 返信先: X')).toBe(
      '現在のルーム ID: R1 / 返信先: X\n\nユーザーの質問: Q1',
    );
  });

  it('★ Light には organon / 語彙が入らない (★★ agent 側が自分で読むため)', () => {
    const out = buildLightPrompt('R1', 'Q1');
    expect(out).not.toContain('<<ORG>>');
    expect(out).not.toContain('<<VOC>>');
  });
});

describe('#439 Step 0 — buildDeepPrompt の特性化', () => {
  it('★ 末尾は「質問 → organon → 語彙」の順 (★★ 並べ方は経路ごとに違うので固定する)', () => {
    const out = buildDeepPrompt('R1', 'Q1');
    expect(out.endsWith('ユーザーの質問: Q1<<ORG>><<VOC>>')).toBe(true);
  });

  it('★ 全文が 1 byte も変わらないこと', () => {
    expect(buildDeepPrompt('ROOM-ID', 'QUESTION', ' / HINT')).toBe(
      `あなたは Tealus メッセンジャーの AI アシスタントです。
Tealus MCP ツール（tealus サーバー）を使って情報を取得し、ユーザーの質問に回答してください。

現在のルーム ID: ROOM-ID / HINT
まず get_messages ツールでこのルームの直近の会話を確認してから回答してください。

議事録 / 業務記録 生成時は、後述する organon polyseme entries (= 業務語彙 + alias + mapping) を参照し、以下の方針で **必ず** 出力してください:

1. **alias 訂正 (= 確信度高)**: 既知 entry の alias 完全一致は正規名に訂正 (例: 「マサ→山崎整備長」「ソートメ→五月女」「三平→三瓶」)。元音声を残す必要なし。
2. **推測可能 alias (= 確信度中)**: organon entry に類似 alias / sub-family pattern (= 「マ」prefix / 漢字頭部置換 / 業務句 hallucination 等) があれば、本文に **[要確認: 推測正規名 か、音声上は「元音声」]** 形式で記載 (例: 「[要確認: 山崎整備長 か、音声上は「上山」]」「[要確認: 三瓶 か、音声上は「三平」]」)。
3. **未登録 / 確信度低**: 本文に **[要確認: 音声上「元音声」]** marker のみ (= 推測なし)。
4. **末尾 section 必須**: 本文に [要確認] が 1 つでもあれば、議事録末尾に **「## organon 記法 注意事項」** section を **必ず** 追加してください。各 [要確認] 項目の reasoning (= 該当 organon entry / alias family / sub-family pattern / 揺らぎ pattern / 推測根拠 等) を集約。[要確認] が 0 件なら section 省略 OK。

ユーザーの質問: QUESTION<<ORG>><<VOC>>`,
    );
  });
});
