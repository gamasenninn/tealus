import { describe, it, expect } from 'vitest';
import { createResponseGate } from '../src/utils/realtimeResponseGate';
import { createSpeechGate } from '../src/utils/speechGate';

/**
 * #405 実測 (2026-09-05、8 往復) で出た 2 件の不具合を固定する (docs/08 §12)。
 * どちらも「印象では分からず、計測ログを読んで初めて出た」型。
 */

describe('createResponseGate — 応答を二重に走らせない', () => {
  /**
   * ★ 実測で出た形: 1 ターンで道具が **2 つ並行に**呼ばれ、それぞれの完了で
   *   `response.create` を送っていた。2 通目が
   *   "Conversation already has an active response in progress" で弾かれた。
   *   → **最後の 1 つが終わったときだけ**作る。
   */
  it('★ 道具が 1 つなら、終わったときに作る', () => {
    const g = createResponseGate();
    g.beginTool();
    expect(g.endTool()).toBe(true);
  });

  it('★★ 道具が 2 つ並行なら、作るのは 1 回だけ (実測で踏んだ形)', () => {
    const g = createResponseGate();
    g.beginTool();
    g.beginTool();
    expect(g.endTool()).toBe(false);   // 1 つ目が終わってもまだ作らない
    expect(g.endTool()).toBe(true);    // 最後の 1 つで作る
  });

  it('★ 3 つ以上でも最後の 1 回だけ', () => {
    const g = createResponseGate();
    g.beginTool(); g.beginTool(); g.beginTool();
    expect([g.endTool(), g.endTool(), g.endTool()]).toEqual([false, false, true]);
  });

  it('★ 応答が走っている間は作らせない', () => {
    const g = createResponseGate();
    g.onServerEvent('response.created');
    expect(g.canCreate()).toBe(false);
    g.onServerEvent('response.done');
    expect(g.canCreate()).toBe(true);
  });

  it('★ 道具の実行中も作らせない (押して離しても割り込ませない)', () => {
    const g = createResponseGate();
    g.beginTool();
    expect(g.canCreate()).toBe(false);
  });

  it('★ 何も走っていなければ作れる', () => {
    expect(createResponseGate().canCreate()).toBe(true);
  });

  it('★ reset で元に戻る (セッションを張り直したときに前の状態を持ち越さない)', () => {
    const g = createResponseGate();
    g.beginTool();
    g.onServerEvent('response.created');
    g.reset();
    expect(g.canCreate()).toBe(true);
  });
});

