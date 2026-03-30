import { useState, useRef, useEffect, useCallback } from 'react';
import './VoiceRecorder.css';

function VoiceRecorder({ stream, onSend, onCancel }) {
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const animFrameRef = useRef(null);
  const audioCtxRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!stream || startedRef.current) return;
    startedRef.current = true;

    // Audio level analysis
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    // Choose supported mime type
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';
    const opts = mimeType ? { mimeType } : {};
    const mediaRecorder = new MediaRecorder(stream, opts);
    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.start(250);

    // Timer
    timerRef.current = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);

    // Level meter
    const updateLevel = () => {
      if (audioCtx.state === 'closed') return;
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
    };
  }, [stream]);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
    }
    stream.getTracks().forEach((t) => t.stop());
  }, [stream]);

  const handleSend = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    recorder.onstop = () => {
      const type = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      cleanup();
      onSend(blob, type);
    };
    recorder.stop();
  }, [cleanup, onSend]);

  const handleCancel = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {}; // prevent send
      recorder.stop();
    }
    cleanup();
    onCancel();
  }, [cleanup, onCancel]);

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
