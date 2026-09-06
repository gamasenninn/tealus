import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #405 Realtime 音声会話の専用画面 (docs/08 §12)。
 *
 * ★ ここで固定するのは **状態が画面に出ること** と **同時再生の規約に乗ること** の 2 つ。
 *   前者は docs/08 §7-2「無言で待たせない」——「考えている」と「壊れた」が
 *   区別できないのが一番まずい、という条件から来ている。
 *
 * ★★ **テストで固定しないもの** (docs/08 §12.5。実機でしか分からない):
 *   OpenAI への WebRTC 疎通 / 応答までの実レイテンシ (基準①) / 押して話すの会話感 /
 *   割り込みの体感 / 日本語音声の品質 / iOS PWA のマイクと autoplay。
 *   ここが通っても「成立した」とは言えない。判定は実機の計測 (§12.6)。
 */

const createSession = vi.fn();
const voiceChatLog = vi.fn().mockResolvedValue({ ok: true });
const promoteMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../../src/services/api', () => ({
  api: {
    createVoiceChatSession: (...a: unknown[]) => createSession(...a),
    voiceChatToolCall: vi.fn(),
    voiceChatLog: (...a: unknown[]) => voiceChatLog(...a),
    voiceChatPromote: (...a: unknown[]) => promoteMock(...a),
  },
}));

import VoiceChatView from '../../src/components/voicechat/VoiceChatView';
import { VOICE_STARTED, VOICE_STOP_CONTINUOUS } from '../../src/utils/audioExclusive';

/** ★ 直近に作られたデータチャネル。サーバからのイベントを流し込むために持っておく */
let lastDc: { readyState: string; send: ReturnType<typeof vi.fn>; onmessage?: (ev: { data: string }) => void; onclose?: () => void } | null = null;

/** ★ 直近に作られた接続。切断を起こすために持っておく (#409) */
let lastPc: { connectionState: string; onconnectionstatechange?: () => void; close: ReturnType<typeof vi.fn> } | null = null;

/** 接続の状態が変わったことにする */
function setConnectionState(next: string) {
  if (!lastPc) throw new Error('接続がまだ作られていない');
  lastPc.connectionState = next;
  lastPc.onconnectionstatechange?.();
}

/** サーバ (OpenAI) から来たことにしてイベントを 1 つ流す */
function emit(msg: unknown) {
  lastDc?.onmessage?.({ data: JSON.stringify(msg) });
}

/** WebRTC とマイクの最小のふり。中身の挙動は実機でしか確かめられない */
function stubWebRTC() {
  const track = { enabled: true, stop: vi.fn() };
  lastDc = null;
  lastPc = null;
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getAudioTracks: () => [track], getTracks: () => [track] }) },
  });
  vi.stubGlobal('RTCPeerConnection', vi.fn(() => {
    lastPc = {
      connectionState: 'connected',
      addTrack: vi.fn(),
      createDataChannel: vi.fn(() => { lastDc = { readyState: 'open', send: vi.fn() }; return lastDc; }),
      createOffer: vi.fn().mockResolvedValue({ sdp: 'v=0' }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as never;
    return lastPc;
  }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'v=0 answer' }));
  return track;
}

