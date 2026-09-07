import type { VoiceChatRecord } from '../../src/lib/voiceChatReport.mts';

/**
 * #410 会話モードの計測ログを、**毎回同じ分母**で集計する。
 *
 * ★ ここで固定するのは「数え方」であって、速さそのものではない。
 *   これまで集計はその場で書き捨てていて、**回ごとに分母が変わっていた** ——
 *   docs/08 §12.6「同じ計器で測り直す」を担保できない。
 *
 * ★★ docs/08 §12.7 の教訓を数え方として埋め込む:
 *   割り込みの分母は「押した時に **本当に鳴っていたか**」で作る。
 *   鳴っていない時に押した回を混ぜると、22 秒後の停止が入って中央値が壊れる。
 *
 * ★ 基準① の計器は **AnalyserNode (`ai_audio_start`)** を正とする (利用者判断 2026-09-06)。
 *   実際に音が鳴り始めた瞬間 = 体感に近く、サーバイベントより中央値 134ms 遅い = 判定は厳しい側。
 */
const { summarizeVoiceChat } = require('../../src/lib/voiceChatReport.mts') as {
  summarizeVoiceChat: (records: VoiceChatRecord[]) => ReturnType<typeof import('../../src/lib/voiceChatReport.mts').summarizeVoiceChat>;
};

/** 1 往復ぶんのイベント列を組み立てる (t はミリ秒) */
function turn(at: number, replyAfterMs: number, opts: { serverFirst?: boolean } = {}) {
  const events: Array<{ t: number; type: string; data?: unknown }> = [
    { t: at, type: 'ptt_press' },
    { t: at + 500, type: 'ptt_release' },
  ];
  // ★ サーバイベントの方が先に来るのが普通 (実測で 200 中 162 回)。それでも ① は AnalyserNode で測る
  if (opts.serverFirst !== false) events.push({ t: at + 500 + replyAfterMs - 134, type: 'output_audio_started' });
  events.push({ t: at + 500 + replyAfterMs, type: 'ai_audio_start' });
  return events;
}

function rec(events: Array<{ t: number; type: string; data?: unknown }>, sessionId = 's1'): VoiceChatRecord {
  return { session_id: sessionId, room_id: 'r1', events };
}

describe('summarizeVoiceChat — 基準① (#410)', () => {
  test('★★ ① は AnalyserNode で測る (サーバイベントが先に来ていても、そちらを採らない)', () => {
    const s = summarizeVoiceChat([rec(turn(0, 1000))]);
    expect(s.latency.n).toBe(1);
    expect(s.latency.medianMs).toBe(1000);      // 866 (= サーバイベント) ではない
  });

  test('★★ 合格ラインは 9 割 (利用者判断 2026-09-06)', () => {
    // 10 往復のうち 9 回が 2 秒以内 → 合格
    const events = [...Array(9)].flatMap((_, i) => turn(i * 10_000, 1000))
      .concat(turn(90_000, 3000));
    const s = summarizeVoiceChat([rec(events)]);
    expect(s.latency.withinCount).toBe(9);
    expect(s.latency.withinRatio).toBeCloseTo(0.9);
    expect(s.latency.pass).toBe(true);
  });

  test('★ 9 割に届かなければ不合格', () => {
    const events = [...Array(8)].flatMap((_, i) => turn(i * 10_000, 1000))
      .concat(turn(80_000, 3000), turn(90_000, 3000));
    const s = summarizeVoiceChat([rec(events)]);
    expect(s.latency.withinRatio).toBeCloseTo(0.8);
    expect(s.latency.pass).toBe(false);
  });

  test('★ 声が返らなかった往復は「返らなかった」として数える (速い回だけ数えない)', () => {
    const s = summarizeVoiceChat([rec([
      { t: 0, type: 'ptt_press' },
      { t: 500, type: 'ptt_release' },      // ★ このあと何も鳴らない
      { t: 9000, type: 'session_end' },
    ])]);
    expect(s.latency.n).toBe(0);
    expect(s.latency.noReplyCount).toBe(1);
  });
});

