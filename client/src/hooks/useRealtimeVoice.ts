import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { holdAudio, releaseAudio } from '../utils/audioExclusive';
import { createResponseGate } from '../utils/realtimeResponseGate';
import { createSpeechGate, createSpeakingView } from '../utils/speechGate';
import { readTranscriptEvent } from '../utils/realtimeTranscript';

/**
 * #405 Realtime 音声会話 (docs/08 §12)。
 *
 * ★ 音声はこことサーバの間を通らない。**ブラウザ ↔ OpenAI の直通** (WebRTC)。
 *   自社サーバが担うのは (1) 使い捨てトークンの発行 (2) 道具の実行 の 2 つだけ。
 *
 * ★★ 押して話す (docs/08 §5.1)。`turn_detection: null` をサーバ側の session config に入れてあるので、
 *   話し終わりは**人が決める**。離したときに commit + response.create を送る。
 *   AI が喋っている最中に押したら response.cancel を送って、こちらでも即座に消音する。
 *   → 成立の基準③ (割り込み) を、モデルの推定に頼らず決定的に満たすための形。
 *
 * ★ 計測 (docs/08 §12.6): 応答の立ち上がりは **AnalyserNode で自前検知**する。
 *   OpenAI のイベント名に依存する計器にすると、名前が変わった日に黙って測れなくなる。
 */

export type VoiceState = 'idle' | 'requesting' | 'connecting' | 'live' | 'closing' | 'error';

export interface VoiceEvent { t: number; type: string; data?: unknown }

interface RealtimeVoice {
  state: VoiceState;
  error: string | null;
  /** 押している間だけ true */
  isTalking: boolean;
  /** AI が喋っているか (AnalyserNode で判定) */
  isAiSpeaking: boolean;
  /** 何往復したか (基準②) */
  turns: number;
  /** 道具の実行中か */
  isToolRunning: boolean;
  /** ★ 接続が不安定 (disconnected)。戻ることがあるので落とさない (#409) */
  isUnstable: boolean;
  /** ★★ 直前の発話が送られなかった (#421)。次に押したら消える */
  wasSkipped: boolean;
  /** ★ 直近の AI の発言 (昇格の対象。無ければ null) */
  lastReply: string | null;
  /** ★ 昇格の状態 */
  promoteState: 'idle' | 'sending' | 'done' | 'error';
  promoteError: string | null;
  /** ★ 直近の発言を、いま居るルームへ残す (docs/08 §1.2.2 / R3) */
  promote: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
  pressTalk: () => void;
  releaseTalk: () => void;
}

/**
 * AI 音声の有音判定 (docs/08 §12.6)。
 * ★ 2026-09-05 実測で 8 往復に 301 回切り替わった。しきい値だけで判定していたので、
 *   言葉の切れ目を毎回「終わり」と拾っていた。→ 保持時間つきの門に変えた (speechGate.ts)。
 */
const SPEECH_GATE = { onThreshold: 0.012, offThreshold: 0.006, holdMs: 400 };

/**
 * ★ 上限 (#414、docs/08 §11 の未決)。**閉じ忘れたまま繋がったままにしない**。
 *   課金より先に、**マイクを掴んだまま放置される**方が問題になりうる。
 * ★★ 30 分はサーバの台帳 TTL (`SESSION_TTL_MS`) と同じ値。揃っていないと
 *   「台帳だけ先に消えて、音声は繋がったまま」という分かりにくい形になる。
 */
const IDLE_LIMIT_MS = 5 * 60_000;
const SESSION_LIMIT_MS = 30 * 60_000;
const LIMIT_CHECK_MS = 10_000;

