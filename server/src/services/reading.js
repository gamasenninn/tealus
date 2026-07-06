/**
 * #327 読み供給サービス — 任意文字列（特に漢字 garble）のひらがな読みを pykakasi で当てる。
 *
 * 自己成長 hook の音韻ゲートは garble と term 双方の読みを要る。term は table に backfill 済だが、
 * garble は STT の生出力（漢字の誤変換が多い）で読みが無い。kata2hira はカタカナしか変換できず
 * 漢字 garble を採点できない（音韻距離 1.0 で全棄却）→ 現場の名前修正の大半が零れていた。
 * ここで pykakasi(既存 _readings_pykakasi.py, uv run) を async spawn して漢字読みを供給する。
 *
 * - async spawn（spawnSync は event loop を止めるので不可。hook は fire-and-forget なので遅延は許容）
 * - in-memory キャッシュ（同一 garble の再スポーンを回避）
 * - pykakasi 不達時は kata2hira にフォールバック（非破壊）
 * - pykakasiImpl は DI 可能（test で subprocess を回避）
 */
const { spawn } = require('child_process');
const path = require('path');

function kata2hira(s) {
  return [...String(s || '')].map((c) => {
    const o = c.codePointAt(0);
    return (o >= 0x30A1 && o <= 0x30F6) ? String.fromCodePoint(o - 0x60) : c;
  }).join('');
}

const cache = new Map();

// texts[] → {text: ひらがな} を pykakasi(uv run)で取得。stdin/stdout JSON。
function pykakasiReadings(texts) {
  return new Promise((resolve, reject) => {
    const py = path.join(__dirname, '../../scripts/_readings_pykakasi.py');
    const child = spawn('uv', ['run', py], { shell: true });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`pykakasi exit ${code}: ${err.slice(-200)}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
    child.stdin.write(JSON.stringify(texts));
    child.stdin.end();
  });
}

/**
 * 文字列群の読みを返す（キャッシュ + pykakasi + kata2hira フォールバック）。
 * @param {string[]} texts
 * @param {object} [opts]
 * @param {(t:string[])=>Promise<object>} [opts.pykakasiImpl] - test 差し替え用
 * @returns {Promise<Map<string,string>>} text → ひらがな読み
 */
async function getReadings(texts, opts = {}) {
  const impl = opts.pykakasiImpl || pykakasiReadings;
  const out = new Map();
  const need = [];
  for (const t of texts) {
    if (!t) continue;
    if (cache.has(t)) out.set(t, cache.get(t));
    else if (!need.includes(t)) need.push(t);
  }
  if (need.length) {
    let readings = {};
    try { readings = await impl(need); } catch { readings = {}; }
    for (const t of need) {
      const r = (readings && readings[t]) || kata2hira(t);
      cache.set(t, r);
      out.set(t, r);
    }
  }
  return out;
}

module.exports = { getReadings, kata2hira, _clearCache: () => cache.clear() };
