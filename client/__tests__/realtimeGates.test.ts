import { describe, it, expect } from 'vitest';
import { createResponseGate } from '../src/utils/realtimeResponseGate';
import { createSpeechGate, createSpeakingView } from '../src/utils/speechGate';
import { readTranscriptEvent } from '../src/utils/realtimeTranscript';

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

  /**
   * ★★ #421 —— 断ったときに **なぜ断ったか** を外から読めるようにする。
   *
   * 2026-09-07 に 318 往復のログを引いたら `response_create_skipped` は 4 件あり、
   * **3 つの別々の形**だった:
   * ```
   * 1  割り込みの直後   音は消えたのに応答は走ったまま → 次の発話が落ちた (利用者は 1.3 秒後に閉じた)
   * 2  ★ 門が開かない   最後の音が終わって 161 秒、何も鳴っていないのに断られた (利用者は黙って閉じた)
   * 3  押している間に    押した時は鳴っていない → 割り込みが走らない。保持中に AI が喋り始めた
   * ```
   * ★ 2 は「前の返事が続いています」では**嘘になる**。断った理由を記録に残さないと、
   *   画面に出す文言も、次の直し方も決められない。
   */
  it('★★ 断った理由を読めるようにする (走っている応答 / 動いている道具 の別)', () => {
    const g = createResponseGate();
    expect(g.whyCannotCreate()).toBe(null);          // ★ 作れるときは理由が無い

    g.onServerEvent('response.created');
    expect(g.whyCannotCreate()).toBe('responding');

    g.onServerEvent('response.done');
    g.beginTool();
    expect(g.whyCannotCreate()).toBe('tool');
  });

  it('★ 両方あるときは「応答が走っている」を先に返す (道具は応答の中で動くため)', () => {
    const g = createResponseGate();
    g.onServerEvent('response.created');
    g.beginTool();
    expect(g.whyCannotCreate()).toBe('responding');
  });

  it('★ 動いている道具の数も読める (1 つずつ減るのを外から数えられる)', () => {
    const g = createResponseGate();
    expect(g.pendingTools()).toBe(0);
    g.beginTool(); g.beginTool();
    expect(g.pendingTools()).toBe(2);
    g.endTool();
    expect(g.pendingTools()).toBe(1);
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

/**
 * #415 「話しています」のちらつきを、もう 1 つの信号と合わせて止める。
 *
 * ★ `speechGate` だけでは、**400ms を超える発話の切れ目**で消えて出る (実測で 1 応答あたり
 *   中央値 4 回、計測ログの 64% がこの上下だった)。
 * ★★ サーバ側の「応答の音声を配信中か」と合わせる。ただし **立ち上がりの時刻は門のまま** ——
 *   配信開始の合図で前倒しすると、基準① の計器が AnalyserNode でなくなる (#410 の決定が崩れる)。
 */
describe('createSpeakingView — 応答の途中で「終わった」と言わない (#415)', () => {
  it('★ 門が鳴ったら、その時刻で立ち上がる (配信中でなくても)', () => {
    const v = createSpeakingView();
    expect(v.update(true, false)).toEqual({ shown: true, mark: 'start' });
  });

  it('★★ 配信が先に始まっても、立ち上がりの印は出さない (① の計器を前倒ししない)', () => {
    const v = createSpeakingView();
    expect(v.update(false, true)).toEqual({ shown: true, mark: null });   // 表示は出す
    expect(v.update(true, true)).toEqual({ shown: true, mark: 'start' }); // 印は門が鳴ってから
  });

  it('★★ 応答の途中の切れ目 (門が落ちても配信中) では終わりにしない', () => {
    const v = createSpeakingView();
    v.update(true, true);
    expect(v.update(false, true)).toEqual({ shown: true, mark: null });
    expect(v.update(true, true)).toEqual({ shown: true, mark: null });   // ★ 2 回目の start を出さない
  });

  it('★ 両方落ちたら終わり', () => {
    const v = createSpeakingView();
    v.update(true, true);
    expect(v.update(false, false)).toEqual({ shown: false, mark: 'end' });
  });

  it('★★ 配信の終わりの合図が来なくても、門が落ちれば終われる (止まらなくならない)', () => {
    const v = createSpeakingView();
    v.update(true, false);
    expect(v.update(false, false)).toEqual({ shown: false, mark: 'end' });
  });

  it('★ 次の応答では、また立ち上がりの印が出る', () => {
    const v = createSpeakingView();
    v.update(true, true);
    v.update(false, false);
    expect(v.update(true, true)).toEqual({ shown: true, mark: 'start' });
  });

  it('★ 変化がなければ何も返さない (同じ状態で印を出し続けない)', () => {
    const v = createSpeakingView();
    v.update(true, true);
    expect(v.update(true, true)).toEqual({ shown: true, mark: null });
  });

  it('★ reset で元に戻る (セッションを張り直したときに持ち越さない)', () => {
    const v = createSpeakingView();
    v.update(true, true);
    v.reset();
    expect(v.update(true, true)).toEqual({ shown: true, mark: 'start' });
  });
});

/**
 * #412 人の発話が 1 件も記録されていなかった。
 *
 * ★ 受け取りの条件が `type.endsWith('transcript.done')` で、**入力側のイベント名
 *   (`conversation.item.input_audio_transcription.completed`) に一致しなかった**。
 *   文字起こし自体は行われていて (session に `transcription` を渡している)、
 *   **受け取り側だけが取りこぼしていた** —— 実測で transcript 328 件すべて AI 側。
 *
 * ★★ docs/08 §12.6 は基準④ を「transcript 全文を人が読んで判定する」と決めている。
 *   **答えだけ並んでいて、何を聞かれたかが無い**状態では判定できない。
 */
describe('readTranscriptEvent — どちら側の発話かを読み取る (#412)', () => {
  it('★★ 入力側の文字起こし (名前が transcript.done で終わらない) を拾う', () => {
    expect(readTranscriptEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '在庫を調べて',
    })).toEqual({ who: 'user', text: '在庫を調べて' });
  });

  it('★ AI 側はこれまでどおり', () => {
    expect(readTranscriptEvent({
      type: 'response.output_audio_transcript.done',
      transcript: '確認しますね',
    })).toEqual({ who: 'ai', text: '確認しますね' });
  });

  it('★ 中身が空なら残さない (空の行を計測に混ぜない)', () => {
    expect(readTranscriptEvent({ type: 'conversation.item.input_audio_transcription.completed', transcript: '   ' })).toBeNull();
    expect(readTranscriptEvent({ type: 'response.output_audio_transcript.done' })).toBeNull();
  });

  it('★ 途中経過 (delta) や 失敗は拾わない (完了だけ)', () => {
    expect(readTranscriptEvent({ type: 'conversation.item.input_audio_transcription.delta', transcript: '在庫' })).toBeNull();
    expect(readTranscriptEvent({ type: 'conversation.item.input_audio_transcription.failed', transcript: '' })).toBeNull();
  });

  it('★ 関係ないイベントは拾わない', () => {
    expect(readTranscriptEvent({ type: 'response.done', transcript: 'x' })).toBeNull();
  });
});
