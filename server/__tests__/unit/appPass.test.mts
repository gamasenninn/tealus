/**
 * #607 アプリの通行証 (docs/11 §4)。相手側 (PHP 5.6) が確かめられる形で出しているかを見る。
 * ★ 確かめ方は相手側と同じ手順で書く (署名 → 中身)。自分の作った関数で自分を確かめない
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signAppPass, passTarget, buildGateUrl, loadAppPassKey, APP_PASS_TTL_SEC } from '../../src/utils/appPass.mts';

const KEY = Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex');

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

describe('signAppPass', () => {
  const claims = {
    aud: 'https://example.com', room: 'r-1', sub: 'u-1', name: '田中太郎', to: '/close/a/?x=1',
  };

  it('v1.中身.署名 の 3 つに分かれ、base64url の文字だけを使う', () => {
    const t = signAppPass(KEY, claims, 1_000_000);
    const parts = t.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('v1');
    expect(t).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('署名は HMAC-SHA256(鍵, "v1." + 中身の部分)', () => {
    const t = signAppPass(KEY, claims, 1_000_000);
    const [, body, sig] = t.split('.');
    const expected = crypto.createHmac('sha256', KEY).update(`v1.${body}`).digest();
    expect(b64urlDecode(sig).equals(expected)).toBe(true);
  });

  it('中身は v / aud / room / sub / name / to / iat / exp、期限は 2 分', () => {
    const t = signAppPass(KEY, claims, 1_000_000);
    const payload = JSON.parse(b64urlDecode(t.split('.')[1]).toString('utf8'));
    expect(payload).toEqual({ v: 1, ...claims, iat: 1_000_000, exp: 1_000_000 + 120 });
    expect(APP_PASS_TTL_SEC).toBe(120);
  });

  it('別の鍵で計算した署名とは一致しない', () => {
    const t = signAppPass(KEY, claims, 1_000_000);
    const [, body, sig] = t.split('.');
    const other = crypto.createHmac('sha256', Buffer.alloc(32, 1)).update(`v1.${body}`).digest();
    expect(b64urlDecode(sig).equals(other)).toBe(false);
  });
});

describe('passTarget', () => {
  it('https の URL から origin・ホスト名・行き先 (パス + 問い合わせ) を取る', () => {
    expect(passTarget('https://Example.com/close/qrpos/?pmode=tana#top')).toEqual({
      origin: 'https://example.com', host: 'example.com', to: '/close/qrpos/?pmode=tana', hash: '#top',
    });
  });

  it('パスが無い URL の行き先は /', () => {
    expect(passTarget('https://example.com')).toEqual({ origin: 'https://example.com', host: 'example.com', to: '/', hash: '' });
  });

  it('http: や壊れた URL には出さない', () => {
    expect(passTarget('http://example.com/close/')).toBeNull();
    expect(passTarget('not a url')).toBeNull();
    expect(passTarget('javascript:alert(1)')).toBeNull();
  });
});

describe('buildGateUrl', () => {
  it('入口 /tealus-gate/ に通行証を付け、アプリのハッシュを末尾に保つ', () => {
    const t = 'v1.abc.def';
    expect(buildGateUrl({ origin: 'https://example.com', host: 'example.com', to: '/x', hash: '#top' }, t))
      .toBe('https://example.com/tealus-gate/?tealus_pass=v1.abc.def#top');
  });
});

describe('loadAppPassKey', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apppass-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('<ホスト名>.key の 16 進を読む (前後の空白・改行は無視)', () => {
    fs.writeFileSync(path.join(dir, 'example.com.key'), `  ${KEY.toString('hex')}\r\n`);
    expect(loadAppPassKey('example.com', dir)?.equals(KEY)).toBe(true);
  });

  it('ファイルが無ければ null (= そのサイトとは取り決めが無い)', () => {
    expect(loadAppPassKey('example.com', dir)).toBeNull();
  });

  it('32 バイトに足りない鍵・16 進でない鍵は使わない', () => {
    fs.writeFileSync(path.join(dir, 'short.example.key'), 'abcd');
    fs.writeFileSync(path.join(dir, 'bad.example.key'), 'zz'.repeat(32));
    expect(loadAppPassKey('short.example', dir)).toBeNull();
    expect(loadAppPassKey('bad.example', dir)).toBeNull();
  });

  it('★ ホスト名に区切り文字があれば、ファイルを探しに行かない (置き場の外を読ませない)', () => {
    fs.writeFileSync(path.join(dir, 'x.key'), KEY.toString('hex'));
    expect(loadAppPassKey('../x', dir)).toBeNull();
    expect(loadAppPassKey('a/b', dir)).toBeNull();
    expect(loadAppPassKey('a\\b', dir)).toBeNull();
  });
});
