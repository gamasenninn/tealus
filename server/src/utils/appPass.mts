/**
 * #607 アプリの通行証 (docs/11)。部屋のメンバーなら、アプリパネルのアプリの前のベーシック認証を飛ばすための、
 * 2 分だけ有効な署名つきの札を作る。
 *
 * ★ Tealus が持つのはこの札を作るところまで。札を確かめてクッキーを渡すのは相手側の入口 (/tealus-gate/) で、
 *   クッキーと .htaccess は相手側の持ち物 (docs/11 §4.4)。
 * ★ 相手側は PHP 5.6。形を変えるときは docs/11 §4 を先に直し、相手側と取り決め直すこと
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 札の期限 (秒)。★ 使い切りにしない代わりに短くする (リンクの下見が先に取りに来るため。docs/11 §6.3) */
export const APP_PASS_TTL_SEC = 120;

/** 入口の場所。★ すべての相手で同じ決まり (docs/11 §5.2) */
export const APP_PASS_GATE_PATH = '/tealus-gate/';

export interface AppPassClaims {
  /** 宛先のサイトの origin。相手側は自分の origin と一致しなければ落とす */
  aud: string;
  room: string;
  /** Tealus の利用者 ID (監査用) */
  sub: string;
  /** 表示名 (相手側の記入者の欄に使う。docs/11 §6.2) */
  name: string;
  /** 行き先のページ (パス + 問い合わせ)。署名の中に入れて、書き換えられないようにする */
  to: string;
}

export interface PassTarget {
  origin: string;
  /** 鍵ファイルを引くホスト名 (小文字) */
  host: string;
  to: string;
  /** アプリの URL のハッシュ。入口の URL の末尾に付け、移り直しでブラウザに引き継がせる */
  hash: string;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signAppPass(key: Buffer, claims: AppPassClaims, nowSec: number): string {
  const payload = { v: 1, ...claims, iat: nowSec, exp: nowSec + APP_PASS_TTL_SEC };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  // ★ 署名の対象は「送る文字列そのまま」。相手側は JSON を組み直さずにこの文字列で計算する
  const sig = b64url(crypto.createHmac('sha256', key).update(`v1.${body}`).digest());
  return `v1.${body}.${sig}`;
}

/** 札を出してよい URL か。★ https に限る (札が平文の道に乗らないように) */
export function passTarget(appUrl: string): PassTarget | null {
  let u: URL;
  try { u = new URL(appUrl); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const to = `${u.pathname || '/'}${u.search}`;
  // ★ 相手側も同じ形を確かめる (docs/11 §4.3 の 6)。ここで作らなければ、相手側で落ちる札を出さずに済む
  if (!to.startsWith('/') || to.startsWith('//') || to.startsWith('/\\')) return null;
  return { origin: u.origin, host: u.hostname.toLowerCase(), to, hash: u.hash };
}

export function buildGateUrl(target: PassTarget, token: string): string {
  return `${target.origin}${APP_PASS_GATE_PATH}?tealus_pass=${encodeURIComponent(token)}${target.hash}`;
}

/** 鍵ファイルの置き場。★ repo の外 (鍵は commit しない) */
export function appPassKeyDir(): string {
  return process.env.APP_PASS_KEY_DIR || path.join(os.homedir(), '.tealus', 'app-pass');
}

const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const MIN_KEY_BYTES = 32;

/**
 * `<置き場>/<ホスト名>.key` (16 進の 1 行) を読む。無い・短い・壊れているときは null (= 札を出さない)。
 * ★ ホスト名は URL から来る値なので、区切り文字を含むものはファイルを探しに行かない
 */
export function loadAppPassKey(host: string, dir: string = appPassKeyDir()): Buffer | null {
  if (!HOST_RE.test(host) || host.includes('..')) return null;
  let text: string;
  try { text = fs.readFileSync(path.join(dir, `${host}.key`), 'utf8').trim(); } catch { return null; }
  if (!/^[0-9a-fA-F]+$/.test(text) || text.length % 2 !== 0) return null;
  const key = Buffer.from(text, 'hex');
  return key.length >= MIN_KEY_BYTES ? key : null;
}