describe('VoiceChatView', () => {
  beforeEach(() => {
    createSession.mockReset().mockResolvedValue({ session_id: 's1', client_secret: 'ek_1', model: 'gpt-realtime-2.1-mini' });
    voiceChatLog.mockClear();
    stubWebRTC();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('★ 開いた直後は「準備しています」を出す (無言で待たせない — §7-2)', () => {
    render(<VoiceChatView roomId="r1" roomName="営業報告" onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('準備しています');
  });

  it('ルーム名を出す (どこで話しているかが分かる)', () => {
    render(<VoiceChatView roomId="r1" roomName="営業報告" onClose={vi.fn()} />);
    expect(screen.getByText('営業報告')).toBeInTheDocument();
  });

  it('★ 繋がるまで 押して話す は押せない', () => {
    render(<VoiceChatView roomId="r1" roomName="営業報告" onClose={vi.fn()} />);
    expect(screen.getByText('押しながら話す').closest('button')).toBeDisabled();
  });

  it('★★ 繋がったら同時再生の規約に乗る (voice:started を出して他の再生を止める)', async () => {
    const seen = vi.fn();
    window.addEventListener(VOICE_STARTED, seen);
    render(<VoiceChatView roomId="r1" roomName="営業報告" onClose={vi.fn()} />);
    await waitFor(() => expect(seen).toHaveBeenCalled());
    window.removeEventListener(VOICE_STARTED, seen);
  });

  it('★ 繋がったら「押しながら話してください」に変わり、押せるようになる', async () => {
    render(<VoiceChatView roomId="r1" roomName="営業報告" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('押しながら話してください'));
    expect(screen.getByText('押しながら話す').closest('button')).not.toBeDisabled();
  });

  it('★★ 始められなければ、黙らずに理由を出す (壊れたのか考えているのか分からない状態を作らない)', async () => {
    createSession.mockRejectedValue(new Error('このルームでは会話モードが有効になっていません'));
    render(<VoiceChatView roomId="r1" roomName="営業報告" onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('有効になっていません');
    });
    expect(screen.getByRole('status')).toHaveTextContent('接続できませんでした');
  });

  it('★ 閉じたら onClose が呼ばれ、自分で止めた合図を出す (Wake Lock を離す)', async () => {
    const onClose = vi.fn();
    const stopped = vi.fn();
    window.addEventListener(VOICE_STOP_CONTINUOUS, stopped);
    render(<VoiceChatView roomId="r1" roomName="営業報告" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('押しながら話してください'));

    fireEvent.click(screen.getByLabelText('閉じる'));
    expect(onClose).toHaveBeenCalled();
    expect(stopped).toHaveBeenCalled();
    window.removeEventListener(VOICE_STOP_CONTINUOUS, stopped);
  });

  it('★★ 閉じるときに計測を送る (§12.6 — あとから基準を数えられる形で残す)', async () => {
    render(<VoiceChatView roomId="r1" roomName="営業報告" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('押しながら話してください'));

    fireEvent.click(screen.getByLabelText('閉じる'));
    expect(voiceChatLog).toHaveBeenCalled();
    const [sessionId, events] = voiceChatLog.mock.calls[0];
    expect(sessionId).toBe('s1');
    expect((events as Array<{ type: string }>).map((e) => e.type)).toContain('connected');
  });
});

/**
 * #405 R3 昇格 — 会話の途中で「良かった 1 つ」をルームへ残す (docs/08 §1.2.2)。
 *
 * ★ **閉じる時にまとめて選ぶ形は採らなかった。** 会話が頭から消えたあとに読み返す作業が
 *   発生し、壁打ちの軽さと逆行する。**良いと思った瞬間に押す**方が自然で、しかも
 *   行き先を選ばなくてよい (会話はそのルームから開いている) ので実装も小さい。
 *
 * ★ 対象は **AI の発言だけ**。人の発言を残せるかは、使ってみないと要否が分からないので入れない。
 */
describe('VoiceChatView — 昇格 (R3)', () => {

  beforeEach(() => {
    createSession.mockReset().mockResolvedValue({ session_id: 's1', client_secret: 'ek_1', model: 'm' });
    promoteMock.mockReset().mockResolvedValue({ ok: true });
    voiceChatLog.mockClear();
    stubWebRTC();
  });

  it('★ AI がまだ何も言っていないうちは「残す」を押せない', async () => {
    render(<VoiceChatView roomId="r1" roomName="営業報告" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('押しながら話してください'));
    expect(screen.getByText('このルームに残す').closest('button')).toBeDisabled();
  });
});

/**
 * #408 昇格が失敗したときに、**理由が残る / 分かる**こと。
 *
 * ★ 実測 (as of 2026-09-06 12:23 JST): 昇格 7 回中 3 回失敗。うち 2 件は client の既定文言
 *   「残せませんでした」だけが残り、**HTTP status も無く、サーバの log にも 1 行も無かった**。
 *   → (a) status を計測に残す (b) サーバに届かなかったときは、その旨が分かる文言にする。
 */
describe('VoiceChatView — 昇格の失敗 (#408)', () => {
  beforeEach(() => {
    createSession.mockReset().mockResolvedValue({ session_id: 's1', client_secret: 'ek_1', model: 'm' });
    promoteMock.mockReset();
    voiceChatLog.mockClear();
    stubWebRTC();
  });
  afterEach(() => vi.unstubAllGlobals());

  /** AI が 1 度喋った状態にして「残す」を押せるようにする */
  async function speakThenPromote() {
    render(<VoiceChatView roomId="r1" roomName="営業報告" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('押しながら話してください'));
    emit({ type: 'response.output_audio_transcript.done', transcript: '要点はこうです' });
    await waitFor(() => expect(screen.getByText('このルームに残す').closest('button')).toBeEnabled());
    fireEvent.click(screen.getByText('このルームに残す'));
  }

  /** 閉じたときに送られる計測イベント */
  function loggedEvents(): Array<{ type: string; data?: Record<string, unknown> }> {
    fireEvent.click(screen.getByLabelText('閉じる'));
    const last = voiceChatLog.mock.calls.at(-1) as unknown[] | undefined;
    return (last?.[1] ?? []) as Array<{ type: string; data?: Record<string, unknown> }>;
  }

  it('★★ サーバが断った (403) → 文言をそのまま出し、status を計測に残す', async () => {
    promoteMock.mockRejectedValue(Object.assign(new Error('会話を開き直すと残せます (接続が切れました)'), { status: 403 }));
    await speakThenPromote();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('開き直す'));

    const err = loggedEvents().find((e) => e.type === 'promote_error');
    expect(err?.data?.status).toBe(403);
  });

  it('★★ サーバに届かなかった (status が取れない) → 届いていないことが分かる文言にする', async () => {
    promoteMock.mockRejectedValue(new Error('残せませんでした'));
    await speakThenPromote();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('届いていません'));

    const err = loggedEvents().find((e) => e.type === 'promote_error');
    expect(err).toBeDefined();
    // ★ undefined ではなく **null** で残す (#410)。undefined は JSON.stringify でキーごと消え、
    //   集計で「届かなかった」と「#408 より前の古い記録」が同じ顔になってしまう
    expect(err?.data?.status).toBeNull();
  });
});