describe('summarizeVoiceChat — 基準②③④と昇格 (#410)', () => {
  test('★ ② 往復数はセッションごとに数える', () => {
    const a = rec([...turn(0, 900), ...turn(10_000, 900)], 'sA');
    const b = rec(turn(0, 900), 'sB');
    const s = summarizeVoiceChat([a, b]);
    expect(s.sessions).toBe(2);
    expect(s.turns).toBe(3);
    expect(s.turnsPerSession.max).toBe(2);
  });

  test('★★ ③ 割り込みの分母は「押した時に本当に鳴っていたか」で作る (§12.7 の教訓)', () => {
    const s = summarizeVoiceChat([rec([
      // 鳴っている最中に押した → 数える
      { t: 0, type: 'interrupt', data: { was_playing: true } },
      { t: 120, type: 'output_audio_stopped' },
      // 鳴っていない時に押した → ★ 分母から外す (次の応答の終わりまで 22 秒あっても混ぜない)
      { t: 1000, type: 'interrupt', data: { was_playing: false } },
      { t: 23_000, type: 'output_audio_stopped' },
    ])]);
    expect(s.interrupt.n).toBe(1);
    expect(s.interrupt.medianMs).toBe(120);
    expect(s.interrupt.skippedNotPlaying).toBe(1);
  });

  test('★ ④ 道具は名前ごとに所要をまとめる', () => {
    const s = summarizeVoiceChat([rec([
      { t: 0, type: 'tool_call_end', data: { name: 'get_messages', elapsed_ms: 10 } },
      { t: 100, type: 'tool_call_end', data: { name: 'get_messages', elapsed_ms: 30 } },
      { t: 200, type: 'tool_call_end', data: { name: 'tavily_search', elapsed_ms: 5220 } },
    ])]);
    expect(s.tools.find((t) => t.name === 'get_messages')).toMatchObject({ n: 2, medianMs: 30 });
    expect(s.tools.find((t) => t.name === 'tavily_search')).toMatchObject({ n: 1, maxMs: 5220 });
  });

  test('★★ 昇格は成功だけでなく失敗も数える (成功だけ数えていたのが #408)', () => {
    const s = summarizeVoiceChat([rec([
      { t: 0, type: 'promote_start' }, { t: 100, type: 'promote_done' },
      { t: 200, type: 'promote_start' }, { t: 300, type: 'promote_error', data: { status: 403 } },
      { t: 400, type: 'promote_start' }, { t: 500, type: 'promote_error', data: { status: null } },
    ])]);
    expect(s.promote).toMatchObject({ started: 3, done: 1, error: 2 });
    // ★ サーバが断ったのか、そもそも届かなかったのか (#408)
    expect(s.promote.byStatus['403']).toBe(1);
    expect(s.promote.byStatus['届かず']).toBe(1);
  });

  test('★★ #408 より前の記録 (status のキーが無い) を「届かず」に混ぜない', () => {
    const s = summarizeVoiceChat([rec([
      { t: 0, type: 'promote_error', data: { message: '残せませんでした' } },          // 古い記録
      { t: 10, type: 'promote_error', data: { message: '残せませんでした', status: null } },  // 届かなかった
    ])]);
    expect(s.promote.byStatus['不明 (記録が古い)']).toBe(1);
    expect(s.promote.byStatus['届かず']).toBe(1);
  });

  test('★ 切断を数える (#409 で残るようになった)', () => {
    const s = summarizeVoiceChat([rec([
      { t: 0, type: 'connection_lost', data: { state: 'failed' } },
      { t: 10, type: 'server_error', data: { message: 'なにか知らないエラー' } },
    ])]);
    expect(s.connectionLost).toBe(1);
    expect(s.serverErrors).toBe(1);
  });

  test('★★ 既知の競合はエラーに数えない (#416)。分けて数える', () => {
    const s = summarizeVoiceChat([rec([
      // ★ docs/08 §12.8 で原因が特定済み。割り込みが効いているときほど出る
      { t: 0, type: 'server_error', data: { message: 'Cancellation failed: no active response found' } },
      { t: 10, type: 'server_error', data: { message: 'Cancellation failed: no active response found' } },
      { t: 20, type: 'server_error', data: { message: '知らないエラー' } },
    ])]);
    // ★ 既知の競合に埋もれると、新しいエラーが 1 件出ても気づけない
    expect(s.serverErrors).toBe(1);
    expect(s.knownRaces).toBe(2);
  });
});

/**
 * ★★ #420 —— ① が遅い往復を「どの道具を呼んだか」で分ける。
 *
 * 2026-09-06 の見立ては「社内DB検索ルームだけ遅い。8.8KB の light_prompt.md が疑わしい」だった。
 * ★ 310 往復を引き直したら **ルームではなく往復で割れていた**:
 *   ```
 *   execute_sql を呼んだ往復  n=31  中央値 1.78s  2 秒超 12
 *   道具を呼ばなかった往復     n=206 中央値 1.18s  2 秒超 25
 *   ```
 *   同じ部屋の中でも execute_sql の往復だけが遅い (社内DB検索: 1.78s / 1.34s / 1.19s)。
 *   light_prompt.md は 9/05 15:28:04 以降ずっと同じで、**定数は変数を説明できない**。
 *
 * ★★★ 道具の**実行時間**は既に `tools` で見えていた (execute_sql は 8〜80ms)。
 *   見えていなかったのは「**その道具を呼ぶ往復は、声が返り始めるのが遅い**」方。
 *   分けて数えられないと、次も「ルームが遅い」から始めてしまう。
 */
