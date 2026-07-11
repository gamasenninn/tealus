import { Phone, PhoneOff } from 'lucide-react';
import './IncomingCallModal.css';

interface IncomingCallModalProps {
  /** useCallNotification の payload 由来のため欠けうる */
  callerName?: string;
  onAccept: () => void;
  onReject: () => void;
}

function IncomingCallModal({ callerName, onAccept, onReject }: IncomingCallModalProps) {
  return (
    <div className="call-incoming-overlay">
      <div className="call-incoming-modal">
        <div className="call-incoming-caller">{callerName}</div>
        <div className="call-incoming-label">通話の着信</div>
        <div className="call-incoming-actions">
          <button className="call-btn call-btn-accept" onClick={onAccept} title="応答">
            <Phone size={24} />
          </button>
          <button className="call-btn call-btn-reject" onClick={onReject} title="拒否">
            <PhoneOff size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default IncomingCallModal;