describe('createSpeechGate — 言葉の切れ目で「話し終わった」にしない', () => {
  /**
   * ★ 実測で出た形: 8 往復に対して立ち上がり検知が **301 回**。
   *   しきい値をまたぐたびに切り替えていたので、**言葉の切れ目を毎回「終わり」と拾っていた**。
   *   → 下回ってから holdMs 続いて初めて「終わり」にする。
   *
   * ★ 基準① (2 秒) は「離してから**最初の**立ち上がり」なので、この不具合の影響を受けない。
   *   壊れていたのは「何秒話したか」と、画面の「話しています」表示の方。
   */
  const opts = { onThreshold: 0.012, offThreshold: 0.006, holdMs: 400 };

  it('★ しきい値を超えたら即座に「話している」', () => {
    const g = createSpeechGate(opts);
    expect(g.feed(0.05, 0)).toBe(true);
  });

  it('★★ 短い切れ目 (300ms) では終わりにしない — これが 301 回の正体', () => {
    const g = createSpeechGate(opts);
    g.feed(0.05, 0);
    expect(g.feed(0.001, 100)).toBe(true);
    expect(g.feed(0.001, 300)).toBe(true);
  });

  it('★ 400ms 続いて静かなら、そこで終わりにする', () => {
    const g = createSpeechGate(opts);
    g.feed(0.05, 0);
    g.feed(0.001, 300);
    expect(g.feed(0.001, 401)).toBe(false);
  });

  it('★ 切れ目の途中で声が戻れば、待ち時間は数え直す', () => {
    const g = createSpeechGate(opts);
    g.feed(0.05, 0);
    g.feed(0.001, 300);
    g.feed(0.05, 350);               // 戻った
    expect(g.feed(0.001, 700)).toBe(true);   // 350 からまだ 350ms
    expect(g.feed(0.001, 760)).toBe(false);  // ここで 400ms 経過
  });

  it('★ 小さい音は「まだ話している」に数える (off < rms < on)', () => {
    const g = createSpeechGate(opts);
    g.feed(0.05, 0);
    g.feed(0.008, 300);              // on 未満だが off 超え = 続いている
    expect(g.feed(0.001, 650)).toBe(true);
  });

  it('★ 静かなまま始まったら、話していない', () => {
    expect(createSpeechGate(opts).feed(0.001, 0)).toBe(false);
  });

  it('★★ 1 往復ぶんの波形で、切り替わるのは 2 回だけ (301 回にならない)', () => {
    const g = createSpeechGate(opts);
    let flips = 0;
    let prev = false;
    // 3 秒の発話。50ms ごとに、言葉の切れ目 (120ms の無音) を 6 回挟む
    for (let t = 0; t <= 3000; t += 50) {
      const inGap = [400, 800, 1200, 1600, 2000, 2400].some((s) => t >= s && t < s + 120);
      const now = g.feed(inGap ? 0.001 : 0.05, t);
      if (now !== prev) { flips++; prev = now; }
    }
    for (let t = 3050; t <= 3600; t += 50) {
      const now = g.feed(0.001, t);
      if (now !== prev) { flips++; prev = now; }
    }
    expect(flips).toBe(2);   // 立ち上がり 1 回 + 終わり 1 回
  });
});

describe('createResponseGate — 割り込みに必要な item を追う', () => {
  /**
   * ★ 実測 (2026-09-05、8 往復・割り込み 5 回) で出た形:
   *   `response.cancel` が 5 回中 4 回 `Cancellation failed: no active response found` で失敗した。
   *   リアルタイムモデルは**喋る速さより速く作る**ので、聞こえている最中には生成が終わっている。
   *   → 止めるべきは生成ではなく、**まだ聞かせていない音声**。`conversation.item.truncate` を送る。
   *
   * ★ 押して話す (turn_detection: null) では、サーバの自動割り込みが働かない
   *   (自動 truncate は発話検知が動いている場合の話)。**こちらから送る必要がある。**
   */
  it('★ 応答が走っていなければ cancel を送らない (無駄なエラーを出さない)', () => {
    const g = createResponseGate();
    g.onServerEvent('response.done');
    expect(g.isResponding()).toBe(false);
  });

  it('★ 応答が走っていれば cancel を送ってよい', () => {
    const g = createResponseGate();
    g.onServerEvent('response.created');
    expect(g.isResponding()).toBe(true);
  });

  it('★★ truncate に要る item_id を、サーバのイベントから拾う', () => {
    const g = createResponseGate();
    g.onServerEvent('response.output_item.added', { item: { id: 'item_abc' } });
    expect(g.activeItemId()).toBe('item_abc');
  });

  it('★ 新しい item が来たら差し替える (古い item を truncate しない)', () => {
    const g = createResponseGate();
    g.onServerEvent('response.output_item.added', { item: { id: 'item_1' } });
    g.onServerEvent('response.output_item.added', { item: { id: 'item_2' } });
    expect(g.activeItemId()).toBe('item_2');
  });

  it('★ item_id が無ければ null (truncate を送らない判断ができる)', () => {
    expect(createResponseGate().activeItemId()).toBeNull();
  });

  it('★ 一度 truncate したら、同じ item を二度 truncate しない', () => {
    const g = createResponseGate();
    g.onServerEvent('response.output_item.added', { item: { id: 'item_1' } });
    expect(g.takeItemForTruncate()).toBe('item_1');
    expect(g.takeItemForTruncate()).toBeNull();
  });

  it('★ reset で item も消える', () => {
    const g = createResponseGate();
    g.onServerEvent('response.output_item.added', { item: { id: 'item_1' } });
    g.reset();
    expect(g.activeItemId()).toBeNull();
  });
});

