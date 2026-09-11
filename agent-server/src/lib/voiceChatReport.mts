/**
 * #410 会話モードの計測ログ (`_voice-chat-logs/*.jsonl`) を集計する。
 *
 * ★ **数え方をコードに固定するための道具**である。速さを良く見せるためのものではない。
 *   これまで集計はその場で書き捨てていて、**回ごとに分母が変わっていた** ——
 *   それでは docs/08 §12.6「同じ計器で測り直す」を担保できない。
 *
 * ★★ 決めごと (docs/08 §7.1、利用者判断 2026-09-06):
 *   ```
 *   基準①  2 秒以内が 9 割
 *   計器    AnalyserNode (`ai_audio_start`) を正
 *   ```
 *   サーバイベント (`output_audio_started`) の方が中央値 134ms 速く出るが、**採らない**。
 *   実際に音が鳴り始めた瞬間の方が体感に近く、判定は厳しい側に寄せる。
 *   (§12.6 が「OpenAI のイベント名に依存しない計器にする」と書いた意図もこちら)
 *
 * ★★★ 割り込み (基準③) の分母は「**押した時に本当に鳴っていたか**」で作る。
 *   docs/08 §12.7 の教訓 —— 鳴っていない時に押した回を混ぜると、
 *   22 秒後の停止が入って中央値が壊れる。
 */

export interface VoiceEventLike { t: number; type: string; data?: unknown }
export interface VoiceChatRecord {
  session_id?: string;
  room_id?: string | null;
  user_id?: string;
  received_at?: string;
  events: VoiceEventLike[];
}

/** ★ 基準① の合格ライン (利用者判断 2026-09-06)。2 秒以内が 9 割 */
export const LATENCY_LIMIT_MS = 2000;
export const LATENCY_PASS_RATIO = 0.9;

/**
 * ★ 道具を呼ばなかった往復の見出し (#420)。
 * 「道具ごと」の表にこれを並べておかないと、比べる相手が無くて速い/遅いが言えない。
 */
export const NO_TOOL_LABEL = '(道具なし)';

