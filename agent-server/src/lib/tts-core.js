/**
 * TTS core: Aivis Cloud API 合成 + mediasoup PlainTransport 送信
 *
 * agent-server の自動読み上げ（ttsSpeak.js）と rtc-server の CLI
 * （tts-speak.js）で同一ロジックを使うための共通モジュール。
 * Node 標準 API（https / child_process / ws）のみ使用するため
 * どちらの node_modules からも動作する。
 */
const https = require('https');
const { spawn } = require('child_process');
const WebSocket = require('ws');

/**
 * Aivis Cloud API で音声合成
 *
 * @param {string} text 合成するテキスト
 * @param {object} opts
 * @param {string} opts.modelUuid 音声モデル UUID
 * @param {string} opts.apiKey    Aivis API キー
 * @param {number} [opts.timeout=30000] タイムアウト (ms)
 * @returns {Promise<Buffer>} WAV バッファ
 */
function synthesize(text, { modelUuid, apiKey, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model_uuid: modelUuid,
      text,
      output_format: 'wav',
    });
    const req = https.request('https://api.aivis-project.com/v1/tts/synthesize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(data),
      },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode === 200) resolve(buf);
        else reject(new Error(`TTS error ${res.statusCode}: ${buf.toString().substring(0, 200)}`));
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('TTS request timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * PlainTransport で RTP 送信（WS → mediasoup → ffmpeg → RTP）
 *
 * @param {string} wavPath WAV ファイルパス
 * @param {string} roomId mediasoup ルーム ID
 * @param {object} opts
 * @param {number} opts.rtcPort   rtc-server ポート
 * @param {number} [opts.ssrc=1111] RTP SSRC
 * @param {function} [opts.onProgress] (time: string) => void ffmpeg の time= 値で呼ばれる
 * @returns {Promise<number>} ffmpeg 終了コード
 */
function sendViaPlainTransport(wavPath, roomId, { rtcPort, ssrc = 1111, onProgress }) {
  return new Promise((resolve, reject) => {
    const peerId = 'tts-' + Math.random().toString(36).slice(2, 8);
    const pendingResolvers = [];
    let ws;

    function send(msg) { ws.send(JSON.stringify(msg)); }
    function waitFor(pred) {
      return new Promise((res) => pendingResolvers.push({ predicate: pred, resolve: res }));
    }

    ws = new WebSocket(`ws://localhost:${rtcPort}/ws`);

    ws.on('open', async () => {
      try {
        send({ type: 'join', peerId, roomId });
        await waitFor((m) => m.type === 'joined');

        send({ type: 'createPlainTransport' });
        const pt = await waitFor((m) => m.type === 'plainTransportCreated');

        send({ type: 'plainProduce', transportId: pt.id, ssrc });
        await waitFor((m) => m.type === 'produced');

        // ブラウザ側の Consumer セットアップを待つ
        await new Promise((r) => setTimeout(r, 2000));

        const ffmpeg = spawn('ffmpeg', [
          '-re', '-i', wavPath,
          '-af', 'adelay=300|300,apad=pad_dur=500ms',
          '-c:a', 'libopus', '-ac', '2', '-ar', '48000', '-b:a', '32k',
          '-f', 'rtp', '-ssrc', String(ssrc), '-payload_type', '100',
          `rtp://127.0.0.1:${pt.port}`,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        if (onProgress) {
          ffmpeg.stderr.on('data', (d) => {
            const line = d.toString();
            const match = line.match(/time=(\S+)/);
            if (match) onProgress(match[1]);
          });
        }

        ffmpeg.on('close', (code) => {
          // 最後の RTP パケットが mediasoup で処理されるのを待つ
          setTimeout(() => {
            send({ type: 'leave' });
            ws.close();
            resolve(code);
          }, 1500);
        });

        ffmpeg.on('error', (err) => {
          send({ type: 'leave' });
          ws.close();
          reject(err);
        });
      } catch (err) {
        ws.close();
        reject(err);
      }
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      for (let i = pendingResolvers.length - 1; i >= 0; i--) {
        if (pendingResolvers[i].predicate(msg)) {
          const { resolve } = pendingResolvers.splice(i, 1)[0];
          resolve(msg);
          return;
        }
      }
    });

    ws.on('error', reject);
  });
}

module.exports = { synthesize, sendViaPlainTransport };
