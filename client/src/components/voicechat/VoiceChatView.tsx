import { useEffect } from 'react';
import { Mic, X } from 'lucide-react';
import { useRealtimeVoice } from '../../hooks/useRealtimeVoice';
import './VoiceChatView.css';

interface VoiceChatViewProps {
  roomId: string;
  roomName: string;
  onClose: () => void;
}

/**
 * #405 Realtime 音声会話の専用画面 (docs/08 §12)。
 *
 * ★ トーク画面に混ぜない理由は見た目ではなく、**トーク画面が前提にしているものが 3 つとも無い**から
 *   (docs/08 §10 の訂正): 区切りが無い / 接続という状態が無い / 割り込みという操作が無い。
 *
 * ★ §7-2「無言で待たせない」: 今どの状態かを必ず画面に出す。何も出さないと
 *   「考えている」と「壊れた」が区別できない。
 *
 * ★ 試作 (R0〜R2) の画面。**成立しなければこの画面ごと捨てる** (docs/08 §7.1)。
 *   凝った作りにしないのは、捨てる前提だから。
 */
function VoiceChatView({ roomId, roomName, onClose }: VoiceChatViewProps) {
  const voice = useRealtimeVoice(roomId);
  const { state, start, stop } = voice;

  useEffect(() => { void start(); }, [start]);

  const close = () => { stop(); onClose(); };

  const label = state === 'requesting' ? '準備しています…'
    : state === 'connecting' ? '接続しています…'
    : state === 'error' ? '接続できませんでした'
    : voice.isToolRunning ? '調べています…'
    : voice.isTalking ? '聞いています'
    : voice.isAiSpeaking ? '話しています'
    : '押しながら話してください';

  return (
    <div className="voice-chat-overlay">
      <div className="voice-chat-header">
        <span className="voice-chat-room">{roomName}</span>
        <button className="voice-chat-close" onClick={close} aria-label="閉じる"><X size={20} /></button>
      </div>

      <div className="voice-chat-body">
        <div
          className={`voice-chat-orb ${voice.isAiSpeaking ? 'speaking' : ''} ${voice.isTalking ? 'listening' : ''}`}
          aria-hidden="true"
        />
        <p className="voice-chat-status" role="status">{label}</p>
        {voice.error && <p className="voice-chat-error" role="alert">{voice.error}</p>}
        {state === 'live' && <p className="voice-chat-turns">{voice.turns} 往復</p>}
      </div>

      <div className="voice-chat-footer">
        <button
          className={`voice-chat-ptt ${voice.isTalking ? 'active' : ''}`}
          disabled={state !== 'live'}
          onPointerDown={voice.pressTalk}
          onPointerUp={voice.releaseTalk}
          onPointerCancel={voice.releaseTalk}
          onPointerLeave={voice.releaseTalk}
        >
          <Mic size={28} />
          <span>押しながら話す</span>
        </button>
      </div>
    </div>
  );
}

export default VoiceChatView;
