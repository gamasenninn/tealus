import { useEffect, useRef, useState } from 'react';
import { Mic, X, ArrowUpToLine, RotateCcw, Send } from 'lucide-react';
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

  // ★ 初回だけ自分から繋ぐ (#429)。★★ 止まった後は **人が押すまで繋がない** ——
  //   課金が動機なので (業務メモ 2026-09-06)、黙って繋ぎ直すのは依頼と逆になる。
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  // ★ 止まっている = 戻る道を出す状態。★★ error だけを見る (live / connecting では出さない)
  const isStopped = state === 'error';

  // ★ #428 手入力。音声だけだと固有名詞の誤変換を直す層が無い (業務メモ 2026-09-06)
  const [draft, setDraft] = useState('');
  const submit = () => { if (voice.sendText(draft)) setDraft(''); };

  const close = () => { stop(); onClose(); };

  const label = state === 'requesting' ? '準備しています…'
    : state === 'connecting' ? '接続しています…'
    : state === 'error' ? '接続できませんでした'
    // ★ 不安定は「押しながら話してください」より先に出す (#409)。戻ることがあるので切らないが、
    //   黙っていると「AI が答えない」に見える (docs/08 §7-2)
    : voice.isUnstable ? '接続が不安定です…'
    : voice.isToolRunning ? '調べています…'
    : voice.isTalking ? '聞いています'
    // ★★ 送れなかったことは「話しています」より先に出す (#421)。黙って捨てると
    //   話しかけたのに無視されたように見え、実測 4 件のうち 2 件はこの直後に閉じられている。
    //   ★ 文言は門の言い分 (「前の返事が続いています」) ではなく **起きたこと** にする ——
    //   何も鳴っていないのに断られた形が実測で 1 件あり、そこでは前者が嘘になる。
    : voice.wasSkipped ? 'いまの声は送れませんでした。もう一度どうぞ'
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

        {/*
          ★ #429 戻る道。これが無いと、上限で閉じた後は **画面を閉じて開き直すしかなかった**。
          ★★ 自動では繋ぎ直さない —— 「接続しているだけで課金対象」が依頼の動機なので、
            勝手に繋ぐのは逆。★★★ 押したときだけ繋ぐ。
          ★ MCP は agent-server 側で 30 分キャッシュされており (roomMcpManager、MCP_CACHE_TTL)、
            音声セッションには紐づかない。なので **繋ぎ直しは初回ほど待たされない**。
        */}
        {isStopped && (
          <button className="voice-chat-reconnect" onClick={() => void start()}>
            <RotateCcw size={16} />
            <span>もう一度つなぐ</span>
          </button>
        )}
      </div>

      {/*
        ★ 昇格 (R3、docs/08 §1.2.2)。**会話の途中で押せる**。
        閉じる時にまとめて選ぶ形は採らなかった —— 会話が頭から消えたあとに読み返す作業が
        発生し、壁打ちの軽さと逆行する。良いと思った瞬間に押す方が自然で、しかも
        行き先を選ばなくてよい (会話はそのルームから開いている)。
        ★ 対象は直近の **AI の発言** だけ。人の発言は今回入れない。
      */}
      <div className="voice-chat-promote">
        <button
          className={`voice-chat-promote-btn ${voice.promoteState === 'done' ? 'done' : ''}`}
          disabled={!voice.lastReply || voice.promoteState === 'sending' || voice.promoteState === 'done'}
          onClick={() => void voice.promote()}
        >
          <ArrowUpToLine size={16} />
          <span>
            {voice.promoteState === 'sending' ? '残しています…'
              : voice.promoteState === 'done' ? '残しました'
              : 'このルームに残す'}
          </span>
        </button>
        {/* ★ 失敗は必ず見せる。残ったと思って残っていない、を作らない */}
        {voice.promoteError && <p className="voice-chat-error" role="alert">{voice.promoteError}</p>}
      </div>

      {/*
        ★ #428 手入力。**音声の置き換えではなく併存** (主は押して話す)。
        ★★ 会話モードは Realtime の音声認識で、本体の STT 経路 (organon 整形段) を通らない。
          整形段は本体側で +111 語 / 壊した語 0 の効き方をする層 (2026-09-10、#426) で、
          それが会話モードには無い。**固有名詞を確実に入れる道**として要る。
        ★ Enter でも送れる (打ってすぐ送りたいので、ボタンまで手を動かさせない)。
      */}
      <div className="voice-chat-text">
        <input
          className="voice-chat-text-box"
          type="text"
          value={draft}
          placeholder="打って送る (人名・機種名など)"
          disabled={state !== 'live'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <button
          className="voice-chat-text-send"
          disabled={state !== 'live' || !draft.trim()}
          onClick={submit}
          aria-label="送る"
        >
          <Send size={18} />
        </button>
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
