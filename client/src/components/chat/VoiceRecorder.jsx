import { useState, useRef, useEffect } from 'react';
import './VoiceRecorder.css';

function VoiceRecorder({ onSend, onCancel }) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        beginRecording(stream);
      } catch (err) {
        console.error('Microphone access error:', err);
        if (!cancelled) onCancel();
      }
    };

    init();
    return () => {
      cancelled = true;
      stopAll();
    };
  }, []);

  const beginRecording = (stream) => {
    streamRef.current = stream;

    // Audio level analysis
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

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
    setIsRecording(true);

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
  };

  const stopAll = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
  };

  const handleSend = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      stopAll();
      onSend(blob);
    };
    recorder.stop();
  };

  const handleCancel = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    stopAll();
    onCancel();
  };

  const formatTime = (s) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // Generate bars for visualization
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