/**
 * #409 接続が切れたことが画面に出ること。
 *
 * ★ これまで `useRealtimeVoice` は接続の生死を見る口を 1 つも持っていなかった。
 *   切れても state は `live` のままで、画面は「押しながら話してください」と言い続け、
 *   押しても `dc.readyState !== 'open'` で黙って捨てられていた。
 *   docs/08 §7-2「無言で待たせない」——「考えている」と「壊れた」が区別できないのが一番まずい。
 *
 * ★★ 現場のネットワークでの測り直し (§12.5) の前に入れる。**通らなかったときに画面が何も
 *   言わない**と、「遅い」と「切れた」を取り違えるため。
 */
describe('VoiceChatView — 接続が切れたとき (#409)', () => {
  beforeEach(() => {
    createSession.mockReset().mockResolvedValue({ session_id: 's1', client_secret: 'ek_1', model: 'm' });
    voiceChatLog.mockClear();
    stubWebRTC();
  });
  afterEach(() => vi.unstubAllGlobals());

  async function live() {
    render(<VoiceChatView roomId="r1" roomName="営業報告" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('押しながら話してください'));
  }

  it('★★ failed → 切れたことが画面に出て、押して話すが押せなくなる', async () => {
    await live();
    setConnectionState('failed');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('接続が切れました'));
    expect(screen.getByText('押しながら話す').closest('button')).toBeDisabled();
  });

  it('★ disconnected では落とさない (戻ることがある)。不安定だとだけ出す', async () => {
    await live();
    setConnectionState('disconnected');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('接続が不安定'));
    // ★ 押して話す は生かしておく (戻ったらそのまま続けられる)
    expect(screen.getByText('押しながら話す').closest('button')).toBeEnabled();
  });

  it('★★ 切断は計測に残り、閉じるを押さなくても送られる (画面を離れると記録ごと消えていた)', async () => {
    await live();
    setConnectionState('failed');

    await waitFor(() => expect(voiceChatLog).toHaveBeenCalled());
    const events = (voiceChatLog.mock.calls.at(-1) as unknown[])[1] as Array<{ type: string; data?: Record<string, unknown> }>;
    expect(events.find((e) => e.type === 'connection_lost')?.data?.state).toBe('failed');
  });
});