export function useRealtimeVoice(roomId: string): RealtimeVoice {
  const [state, setState] = useState<VoiceState>('idle');
  /** ★ #429 この画面で何回 start したか (1 = 初回、2 以上 = 繋ぎ直し) */
  const attemptRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [isTalking, setIsTalking] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [turns, setTurns] = useState(0);
  const [isToolRunning, setIsToolRunning] = useState(false);
  // ★ 接続が不安定 (#409)。`disconnected` は戻ることがあるので、落とさずに表示だけ変える
  const [isUnstable, setIsUnstable] = useState(false);
  // ★★ 直前の発話が送られなかった (#421)。押して離したのに応答を作れなかった状態。
  //   実測 4 件のうち 2 件は、この直後に利用者が会話を閉じている (何も返らなかったため)
  const [wasSkipped, setWasSkipped] = useState(false);
  // ★ 昇格 (R3)。直近の AI 発言だけを対象にする。人の発言は今回入れない (docs/08 §12)
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [promoteState, setPromoteState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStreamTrack | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string>('');
  const eventsRef = useRef<VoiceEvent[]>([]);
  const speakingRef = useRef(false);
  // ★ 応答の二重生成と、立ち上がり検知のバタつきを塞ぐ門 (どちらも 2026-09-05 の実測で出た)
  const respGateRef = useRef(createResponseGate());
  const speechGateRef = useRef(createSpeechGate(SPEECH_GATE));
  // ★ 表示のちらつきを止める門 (#415)。★★ 立ち上がりの時刻は AnalyserNode のまま
  const speakingViewRef = useRef(createSpeakingView());
  // ★ 割り込みで即座に黙るために、受信トラックを持っておく (element の mute では残りが後で鳴る)
  const remoteTrackRef = useRef<MediaStreamTrack | null>(null);
  // ★ 自分で閉じたのか、切れたのか (#409)。pc.close() でも `closed` が飛ぶので、これで区別する
  const closingRef = useRef(false);
  // ★ 音声を掴んでいる間の名前 (#413)。掴んだ本人だけが離せる
  const holdIdRef = useRef<string>('');
  // ★ 上限の見張り (#414)。最後に声が出た時刻 / 開いた時刻
  const lastSpokeRef = useRef(0);
  const startedAtRef = useRef(0);
  const limitTimerRef = useRef<number | null>(null);

  const mark = useCallback((type: string, data?: unknown) => {
    eventsRef.current.push({ t: performance.now(), type, data });
  }, []);

  const send = useCallback((msg: unknown) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(msg));
  }, []);

  /** AI 音声の立ち上がり/収まりを自前で見る。基準①③の計器はこれ */
  const watchLevel = useCallback((stream: MediaStream) => {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      // ★ 門の判定と「配信中か」を合わせて見せ方を決める (#415)。
      //   応答の途中の切れ目 (400ms を超えることがある) で「終わった」と言わないため。
      //   ★★ 立ち上がりの印は門が鳴ったときだけ = 基準① の計器は AnalyserNode のまま (#410)。
      const gateSpeaking = speechGateRef.current.feed(rms, performance.now());
      const view = speakingViewRef.current.update(gateSpeaking, respGateRef.current.isOutputAudioPlaying());
      if (view.mark) mark(view.mark === 'start' ? 'ai_audio_start' : 'ai_audio_end');
      if (view.shown !== speakingRef.current) {
        speakingRef.current = view.shown;
        setIsAiSpeaking(view.shown);
      }
      // ★ AI が喋っている間は「無操作」ではない (#414)
      if (view.shown) lastSpokeRef.current = Date.now();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [mark]);

  /** モデルからの道具の要求を、サーバに投げ返して実行してもらう */
  const handleToolCall = useCallback(async (callId: string, name: string, args: string) => {
    setIsToolRunning(true);
    respGateRef.current.beginTool();
    mark('tool_call_start', { name });
    let output: string;
    try {
      const r = await api.voiceChatToolCall(sessionIdRef.current, callId, name, args);
      output = r.output;
      mark('tool_call_end', { name, elapsed_ms: r.elapsed_ms });
    } catch (e) {
      output = `道具の実行に失敗しました: ${e instanceof Error ? e.message : String(e)}`;
      mark('tool_call_error', { name });
    }
    // ★ 結果は必ず返す。★★ ただし応答を作るのは **最後の 1 つが終わったときだけ**。
    //   1 ターンで道具が 2 つ並行に呼ばれると、それぞれが response.create を送って
    //   2 通目が弾かれる (2026-09-05 実測で 1 件)。
    send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } });
    const isLast = respGateRef.current.endTool();
    if (isLast) {
      setIsToolRunning(false);
      send({ type: 'response.create' });
    } else {
      mark('tool_call_batched', { name });
    }
  }, [mark, send]);

  const onServerEvent = useCallback((raw: string) => {
    let msg: { type?: string; name?: string; call_id?: string; arguments?: string; transcript?: string; item?: { id?: string }; error?: { message?: string } };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type) respGateRef.current.onServerEvent(msg.type, msg);
    // ★ 出力音声の生死は計器になる (AnalyserNode は手元のバッファを捨てても鳴って見えるので、
    //   基準③ の判定にはこちらを使う)。★★ track を戻すのは「離したとき」ではなく
    //   「次の音声が始まったとき」—— 離した時に戻すと、古い応答の残りが鳴る。
    if (msg.type && msg.type.startsWith('output_audio_buffer.')) {
      const playing = respGateRef.current.isOutputAudioPlaying();
      if (playing && remoteTrackRef.current) remoteTrackRef.current.enabled = true;
      mark(playing ? 'output_audio_started' : 'output_audio_stopped', { event: msg.type });
    }

    if (msg.type === 'response.function_call_arguments.done' && msg.call_id && msg.name) {
      void handleToolCall(msg.call_id, msg.name, msg.arguments || '{}');
      return;
    }
    // transcript は残す唯一のもの (docs/08 §7-4 訂正: 音声原本は存在しない)
    // ★ どちら側かの判定は readTranscriptEvent に 1 か所だけ置く (#412)。
    //   入力側と出力側でイベント名が違い、**片方だけ見ていて人の発話が 1 件も残っていなかった**。
    const line = readTranscriptEvent(msg);
    if (line) {
      mark('transcript', { who: line.who, text: line.text });
      // ★ 昇格の対象は AI の発言だけ (docs/08 §12.10)。新しい発言が来たら「残す」は押せる状態に戻る
      if (line.who === 'ai') {
        setLastReply(line.text);
        setPromoteState('idle');
        setPromoteError(null);
      }
      return;
    }
    if (msg.type === 'error') {
      mark('server_error', { message: msg.error?.message });
    }
  }, [handleToolCall, mark]);

  /**
   * ★ 計測をサーバへ送って、手元を空にする (#409)。
   * これまで送るのは `stop()` (= 閉じるを押したとき) だけだった。
   * **切れたあと画面を離れると、切断の記録ごと消えていた** —— 一番知りたい回だけ残らない。
   */
  const flushLog = useCallback(() => {
    if (!sessionIdRef.current || !eventsRef.current.length) return;
    void api.voiceChatLog(sessionIdRef.current, eventsRef.current);
    eventsRef.current = [];
  }, []);

  /**
   * ★ 接続が死んだ (#409)。会話は続けられないので、**黙らずに画面へ出して**片付ける。
   * docs/08 §7-2「無言で待たせない」——「考えている」と「壊れた」が区別できないのが一番まずい。
   */
  /** 手元を片付ける (切断でも上限でも同じ)。★ マイクのランプを消すところまで含む */
  const teardown = useCallback(() => {
    if (limitTimerRef.current !== null) clearInterval(limitTimerRef.current);
    limitTimerRef.current = null;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());   // ★ マイクのランプを消す
    streamRef.current = null;
    micRef.current = null;
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    if (audioElRef.current) { audioElRef.current.srcObject = null; audioElRef.current = null; }
    remoteTrackRef.current = null;

    setIsUnstable(false);
    setIsTalking(false);
    setIsAiSpeaking(false);
    speakingRef.current = false;
    // ★ 掴みを離す (#413)。離さないと、以後この端末で読み上げが 1 度も鳴らなくなる
    releaseAudio(holdIdRef.current);
    holdIdRef.current = '';
  }, []);

  const failConnection = useCallback((why: string) => {
    if (closingRef.current || !pcRef.current) return;   // 自分で閉じた分は切断ではない
    closingRef.current = true;
    mark('connection_lost', { state: why });
    teardown();
    setState('error');
    setError('接続が切れました。もう一度開いてください');
    flushLog();
  }, [mark, flushLog, teardown]);

  /**
   * ★ 上限で自分から閉じる (#414)。**黙って切らない** —— 理由を画面に出す (docs/08 §7-2)。
   * ★★ 足りなければ開き直せばよい。会話の文脈は残らないが、
   *   残すべきものは昇格で残す設計 (docs/08 §1.2.2) なので、それでよい。
   */
  const autoClose = useCallback((reason: 'idle' | 'max') => {
    if (closingRef.current || !pcRef.current) return;
    closingRef.current = true;
    mark('auto_closed', { reason });
    teardown();
    setState('error');
    setError(reason === 'idle'
      ? 'しばらく話していないので、会話を終わりました (もう一度開けます)'
      : '30 分たったので、会話を終わりました (もう一度開けます)');
    flushLog();
  }, [mark, flushLog, teardown]);

  const stop = useCallback(() => {
    closingRef.current = true;
    setState('closing');
    mark('session_end');
    // ★ 片付けは切断・上限と同じ手順 (掴みを離すのもこの中。Wake Lock はそこで解ける)
    teardown();
    flushLog();
    eventsRef.current = [];
    sessionIdRef.current = '';
    respGateRef.current.reset();
    speechGateRef.current.reset();
    speakingViewRef.current.reset();
    speakingRef.current = false;
    setIsAiSpeaking(false);
    setIsTalking(false);
    setTurns(0);
    setLastReply(null);
    setPromoteState('idle');
    setPromoteError(null);
    setState('idle');
  }, [mark, flushLog, teardown]);

  const start = useCallback(async () => {
    setError(null);
    closingRef.current = false;
    eventsRef.current = [];
    setState('requesting');
    // ★ #429 何回目の開始かを残す。★★ 初回と繋ぎ直しが同じ印だと
    //   「やり直した回数」が測れない (= 上限や切断が現場でどれだけ邪魔しているかが分からない)。
    //   ★ 記録は新しいセッションの側に乗るので、そのセッションが終わるときに送られる。
    attemptRef.current += 1;
    mark('session_start_request', { attempt: attemptRef.current, reconnect: attemptRef.current > 1 });

    try {
      // 1. 使い捨てトークンをもらう (★ ここで MCP が温まるので、初回は数十秒かかりうる)
      const session = await api.createVoiceChatSession(roomId);
      sessionIdRef.current = session.session_id;
      mark('token_ready');
      setState('connecting');

      // 2. マイク。取得の作法は MessageInput.handleMicClick に合わせてある
      if (!window.isSecureContext) throw new Error('HTTPS でないとマイクを使えません');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      micRef.current = track;
      track.enabled = false;   // ★ 押すまで送らない

      // 3. WebRTC
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.addTrack(track, stream);

      pc.ontrack = (ev) => {
        remoteTrackRef.current = ev.track;
        const el = new Audio();
        el.autoplay = true;
        el.srcObject = ev.streams[0];
        audioElRef.current = el;
        void el.play().catch(() => mark('autoplay_blocked'));
        watchLevel(ev.streams[0]);
      };

      // ★ 接続の生死を見る (#409)。これが無いと、切れても画面は「押しながら話してください」のまま。
      //   ★★ `disconnected` は戻ることがあるので落とさない —— 落とすと、直る回まで会話を切ってしまう。
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        mark('connection_state', { state: st });
        if (st === 'failed' || st === 'closed') failConnection(st);
        else if (st === 'disconnected') setIsUnstable(true);
        else if (st === 'connected') setIsUnstable(false);
      };

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.onmessage = (ev) => onServerEvent(ev.data as string);
      // ★ 道具の口が閉じたら、音が生きていても会話は続けられない (押しても送れない)
      dc.onclose = () => failConnection('datachannel_closed');
      dc.onerror = () => mark('datachannel_error');

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${session.client_secret}`, 'Content-Type': 'application/sdp' },
      });
      if (!sdpRes.ok) throw new Error(`OpenAI に接続できませんでした (${sdpRes.status})`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });

      mark('connected');
      // ★★ 「知らせる」ではなく「掴む」(#413)。会話は 1 回の再生ではなく続くセッションなので、
      //   あとから来た自動の読み上げに譲って止まるのは逆 —— **向こうが始まらない**。
      holdIdRef.current = `voice-chat:${session.session_id}`;
      holdAudio(holdIdRef.current);

      // ★ 上限の見張り (#414)。閉じ忘れたまま繋がったままにしない
      startedAtRef.current = Date.now();
      lastSpokeRef.current = Date.now();
      limitTimerRef.current = window.setInterval(() => {
        const now = Date.now();
        if (now - startedAtRef.current >= SESSION_LIMIT_MS) autoClose('max');
        else if (now - lastSpokeRef.current >= IDLE_LIMIT_MS) autoClose('idle');
      }, LIMIT_CHECK_MS);

      setState('live');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      mark('start_error', { message });
      setError(
        message.includes('NotAllowedError') || message.includes('Permission')
          ? 'マイクの使用が許可されていません'
          : message,
      );
      setState('error');
      streamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      pcRef.current = null;
    }
  }, [roomId, mark, onServerEvent, watchLevel, failConnection, autoClose]);

  /**
   * ★ 昇格 (R3、docs/08 §1.2.2)。行き先は渡さない —— 会話を開いたルームへ残る。
   * ★★ 失敗したら黙らない。**残ったと思って残っていない**のが一番まずい。
   */
  const promote = useCallback(async () => {
    if (!lastReply || !sessionIdRef.current) return;
    setPromoteState('sending');
    setPromoteError(null);
    mark('promote_start', { chars: lastReply.length });
    try {
      await api.voiceChatPromote(sessionIdRef.current, lastReply);
      setPromoteState('done');
      mark('promote_done');
    } catch (e) {
      // ★ status が取れるかで、失敗の意味が違う (#408):
      //   有り = サーバが断った (文言はサーバのものをそのまま出す)
      //   無し = そもそも届いていない (通信 / proxy)。**押した本人には同じ「失敗」に見えるので、
      //          届いていないことを文言で分ける** —— 実測の 3 件中 2 件がこちらだった
      const status = (e as { status?: number }).status;
      const message = e instanceof Error ? e.message : String(e);
      setPromoteState('error');
      setPromoteError(status === undefined
        ? `${message} (サーバに届いていません。通信を確かめて、もう一度押してください)`
        : message);
      // ★ undefined は JSON.stringify で**キーごと消える**ので null で残す (#410)。
      //   消えると「届かなかった」と「記録が古い」が集計で同じ顔になる
      mark('promote_error', { message, status: status ?? null });
    }
  }, [lastReply, mark]);

  const pressTalk = useCallback(() => {
    if (state !== 'live') return;
    // ★ 基準③ 割り込み。**公式の手順は 2 段** (2026-09-05、調べて分かった):
    //     1. response.cancel            まだ作っていれば止める
    //     2. output_audio_buffer.clear  ★★ **まだ再生していない音声を消す。WebRTC 専用**
    //   当初 conversation.item.truncate を送っていたが、あれは**サーバの文脈しか直さない**。
    //   同じ症状の報告があり「制御系と音声系が切り離されていて、truncate が成功しても
    //   配信は止まらない」と説明されていた。実測でも 505〜6658ms 鳴り続けていた。
    //   ★ clear は「相手が実際に聞いた分」をサーバ側の再生位置で切るので、
    //     こちらが AnalyserNode で推定するより正確 (= 手で audio_end_ms を出さなくてよい)。
    if (speakingRef.current || respGateRef.current.isOutputAudioPlaying()) {
      const gate = respGateRef.current;
      if (gate.isResponding()) send({ type: 'response.cancel' });
      send({ type: 'output_audio_buffer.clear' });
      // ★ 手元は **track を止める** (element の mute だと止まったように見えて残りが後で鳴る)。
      //   clear の往復を待たずに黙るための保険で、次の音声が始まったら戻す。
      if (remoteTrackRef.current) remoteTrackRef.current.enabled = false;
      mark('interrupt', { was_responding: gate.isResponding(), was_playing: gate.isOutputAudioPlaying() });
    }
    if (micRef.current) micRef.current.enabled = true;
    setWasSkipped(false);      // ★ 話し始めたら前の知らせは消す (#421)
    setIsTalking(true);
    lastSpokeRef.current = Date.now();      // ★ 話している間は「無操作」ではない (#414)
    mark('ptt_press');
  }, [state, send, mark]);

  const releaseTalk = useCallback(() => {
    if (!isTalking) return;
    if (micRef.current) micRef.current.enabled = false;
    setIsTalking(false);
    // ★ 話し終わりは人が決める。ここが基準① の起点
    lastSpokeRef.current = Date.now();
    mark('ptt_release');
    send({ type: 'input_audio_buffer.commit' });
    // ★ 応答が走っている / 道具が動いている間は作らない (上と同じ理由)
    const gate = respGateRef.current;
    if (gate.canCreate()) {
      send({ type: 'response.create' });
      setWasSkipped(false);
    } else {
      // ★★ #421 黙って捨てない。**記録するだけでは画面に出ない** (#409 と同じ型)。
      //   理由も残す —— 実測 4 件は 3 つの別々の形で、合計だけでは分けられなかった。
      mark('response_create_skipped', {
        why: gate.whyCannotCreate(),
        pending_tools: gate.pendingTools(),
        playing: gate.isOutputAudioPlaying(),
      });
      setWasSkipped(true);
    }
    setTurns((n) => n + 1);
  }, [isTalking, send, mark]);

  // 画面を離れたら必ず切る (音声の常時接続は作らない — docs/08 §10)
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (limitTimerRef.current !== null) clearInterval(limitTimerRef.current);
  }, []);

  return { state, error, isTalking, isAiSpeaking, turns, isToolRunning, isUnstable, wasSkipped, lastReply, promoteState, promoteError, promote, start, stop, pressTalk, releaseTalk };
}
