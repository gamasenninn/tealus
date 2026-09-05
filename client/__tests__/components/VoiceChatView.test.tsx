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

/** WebRTC とマイクの最小のふり。中身の挙動は実機でしか確かめられない */
function stubWebRTC() {
  const track = { enabled: true, stop: vi.fn() };
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getAudioTracks: () => [track], getTracks: () => [track] }) },
  });
  vi.stubGlobal('RTCPeerConnection', vi.fn(() => ({
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => ({ readyState: 'open', send: vi.fn() })),
    createOffer: vi.fn().mockResolvedValue({ sdp: 'v=0' }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  })));
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
