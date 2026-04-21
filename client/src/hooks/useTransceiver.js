import { useState, useRef, useEffect, useCallback } from 'react';
import { Device } from 'mediasoup-client';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';

/**
 * トランシーバー（PTT）フック
 * チャット画面内で mediasoup 音声のみ通信を管理
 */
export function useTransceiver(roomId) {
  const { token } = useAuthStore();
  const { members } = useRoomStore();
  const [state, setState] = useState('idle'); // idle | connecting | connected | producing | error
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);
  const [remoteSpeaker, setRemoteSpeaker] = useState(null);

  const wsRef = useRef(null);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const producerRef = useRef(null);
  const consumersRef = useRef(new Map()); // peerId -> { consumer, stream, audioEl }
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const handlersRef = useRef([]);
  const intentionalCloseRef = useRef(false);

  // --- WebSocket helpers ---
  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const waitForMessage = useCallback((predicate) => {
    return new Promise((resolve) => {
      const handler = (msg) => {
        if (predicate(msg)) {
          const idx = handlersRef.current.indexOf(handler);
          if (idx >= 0) handlersRef.current.splice(idx, 1);
          resolve(msg);
          return true;
        }
        return false;
      };
      handlersRef.current.push(handler);
    });
  }, []);

  // peerId → 表示名に変換
  const getPeerName = useCallback((peerId) => {
    const member = members.find(m => m.user_id === peerId);
    return member?.display_name || peerId.slice(0, 8);
  }, [members]);

  // --- 受信音声レベル計測 ---
  const startAudioLevelMonitor = useCallback((stream, peerId) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const update = () => {
        analyser.getByteFrequencyData(dataArray);
        const max = Math.max(...dataArray) / 255;
        setRemoteAudioLevel(max);
        if (max > 0.05) {
          setRemoteSpeaker(getPeerName(peerId));
        } else {
          setRemoteSpeaker(null);
        }
        animFrameRef.current = requestAnimationFrame(update);
      };
      update();
    } catch (err) {
      console.error('[transceiver] audio level monitor error:', err);
    }
  }, [getPeerName]);

  const stopAudioLevelMonitor = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setRemoteAudioLevel(0);
    setRemoteSpeaker(null);
  }, []);

  // --- Consumer 管理 ---
  const consumeProducer = useCallback(async (producerId, producerPeerId) => {
    try {
      const recvTransport = recvTransportRef.current;
      const device = deviceRef.current;
      if (!recvTransport || !device) return;

      send({
        type: 'consume',
        producerId,
        transportId: recvTransport.id,
        rtpCapabilities: device.rtpCapabilities,
      });

      const resp = await waitForMessage((m) => m.type === 'consumed' && m.producerId === producerId);

      const consumer = await recvTransport.consume({
        id: resp.consumerId,
        producerId: resp.producerId,
        kind: resp.kind,
        rtpParameters: resp.rtpParameters,
      });

      send({ type: 'resumeConsumer', consumerId: resp.consumerId });
      await consumer.resume();

      // 音声再生
      const stream = new MediaStream([consumer.track]);
      const audioEl = new Audio();
      audioEl.srcObject = stream;
      audioEl.play().catch(() => {});

      consumersRef.current.set(producerPeerId, { consumer, stream, audioEl });

      // 音声レベル計測
      startAudioLevelMonitor(stream, producerPeerId);
    } catch (err) {
      console.error('[transceiver] consume error:', err);
    }
  }, [send, waitForMessage, startAudioLevelMonitor]);

  // --- 接続 ---
  const connect = useCallback(async () => {
    if (!roomId || !token || state !== 'idle') return;

    setState('connecting');
    intentionalCloseRef.current = false;

    try {
      // WebSocket 接続
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsPath = '/rtc/ws';
      const ws = new WebSocket(`${protocol}//${location.host}${wsPath}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
        setTimeout(() => reject(new Error('WS timeout')), 10000);
      });

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        for (let i = handlersRef.current.length - 1; i >= 0; i--) {
          if (handlersRef.current[i](msg)) return;
        }
      };

      ws.onclose = () => {
        if (!intentionalCloseRef.current) {
          setState('idle');
          cleanup();
        }
      };

      // 永続メッセージハンドラ
      handlersRef.current.push((msg) => {
        if (msg.type === 'newProducer') {
          consumeProducer(msg.producerId, msg.producerPeerId);
          return true;
        }
        if (msg.type === 'peerLeft') {
          const peer = consumersRef.current.get(msg.peerId);
          if (peer) {
            peer.audioEl.pause();
            peer.consumer.close();
            consumersRef.current.delete(msg.peerId);
            stopAudioLevelMonitor();
          }
          return true;
        }
        return false;
      });

      // Join
      send({ type: 'join', peerId: 'transceiver-' + Math.random().toString(36).slice(2, 8), roomId });
      const joinResp = await waitForMessage((m) => m.type === 'joined');

      // Device 初期化
      const device = new Device();
      await device.load({ routerRtpCapabilities: joinResp.routerRtpCapabilities });
      deviceRef.current = device;

      // Send transport
      send({ type: 'createTransport', direction: 'send' });
      const sendResp = await waitForMessage((m) => m.type === 'transportCreated' && m.direction === 'send');
      const sendTransport = device.createSendTransport(sendResp.params);

      sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        send({ type: 'connectTransport', transportId: sendTransport.id, dtlsParameters });
        waitForMessage((m) => m.type === 'transportConnected' && m.transportId === sendTransport.id)
          .then(() => callback()).catch(errback);
      });

      sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
        send({ type: 'produce', transportId: sendTransport.id, kind, rtpParameters });
        waitForMessage((m) => m.type === 'produced')
          .then((m) => callback({ id: m.producerId })).catch(errback);
      });

      sendTransportRef.current = sendTransport;

      // Recv transport
      send({ type: 'createTransport', direction: 'recv' });
      const recvResp = await waitForMessage((m) => m.type === 'transportCreated' && m.direction === 'recv');
      const recvTransport = device.createRecvTransport(recvResp.params);

      recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        send({ type: 'connectTransport', transportId: recvTransport.id, dtlsParameters });
        waitForMessage((m) => m.type === 'transportConnected' && m.transportId === recvTransport.id)
          .then(() => callback()).catch(errback);
      });

      recvTransportRef.current = recvTransport;

      // 既存の producer を consume
      send({ type: 'getProducers' });
      const prodResp = await waitForMessage((m) => m.type === 'producers');
      for (const p of prodResp.producers) {
        await consumeProducer(p.producerId, p.producerPeerId);
      }

      setState('connected');
    } catch (err) {
      console.error('[transceiver] connect error:', err);
      setState('error');
      cleanup();
    }
  }, [roomId, token, state, send, waitForMessage, consumeProducer, stopAudioLevelMonitor]);

  // --- 送信開始（録音開始時に呼ぶ）---
  const startProducing = useCallback(async (audioTrack) => {
    try {
      if (!sendTransportRef.current || !audioTrack) return;
      const producer = await sendTransportRef.current.produce({ track: audioTrack });
      producerRef.current = producer;
      setState('producing');
    } catch (err) {
      console.error('[transceiver] produce error:', err);
    }
  }, []);

  // --- 送信停止（録音終了/キャンセル時に呼ぶ）---
  const stopProducing = useCallback(() => {
    try {
      if (producerRef.current) {
        producerRef.current.close();
        producerRef.current = null;
      }
      if (state === 'producing') setState('connected');
    } catch (err) {
      console.error('[transceiver] stop produce error:', err);
    }
  }, [state]);

  // --- 切断 ---
  const cleanup = useCallback(() => {
    stopAudioLevelMonitor();
    if (producerRef.current) { try { producerRef.current.close(); } catch {} producerRef.current = null; }
    if (sendTransportRef.current) { try { sendTransportRef.current.close(); } catch {} sendTransportRef.current = null; }
    if (recvTransportRef.current) { try { recvTransportRef.current.close(); } catch {} recvTransportRef.current = null; }
    for (const [, peer] of consumersRef.current) {
      try { peer.audioEl.pause(); peer.consumer.close(); } catch {}
    }
    consumersRef.current.clear();
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
    deviceRef.current = null;
    handlersRef.current = [];
  }, [stopAudioLevelMonitor]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try { send({ type: 'leave' }); } catch {}
      wsRef.current.close();
    }
    wsRef.current = null;
    cleanup();
    setState('idle');
  }, [send, cleanup]);

  // ルーム変更時に切断
  useEffect(() => {
    return () => {
      if (state !== 'idle') {
        intentionalCloseRef.current = true;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          try { wsRef.current.send(JSON.stringify({ type: 'leave' })); } catch {}
          wsRef.current.close();
        }
        cleanup();
      }
    };
  }, [roomId]);

  return {
    state,
    remoteAudioLevel,
    remoteSpeaker,
    isConnected: state === 'connected' || state === 'producing',
    isProducing: state === 'producing',
    connect,
    disconnect,
    startProducing,
    stopProducing,
  };
}
