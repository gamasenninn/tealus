import { useState, useRef, useEffect, useCallback } from 'react';
import './VoiceRecorder.css';

function VoiceRecorder({ stream, onSend, onCancel }) {
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    if (!stream) return;

    // Audio level analysis
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });
    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mediaRecorder.start(100);

    // Timer
    timerRef.current = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);

    // Level meter
    const updateLevel = () => {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setAudioLevel(avg / 255);
      animFrameRef.current = requestAnimationFrame(updateLevel);
    };
    updateLevel();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      audioCtx.close();
    };
  }, [stream]);

  const handleSend = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      stream.getTracks().forEach((t) => t.stop());
      onSend(blob);
    };
    recorder.stop();
  }, [stream, onSend]);

  const handleCancel = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    stream.getTracks().forEach((t) => t.stop());
    onCancel();
  }, [stream, onCancel]);

  const formatTime = (s) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const bars = Array.from({ length: 20 }, (_, i) => {
    const h = Math.max(4, audioLevel * 30 * (0.5 + Math.random() * 0.5));
    return <div key={i} className="voice-bar" style={{ height: `${h}px` }} />;
  });

  return (
    <div className="voice-recorder-overlay" onClick={handleCancel}>
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