describe('summarizeVoiceChat — ① を道具ごとに分ける (#420)', () => {
  /** 往復 + その往復で呼ばれた道具 */
  function turnWithTools(at: number, replyAfterMs: number, names: string[]) {
    const ev = turn(at, replyAfterMs);
    names.forEach((name, i) => ev.push({ t: at + 500 + replyAfterMs + 100 + i, type: 'tool_call_start', data: { name } }));
    return ev;
  }

  test('★★ 道具を呼んだ往復と呼ばなかった往復を分けて数える', () => {
    const s = summarizeVoiceChat([rec([
      ...turnWithTools(0, 3000, ['execute_sql']),
      ...turnWithTools(20_000, 1800, ['execute_sql']),
      ...turn(40_000, 1000),
      ...turn(60_000, 1200),
    ])]);
    const sql = s.latencyByTool.find((x) => x.name === 'execute_sql');
    expect(sql).toMatchObject({ n: 2, medianMs: 3000, overLimit: 1 });   // ★ 2 秒超は 3000 の 1 件だけ
    const none = s.latencyByTool.find((x) => x.name === '(道具なし)');
    expect(none).toMatchObject({ n: 2, medianMs: 1200, overLimit: 0 });
  });

  test('★ 1 往復で 2 種類呼んだら、両方に 1 回ずつ数える (往復は 1 つ)', () => {
    const s = summarizeVoiceChat([rec(turnWithTools(0, 1500, ['execute_sql', 'search_objects']))]);
    expect(s.latencyByTool.find((x) => x.name === 'execute_sql')).toMatchObject({ n: 1, medianMs: 1500 });
    expect(s.latencyByTool.find((x) => x.name === 'search_objects')).toMatchObject({ n: 1, medianMs: 1500 });
    expect(s.latency.n).toBe(1);   // ★ ① の分母は往復数のまま (二重に数えない)
  });

  test('★ 同じ道具を 1 往復で 3 回呼んでも、その往復は 1 回として数える', () => {
    const s = summarizeVoiceChat([rec(turnWithTools(0, 1500, ['execute_sql', 'execute_sql', 'execute_sql']))]);
    expect(s.latencyByTool.find((x) => x.name === 'execute_sql')).toMatchObject({ n: 1 });
  });

  test('★★ 区切りは ① と同じ「次に押すまで」。応答の後半で呼ばれた道具も、その往復のものにする', () => {
    const s = summarizeVoiceChat([rec([
      ...turn(0, 1000),                                                    // 鳴り始めは 1500
      { t: 5000, type: 'tool_call_start', data: { name: 'execute_sql' } }, // ★ 鳴った後・次の押下より前
      ...turnWithTools(10_000, 1200, ['search_objects']),                  // ★ ここからは次の往復
    ].sort((a, b) => a.t - b.t))]);
    // ★ 区切りを ① と別に作ると対応がずれて「ルームが遅い」に見える (#420 の見立てが外れた理由)
    expect(s.latencyByTool.find((x) => x.name === 'execute_sql')).toMatchObject({ n: 1, medianMs: 1000 });
    expect(s.latencyByTool.find((x) => x.name === 'search_objects')).toMatchObject({ n: 1, medianMs: 1200 });
    expect(s.latencyByTool.find((x) => x.name === '(道具なし)')).toBeUndefined();
  });

  test('★ 声が返らなかった往復は ① に入らないので、道具ごとの分母にも入れない', () => {
    const s = summarizeVoiceChat([rec([
      { t: 0, type: 'ptt_press' },
      { t: 500, type: 'ptt_release' },
      { t: 700, type: 'tool_call_start', data: { name: 'execute_sql' } },
      { t: 9000, type: 'session_end' },     // ★ 鳴らないまま終わった
    ])]);
    expect(s.latency.noReplyCount).toBe(1);
    expect(s.latencyByTool).toEqual([]);
  });

  test('★ 多い順に並べる (少ない道具が上に来ると読み違える)', () => {
    const s = summarizeVoiceChat([rec([
      ...turnWithTools(0, 1000, ['list_rooms']),
      ...turnWithTools(20_000, 1000, ['list_rooms']),
      ...turnWithTools(40_000, 1000, ['execute_sql']),
    ])]);
    expect(s.latencyByTool.map((x) => x.name)).toEqual(['list_rooms', 'execute_sql']);
  });
});

/**
 * ★ `--since` の日付は JST で読む。
 * ★★ `new Date('2026-09-06')` は UTC 0 時 = JST 09:00 で、**午前のセッションが黙って落ちる**。
 *   2026-09-06 の集計で実際に 8 件が 3 件になり、**残りを「現場テストの結果」と読みかけた**。
 */
describe('parseSinceJst — 日付は JST の 0 時 (#410)', () => {
  const { parseSinceJst } = require('../../src/lib/voiceChatReport.mts') as {
    parseSinceJst: (arg: string) => Date;
  };

  test('★★ 日付だけなら JST の 0 時 (= UTC 前日 15 時)', () => {
    expect(parseSinceJst('2026-09-06').toISOString()).toBe('2026-09-05T15:00:00.000Z');
  });

  test('★ 前後の空白は無視する', () => {
    expect(parseSinceJst(' 2026-09-06 ').toISOString()).toBe('2026-09-05T15:00:00.000Z');
  });

  test('★ 時刻まで書かれていれば、そのまま解釈する', () => {
    expect(parseSinceJst('2026-09-06T13:00:00+09:00').toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });

  test('★ 読めない文字列は Invalid Date (呼び出し側で弾ける)', () => {
    expect(Number.isNaN(parseSinceJst('きのう').getTime())).toBe(true);
  });
});