/** ★ 表示の桁は 0.1ms まで。performance.now() は小数が長く、そのまま出すと読めない */
function round(x: number): number {
  return Math.round(x * 10) / 10;
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return round(s[Math.floor(s.length / 2)]);
}
function max(xs: number[]): number {
  return xs.length ? round(Math.max(...xs)) : 0;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function dataOf(e: VoiceEventLike): Record<string, unknown> {
  return (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
}

/**
 * ★ 原因が特定済みの競合か (#416、docs/08 §12.8)。
 *
 * 「割り込みで送った `response.cancel` が、モデルが**喋る速さより速く作り終えている**ために
 *  失敗する」——**割り込みが効いているときほど出る**。実測で割り込み 64 回に対して 8 件。
 *
 * ★★ 黙らせるのではなく**分けて数える**。エラーに混ぜると計器が常に鳴っている状態になり、
 *   **新しいエラーが 1 件出ても気づけない** (docs/05「静音化は原因特定の後」を満たす)。
 */
function isKnownRace(message: unknown): boolean {
  return typeof message === 'string' && message.includes('Cancellation failed');
}

export interface VoiceChatSummary {
  sessions: number;
  turns: number;
  turnsPerSession: { median: number; max: number };
  durationMin: number;
  latency: {
    n: number;
    medianMs: number;
    maxMs: number;
    withinCount: number;
    withinRatio: number;
    pass: boolean;
    /** ★ 押して離したのに、声が 1 度も鳴らなかった往復 */
    noReplyCount: number;
    overLimitMs: number[];
  };
  interrupt: { n: number; medianMs: number; maxMs: number; skippedNotPlaying: number };
  /** ★ 道具の**実行時間** (`tool_call_end` の elapsed_ms)。①とは別物 */
  tools: Array<{ name: string; n: number; medianMs: number; maxMs: number }>;
  /**
   * ★ #420: ① を「その往復で呼んだ道具」で分けたもの。道具を呼ばなかった往復は
   * `NO_TOOL_LABEL` に入り、比べる相手になる。
   *
   * ★★ 見たいのは道具の速さではなく「**その道具を呼ぶ往復は、声が返り始めるのが遅いか**」。
   * 合計だけ見ていると「ルームが遅い」に見える —— それが #420 で外した見立て。
   */
  latencyByTool: Array<{ name: string; n: number; medianMs: number; maxMs: number; overLimit: number }>;
  promote: { started: number; done: number; error: number; byStatus: Record<string, number> };
  connectionLost: number;
  serverErrors: number;
  /** ★ 原因が特定済みの競合 (docs/08 §12.8)。エラーと分けて数える (#416) */
  knownRaces: number;
  /**
   * ★ #423 門が「走っている」と思い込んだまま戻らない形の内訳。
   *
   * ★★ **この欄はまだ「直した」を意味しない。** 2026-09-05 の実測では、最後の音が鳴り終わって
   *   161.5 秒後に押した発話が断られたが、`response.created` / `response.done` を記録に
   *   残していなかったので**なぜ戻らなかったかが測れなかった**。候補と欄の対応:
   *   ```
   *   a  終わりの合図が来ない            → skippedWithNoFinish
   *   b  門が見ていない名前で終わった     → finishedButStillActive / unknownEvents
   *   c  created が二重に来た (順序入替)  → createdWhileAwaiting
   *   ```
   */
  responseGate: {
    created: number;
    finished: number;
    /** ★ 終わりの印が来たのに、門は走ったままだった (= 門が `response.done` しか見ていない) */
    finishedButStillActive: number;
    /** ★ 始まりに対する終わりの印が 1 つも来ないまま断られた回数 */
    skippedWithNoFinish: number;
    /** ★ 終わりを待っている間に、もう 1 つ始まりが来た回数 */
    createdWhileAwaiting: number;
    /** ★ 門が見ていない `response.*` の名前ごとの件数 (次に門へ足す名前がここに出る) */
    unknownEvents: Record<string, number>;
  };
}

/**
 * 計測ログを集計する。**入力は 1 セッション 1 件の記録の配列**。
 * ★ 純粋関数にしてあるのは、数え方そのものをテストで固定するため。
 */
export function summarizeVoiceChat(records: VoiceChatRecord[]): VoiceChatSummary {
  const latencies: number[] = [];
  const interrupts: number[] = [];
  const toolMs = new Map<string, number[]>();
  const turnsEach: number[] = [];
  const durations: number[] = [];
  const latencyByTool = new Map<string, number[]>();
  const promote = { started: 0, done: 0, error: 0, byStatus: {} as Record<string, number> };
  let noReply = 0;
  let skippedNotPlaying = 0;
  let connectionLost = 0;
  let serverErrors = 0;
  let knownRaces = 0;
  // ★ #423 門が戻らない形の内訳。**直す前に、どの候補なのかを数字で決めるための欄**
  const gate = {
    created: 0,
    finished: 0,
    finishedButStillActive: 0,
    skippedWithNoFinish: 0,
    createdWhileAwaiting: 0,
    unknownEvents: {} as Record<string, number>,
  };

  for (const rec of records) {
    const ev = (rec.events || []).filter((e) => e && typeof e.t === 'number' && typeof e.type === 'string');
    if (!ev.length) continue;
    durations.push((ev[ev.length - 1].t - ev[0].t) / 1000);
    let turns = 0;
    // ★ #423 始まりに対する終わりの印を待っているか。**セッションごとに数え直す**
    //   (跨いで持ち越すと、前の回の取りこぼしが次の回の断りに付く)
    let awaitingFinish = false;

    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      const d = dataOf(e);

      if (e.type === 'ptt_release') {
        turns += 1;
        // ★ ① 声が返り始めるまで。**次に押すまで**の間で最初の `ai_audio_start` を探す
        // ★★ 同じ区切りで「この往復で呼ばれた道具」も集める (#420)。
        //    区切りを別に作ると、① と道具の対応がずれて「ルームが遅い」に見える
        let hit: number | null = null;
        const names = new Set<string>();                // ★ 同じ道具を 3 回呼んでも往復は 1 つ
        for (let j = i + 1; j < ev.length; j++) {
          if (ev[j].type === 'ptt_press') break;
          if (ev[j].type === 'ai_audio_start' && hit === null) hit = ev[j].t;
          if (ev[j].type === 'tool_call_start') {
            const n = dataOf(ev[j]).name;
            names.add(typeof n === 'string' ? n : '(不明)');
          }
        }
        if (hit === null) noReply += 1;                 // ★ 返らなかった回も数える
        else {
          latencies.push(hit - e.t);
          // ★ 返らなかった往復は ① の分母に無いので、道具ごとの分母にも入れない
          const ms = hit - e.t;
          for (const n of names.size ? names : [NO_TOOL_LABEL]) {
            latencyByTool.set(n, [...(latencyByTool.get(n) || []), ms]);
          }
        }
        continue;
      }

      if (e.type === 'interrupt') {
        // ★★ 鳴っていない時に押した回は分母から外す (§12.7)
        if (d.was_playing !== true) { skippedNotPlaying += 1; continue; }
        for (let j = i + 1; j < ev.length; j++) {
          if (ev[j].type === 'output_audio_stopped') { interrupts.push(ev[j].t - e.t); break; }
        }
        continue;
      }

      if (e.type === 'tool_call_end') {
        const name = typeof d.name === 'string' ? d.name : '(不明)';
        const ms = num(d.elapsed_ms);
        if (ms !== null) toolMs.set(name, [...(toolMs.get(name) || []), ms]);
        continue;
      }

      if (e.type === 'promote_start') promote.started += 1;
      else if (e.type === 'promote_done') promote.done += 1;
      else if (e.type === 'promote_error') {
        promote.error += 1;
        // ★ サーバが断ったのか、そもそも届かなかったのか (#408)。
        //   ★★ status のキーが無い記録は **#408 より前のもの**で、どちらか分からない。
        //   「届かず」に混ぜると、直したはずの区別が集計で消える。
        const key = !('status' in d) ? '不明 (記録が古い)'
          : num(d.status) === null ? '届かず'
          : String(d.status);
        promote.byStatus[key] = (promote.byStatus[key] || 0) + 1;
      } else if (e.type === 'connection_lost') connectionLost += 1;
      else if (e.type === 'server_error') {
        if (isKnownRace(d.message)) knownRaces += 1;
        else serverErrors += 1;
      }

      // ★ #423 門が「走っている」と思い込んだまま戻らない形を**分けて**数える。
      //   合計 1 つにすると 3 つの候補が埋もれる (#421 で 4 件が 3 つの別形だった、と同じ型)。
      if (e.type === 'response_lifecycle') {
        if (d.kind === 'created') {
          gate.created += 1;
          // ★ 候補 c: 終わりを待っている間に、もう 1 つ始まりが来た
          if (awaitingFinish) gate.createdWhileAwaiting += 1;
          awaitingFinish = true;
        } else {
          if (d.kind === 'finished') {
            gate.finished += 1;
            // ★ 候補 b-i: 終わりの印が来たのに門は走ったまま = 門が見ていない名前で終わった
            if (d.active === true) gate.finishedButStillActive += 1;
          } else {
            // ★ 候補 b-ii: 見たことのない名前。**名前のまま残す** ——
            //   件数だけにすると、次に門へ何を足すかを決められない
            const name = typeof d.event === 'string' ? d.event : '(名前なし)';
            gate.unknownEvents[name] = (gate.unknownEvents[name] || 0) + 1;
          }
          awaitingFinish = false;
        }
      } else if (e.type === 'response_create_skipped' && d.why === 'responding' && awaitingFinish) {
        // ★ 候補 a: 終わりの印が 1 つも来ないまま断られた (2026-09-05 の 161 秒の形)
        gate.skippedWithNoFinish += 1;
      }
    }
    turnsEach.push(turns);
  }

  const within = latencies.filter((x) => x <= LATENCY_LIMIT_MS).length;
  return {
    sessions: records.filter((r) => (r.events || []).length).length,
    turns: turnsEach.reduce((a, b) => a + b, 0),
    turnsPerSession: { median: median(turnsEach), max: max(turnsEach) },
    durationMin: Math.round(durations.reduce((a, b) => a + b, 0) / 60 * 10) / 10,
    latency: {
      n: latencies.length,
      medianMs: median(latencies),
      maxMs: max(latencies),
      withinCount: within,
      withinRatio: latencies.length ? within / latencies.length : 0,
      // ★ 標本が無いときに「合格」と言わない
      pass: latencies.length > 0 && within / latencies.length >= LATENCY_PASS_RATIO,
      noReplyCount: noReply,
      overLimitMs: latencies.filter((x) => x > LATENCY_LIMIT_MS).sort((a, b) => b - a),
    },
    interrupt: {
      n: interrupts.length,
      medianMs: median(interrupts),
      maxMs: max(interrupts),
      skippedNotPlaying,
    },
    tools: [...toolMs.entries()]
      .map(([name, xs]) => ({ name, n: xs.length, medianMs: median(xs), maxMs: max(xs) }))
      .sort((a, b) => b.n - a.n),
    // ★ #420: ① を「その往復で呼んだ道具」で分ける。道具の**実行時間** (上の tools) とは別物で、
    //   見たいのは「その道具を呼ぶ往復は、声が返り始めるのが遅いか」。
    latencyByTool: [...latencyByTool.entries()]
      .map(([name, xs]) => ({
        name,
        n: xs.length,
        medianMs: median(xs),
        maxMs: max(xs),
        overLimit: xs.filter((x) => x > LATENCY_LIMIT_MS).length,
      }))
      .sort((a, b) => b.n - a.n),
    promote,
    connectionLost,
    serverErrors,
    knownRaces,
    responseGate: gate,
  };
}

/** 集計を docs/08 §2.2 と同じ段分けの表にする (§12.6「同じ計器で測り直す」の担保) */
export function formatVoiceChatReport(s: VoiceChatSummary, asOf: string): string {
  const sec = (ms: number) => (ms / 1000).toFixed(2);
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  const g = s.responseGate;
  const lines = [
    `会話モード 計測まとめ (as of ${asOf})`,
    `母集団  ${s.sessions} セッション / ${s.turns} 往復 / 通話 ${s.durationMin} 分`,
    '',
    '| 基準 | 結果 | 実測 |',
    '|---|---|---|',
    `| ① 2 秒以内 (9 割) | ${s.latency.pass ? '達成' : '未達'} | n=${s.latency.n} 中央値 ${sec(s.latency.medianMs)}s / 最大 ${sec(s.latency.maxMs)}s / 2 秒以内 ${s.latency.withinCount} (${pct(s.latency.withinRatio)}) |`,
    `| ② 3 往復続く | ${s.turnsPerSession.max >= 3 ? '達成' : '未達'} | 1 セッション 中央値 ${s.turnsPerSession.median} 往復 / 最長 ${s.turnsPerSession.max} 往復 |`,
    `| ③ 割り込める | ${s.interrupt.n ? '達成' : '標本なし'} | n=${s.interrupt.n} 中央値 ${s.interrupt.medianMs}ms / 最大 ${s.interrupt.maxMs}ms (鳴っていない時に押した ${s.interrupt.skippedNotPlaying} 回は分母から除外) |`,
    `| ④ さっきの話 | ${s.tools.length ? '道具は動いている (通じたかは人が読む)' : '道具の呼び出しなし'} | ${s.tools.map((t) => `${t.name} n=${t.n} 中央値 ${t.medianMs}ms 最大 ${t.maxMs}ms`).join(' / ') || '—'} |`,
    '',
    `昇格   ${s.promote.started} 回押して 成功 ${s.promote.done} / 失敗 ${s.promote.error}`
      + (s.promote.error ? ` (内訳 ${Object.entries(s.promote.byStatus).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''),
    `切断   ${s.connectionLost} 件 / サーバのエラー ${s.serverErrors} 件`
      + (s.knownRaces ? ` (別に、原因特定済みの競合が ${s.knownRaces} 件。docs/08 §12.8)` : ''),
    `返らず ${s.latency.noReplyCount} 往復 (押して離したのに声が鳴らなかった)`,
    // ★ #423 門の内訳。★★ 記録が無い回を「0 件」と書かない ——
    //   計器より前のログは「分からない」であって「問題が無かった」ではない
    g.created || g.finished
      ? `門     始まり ${g.created} / 終わり ${g.finished}`
        + ` (終わったのに走ったまま ${g.finishedButStillActive}`
        + ` / 終わりが来ないまま断られた ${g.skippedWithNoFinish}`
        + ` / 二重の始まり ${g.createdWhileAwaiting})`
      : '門     記録なし (#423 の計器より前のログ。★ 0 件ではなく「分からない」)',
  ];
  // ★ 門が見ていない名前は**名前のまま**出す。次に門へ足す名前がここに出る (候補 b-ii)
  if (Object.keys(g.unknownEvents).length) {
    lines.push('', `★ 門が見ていない response.* : ${Object.entries(g.unknownEvents).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  // ★ #420: ① を「その往復で呼んだ道具」で分ける。合計だけ見ていると
  //   「ルームが遅い」に見える (実測: execute_sql の往復だけ中央値が 0.6 秒 遅い)
  if (s.latencyByTool.length > 1) {
    lines.push('', '★ ① を「その往復で呼んだ道具」で分ける (道具の実行時間ではなく、声が返り始めるまで)');
    lines.push('', '| その往復で呼んだ道具 | n | 中央値 | 最大 | 2 秒超 |', '|---|---|---|---|---|');
    for (const t of s.latencyByTool) {
      lines.push(`| ${t.name} | ${t.n} | ${sec(t.medianMs)}s | ${sec(t.maxMs)}s | ${t.overLimit} |`);
    }
  }
  if (s.latency.overLimitMs.length) {
    lines.push('', `★ 2 秒を超えた回 (遅い順、秒): ${s.latency.overLimitMs.map((x) => sec(x)).join(', ')}`);
  }
  // ★ 標本の弱さを毎回書く (docs/08 §2.3 / §7-5)。数字だけを持ち出せない形にしておく
  lines.push('', '★ この数字は「基準」ではない。どこで・誰が・いつ測ったかを添えて読むこと (docs/08 §2.3 / §12.7)。');
  return lines.join('\n');
}

/**
 * ★ `--since 2026-09-06` のような日付を **JST の 0 時**として読む (#410 の道具の穴)。
 *
 * ★★ `new Date('2026-09-06')` は **UTC の 0 時 = JST 09:00** になる。
 *   そのまま使うと **午前中のセッションが黙って落ちる** —— 実際に 2026-09-06 の集計で
 *   8 件のうち 5 件が消え、**残った 3 件を「現場テストの結果」と読みかけた**。
 *   このプロジェクトの時刻はすべて JST ([[feedback_report_timestamp_jst]] と同じ約束)。
 *
 * ★ 時刻まで書かれている場合 (`2026-09-06T13:00`) はそのまま解釈する。
 */
export function parseSinceJst(arg: string): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(arg.trim());
  return new Date(dateOnly ? `${arg.trim()}T00:00:00+09:00` : arg);
}
