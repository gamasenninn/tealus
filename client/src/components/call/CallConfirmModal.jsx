import { useState } from 'react';
import { Phone, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import './CallConfirmModal.css';

function CallConfirmModal({ onConfirm, onCancel }) {
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);

  return (
    <div className="call-confirm-overlay" onClick={onCancel}>
      <div className="call-confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="call-confirm-title">通話を開始しますか？</div>

        <div className="call-confirm-options">
          <button
            className={`call-confirm-toggle ${audioEnabled ? 'active' : ''}`}
            onClick={() => setAudioEnabled(!audioEnabled)}
          >
            {audioEnabled ? <Mic size={20} /> : <MicOff size={20} />}
            <span>音声 {audioEnabled ? 'ON' : 'OFF'}</span>
          </button>
          <button
            className={`call-confirm-toggle ${videoEnabled ? 'active' : ''}`}
            onClick={() => setVideoEnabled(!videoEnabled)}
          >
            {videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
            <span>映像 {videoEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        <div className="call-confirm-actions">
          <button className="call-confirm-cancel" onClick={onCancel}>
            キャンセル
          </button>
          <button
            className="call-confirm-start"
            disabled={!videoEnabled && !audioEnabled}
            onClick={() => onConfirm({ video: videoEnabled, audio: audioEnabled })}
          >
            <Phone size={18} />
            開始
          </button>
        </div>
      </div>
    </div>
  );
}

export default CallConfirmModal;
