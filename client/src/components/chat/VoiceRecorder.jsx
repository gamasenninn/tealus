import { useState, useRef, useEffect, useCallback } from 'react';
import './VoiceRecorder.css';

function VoiceRecorder({ stream, onSend, onCancel }) {
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const animFrameRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastTapRef = useRef(0);

  // Initialize on mount, cleanup on unmount
  useEffect(() => {
    if (!stream) return;

    // Clean previous state if any
    chunksRef.current = [];

    // Prevent screen sleep during recording
    let wakeLock = null;
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(lock => { wakeLock = lock; }).catch(() => {});
    }

    // Audio context for level meter
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    // MediaRecorder — prefer mp4 for Safari/iPhone compatibility
    const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    // No timeslice — collect all data at stop() for better Safari compatibility
    recorder.start();

    // Timer
    const timer = setInterval(() => setDuration(d => d + 1), 1000);
    timerRef.current = timer;

    // Level meter
    let running = true;
    const updateLevel = () => {
      if (!running) return;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const max = Math.max(...data);
      setAudioLevel(Math.min(max / 128, 1));
      animFrameRef.current = requestAnimationFrame(updateLevel);
    };
    updateLevel();

    return () => {
      running = false;
      clearInterval(timer);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (recorder.state !== 'inactive') {
        recorder.onstop = () => {};
        recorder.stop();
      }
      audioCtx.close().catch(() => {});
      if (wakeLock) wakeLock.release().catch(() => {});
      recorderRef.current = null;
    };
  }, [stream]);

  const handleSend = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    // Stop timer and animation immediately
    if (timerRef.current) clearInterval(timerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    recorder.onstop = () => {
      const type = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      stream.getTracks().forEach(t => t.stop());
      recorderRef.current = null;
      onSend(blob, type);
    };
    recorder.stop();
  }, [onSend]);

  const handleCancel = useCallback(() => {
    stream.getTracks().forEach(t => t.stop());
    recorderRef.current = null;
    onCancel();
  }, [stream, onCancel]);

  const formatTime = (s) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const bars = Array.from({ length: 20 }, (_, i) => {
    const h = Math.max(4, audioLevel * 50 * (0.3 + Math.random() * 0.7));
    return <div key={i} className="voice-bar" style={{ height: `${h}px` }} />;
  });

  return (
    <div className="voice-recorder-overlay" onClick={() => {
      const now = Date.now();
      if (now - lastTapRef.current < 400) {
        handleSend();
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    }}>
      <div className="voice-recorder" onClick={(e) => e.stopPropagation()}>
        <div className="voice-recorder-status">
          <span className="voice-recorder-dot" />
          録音中...
        </div>
        <div className="voice-recorder-bars">{bars}</div>
        <div className="voice-recorder-time">{formatTime(duration)}</div>
        <div className="voice-recorder-actions">
          <button className="voice-cancel-btn" onClick={handleCancel}>キャンセル</button>
          <button className="voice-send-btn" onClick={handleSend}>送信</button>
        </div>
      </div>
    </div>
  );
}

export default VoiceRecorder;
