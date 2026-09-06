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
  tools: Array<{ name: string; n: number; medianMs: number; maxMs: number }>;
  promote: { started: number; done: number; error: number; byStatus: Record<string, number> };
  connectionLost: number;
  serverErrors: number;
  /** ★ 原因が特定済みの競合 (docs/08 §12.8)。エラーと分けて数える (#416) */
  knownRaces: number;
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
  const promote = { started: 0, done: 0, error: 0, byStatus: {} as Record<string, number> };
  let noReply = 0;
  let skippedNotPlaying = 0;
  let connectionLost = 0;
  let serverErrors = 0;
  let knownRaces = 0;

  for (const rec of records) {
    const ev = (rec.events || []).filter((e) => e && typeof e.t === 'number' && typeof e.type === 'string');
    if (!ev.length) continue;
    durations.push((ev[ev.length - 1].t - ev[0].t) / 1000);
    let turns = 0;

    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      const d = dataOf(e);

      if (e.type === 'ptt_release') {
        turns += 1;
        // ★ ① 声が返り始めるまで。**次に押すまで**の間で最初の `ai_audio_start` を探す
        let hit: number | null = null;
        for (let j = i + 1; j < ev.length; j++) {
          if (ev[j].type === 'ptt_press') break;
          if (ev[j].type === 'ai_audio_start') { hit = ev[j].t; break; }
        }
        if (hit === null) noReply += 1;                 // ★ 返らなかった回も数える
        else latencies.push(hit - e.t);
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
    promote,
    connectionLost,
    serverErrors,
    knownRaces,
  };
}

/** 集計を docs/08 §2.2 と同じ段分けの表にする (§12.6「同じ計器で測り直す」の担保) */
export function formatVoiceChatReport(s: VoiceChatSummary, asOf: string): string {
  const sec = (ms: number) => (ms / 1000).toFixed(2);
  const pct = (r: number) => `${Math.round(r * 100)}%`;
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
  ];
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
