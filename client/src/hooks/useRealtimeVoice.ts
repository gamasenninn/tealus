import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { notifyAudioStarted, notifyAudioStopped } from '../utils/audioExclusive';
import { createResponseGate } from '../utils/realtimeResponseGate';
import { createSpeechGate } from '../utils/speechGate';

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

export function useRealtimeVoice(roomId: string): RealtimeVoice {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isTalking, setIsTalking] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [turns, setTurns] = useState(0);
  const [isToolRunning, setIsToolRunning] = useState(false);

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
  // ★ 割り込みで即座に黙るために、受信トラックを持っておく (element の mute では残りが後で鳴る)
  const remoteTrackRef = useRef<MediaStreamTrack | null>(null);

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
      const speaking = speechGateRef.current.feed(rms, performance.now());
      if (speaking !== speakingRef.current) {
        speakingRef.current = speaking;
        setIsAiSpeaking(speaking);
        mark(speaking ? 'ai_audio_start' : 'ai_audio_end');
      }
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
    if (msg.type && msg.type.endsWith('transcript.done') && msg.transcript) {
      mark('transcript', { who: msg.type.includes('input_audio') ? 'user' : 'ai', text: msg.transcript });
      return;
    }
    if (msg.type === 'error') {
      mark('server_error', { message: msg.error?.message });
    }
  }, [handleToolCall, mark]);

  const stop = useCallback(() => {
    setState('closing');
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    micRef.current = null;
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    if (audioElRef.current) { audioElRef.current.srcObject = null; audioElRef.current = null; }
    remoteTrackRef.current = null;

    mark('session_end');
    // ★ 自分の意思で閉じたときだけ通知する (Wake Lock を離す合図)
    notifyAudioStopped();
    if (sessionIdRef.current && eventsRef.current.length) {
      void api.voiceChatLog(sessionIdRef.current, eventsRef.current);
    }
    eventsRef.current = [];
    sessionIdRef.current = '';
    respGateRef.current.reset();
    speechGateRef.current.reset();
    speakingRef.current = false;
    setIsAiSpeaking(false);
    setIsTalking(false);
    setTurns(0);
    setState('idle');
  }, [mark]);

  const start = useCallback(async () => {
    setError(null);
    eventsRef.current = [];
    setState('requesting');
    mark('session_start_request');

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

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.onmessage = (ev) => onServerEvent(ev.data as string);

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
      notifyAudioStarted(`voice-chat:${session.session_id}`);
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
  }, [roomId, mark, onServerEvent, watchLevel]);

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
    setIsTalking(true);
    mark('ptt_press');
  }, [state, send, mark]);

  const releaseTalk = useCallback(() => {
    if (!isTalking) return;
    if (micRef.current) micRef.current.enabled = false;
    setIsTalking(false);
    // ★ 話し終わりは人が決める。ここが基準① の起点
    mark('ptt_release');
    send({ type: 'input_audio_buffer.commit' });
    // ★ 応答が走っている / 道具が動いている間は作らない (上と同じ理由)
    if (respGateRef.current.canCreate()) {
      send({ type: 'response.create' });
    } else {
      mark('response_create_skipped');
    }
    setTurns((n) => n + 1);
  }, [isTalking, send, mark]);

  // 画面を離れたら必ず切る (音声の常時接続は作らない — docs/08 §10)
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  return { state, error, isTalking, isAiSpeaking, turns, isToolRunning, start, stop, pressTalk, releaseTalk };
}
