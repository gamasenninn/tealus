import { useEffect } from 'react';

/**
 * 音声連続再生 + Wake Lock管理
 * voice:ended → 次の音声メッセージを自動再生
 * voice:started → Wake Lock取得
 * voice:stop-continuous → Wake Lock解放
 */
export function useVoiceContinuousPlay(messages) {
  useEffect(() => {
    let wakeLock = null;

    const acquireWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && !wakeLock) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
      } catch (e) { /* Wake Lock not supported or failed */ }
    };

    const releaseWakeLock = () => {
      if (wakeLock) { wakeLock.release(); wakeLock = null; }
    };

    const handleVoiceEnded = (e) => {
      const endedId = e.detail.messageId;
      const voiceMessages = messages.filter(m => m.type === 'voice');
      const currentIdx = voiceMessages.findIndex(m => m.id === endedId);
      if (currentIdx >= 0 && currentIdx < voiceMessages.length - 1) {
        const nextMsg = voiceMessages[currentIdx + 1];
        acquireWakeLock();
        window.dispatchEvent(new CustomEvent('voice:play', { detail: { messageId: nextMsg.id } }));
        setTimeout(() => {
          const el = document.querySelector(`[data-msg-id="${nextMsg.id}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      } else {
        releaseWakeLock();
      }
    };

    const handleStopContinuous = () => {
      releaseWakeLock();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && wakeLock === null) {
        // 再生中ならWake Lock再取得
      }
    };

    const handleVoiceStarted = () => { acquireWakeLock(); };

    window.addEventListener('voice:ended', handleVoiceEnded);
    window.addEventListener('voice:started', handleVoiceStarted);
    window.addEventListener('voice:stop-continuous', handleStopContinuous);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('voice:ended', handleVoiceEnded);
      window.removeEventListener('voice:started', handleVoiceStarted);
      window.removeEventListener('voice:stop-continuous', handleStopContinuous);
      document.removeEventListener('visibilitychange', handleVisibility);
      releaseWakeLock();
    };
  }, [messages]);
}