describe('createResponseGate — 出力音声が鳴っているかを、サーバのイベントで知る', () => {
  /**
   * ★★★★ 2026-09-05、ネットで調べて分かったこと (これが決め手だった):
   *   WebRTC には **`output_audio_buffer.clear`** というクライアントイベントがある。
   *   「まだ再生されていない音声を消す」もので、**WebSocket には無く WebRTC 専用**。
   *   公式の手順は `response.cancel` → `output_audio_buffer.clear` の 2 段。
   *
   * ★ こちらが送っていた `conversation.item.truncate` は**サーバの文脈しか直さない**。
   *   同じ症状の報告が上がっており、「制御系と音声系が切り離されていて、
   *   truncate が成功しても配信は止まらない」と説明されていた。実測の 505〜6658ms と一致する。
   *
   * ★★ 副産物: `output_audio_buffer.*` は「実際に鳴っているか」の**まともな計器**になる。
   *   AnalyserNode は手元のバッファを捨てても鳴っているように見えるので、基準③ には使えない。
   */
  it('★ 出力音声が始まったら「鳴っている」', () => {
    const g = createResponseGate();
    g.onServerEvent('output_audio_buffer.started');
    expect(g.isOutputAudioPlaying()).toBe(true);
  });

  it('★ 消えたら「鳴っていない」(clear の効きを測る点)', () => {
    const g = createResponseGate();
    g.onServerEvent('output_audio_buffer.started');
    g.onServerEvent('output_audio_buffer.cleared');
    expect(g.isOutputAudioPlaying()).toBe(false);
  });

  it('★ 止まったときも「鳴っていない」', () => {
    const g = createResponseGate();
    g.onServerEvent('output_audio_buffer.started');
    g.onServerEvent('output_audio_buffer.stopped');
    expect(g.isOutputAudioPlaying()).toBe(false);
  });

  it('★ 未記載の audio_started / audio_stopped も同じに扱う (名前が揺れている)', () => {
    const g = createResponseGate();
    g.onServerEvent('output_audio_buffer.audio_started');
    expect(g.isOutputAudioPlaying()).toBe(true);
    g.onServerEvent('output_audio_buffer.audio_stopped');
    expect(g.isOutputAudioPlaying()).toBe(false);
  });

  it('★ 最初は鳴っていない', () => {
    expect(createResponseGate().isOutputAudioPlaying()).toBe(false);
  });

  it('★ reset で戻る', () => {
    const g = createResponseGate();
    g.onServerEvent('output_audio_buffer.started');
    g.reset();
    expect(g.isOutputAudioPlaying()).toBe(false);
  });
});

/**
 * ★ ルームに足す道具の入力を、区切り文字で取りこぼさない (2026-09-05)。
 *
 * カンマ区切りだけを想定していたら、**空白で入力されて 1 つの文字列として保存された**
 * (`["execute_sql  search_objects tavily_search"]`)。プレースホルダに区切り文字を
 * 書いていなかったのが原因だが、**区切り文字を人に覚えさせる方が間違い**。
 */
describe('道具名の入力を区切る', () => {
  const parse = (s: string) => s.split(/[\s,、]+/).map((t) => t.trim()).filter(Boolean);

  it('★ 空白区切り (実際に入力された形)', () => {
    expect(parse('execute_sql  search_objects tavily_search'))
      .toEqual(['execute_sql', 'search_objects', 'tavily_search']);
  });
  it('カンマ区切り', () => {
    expect(parse('execute_sql, search_objects')).toEqual(['execute_sql', 'search_objects']);
  });
  it('★ 全角の読点でも区切れる (日本語入力のまま打てる)', () => {
    expect(parse('execute_sql、search_objects')).toEqual(['execute_sql', 'search_objects']);
  });
  it('前後の空白と空要素は落とす', () => {
    expect(parse('  a ,, b  ')).toEqual(['a', 'b']);
  });
  it('空なら空 (何も足さない)', () => {
    expect(parse('   ')).toEqual([]);
  });
});
