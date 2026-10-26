/**
 * 通話・トランシーバーの入口の守り (2026-10-26 小野さん判断、セキュリティチェックループの D)。
 * ★ 以前は鍵が無くても「名無し」で入れ、部屋のメンバーかも見ていなかった
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalUnproxied, checkRoomMember } from '../wsAccess.mts';

const req = (remote: string, headers: Record<string, string> = {}) =>
  ({ socket: { remoteAddress: remote }, headers }) as unknown as import('node:http').IncomingMessage;

test('★ 鍵なしで入れるのは、同じマシンから直接 (中継を通っていない) だけ', () => {
  assert.equal(isLocalUnproxied(req('127.0.0.1')), true);
  assert.equal(isLocalUnproxied(req('::1')), true);
  assert.equal(isLocalUnproxied(req('::ffff:127.0.0.1')), true);
});

test('★★ 本体の中継を通ったもの (外から) は、同じマシンからに見えても鍵なしでは入れない', () => {
  assert.equal(isLocalUnproxied(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.5' })), false);
  assert.equal(isLocalUnproxied(req('127.0.0.1', { 'cf-ray': 'abc' })), false);
  assert.equal(isLocalUnproxied(req('127.0.0.1', { 'x-real-ip': '203.0.113.5' })), false);
  assert.equal(isLocalUnproxied(req('127.0.0.1', { 'cf-connecting-ip': '203.0.113.5' })), false);
});

test('★★ 社内 LAN の別のマシンからは鍵なしでは入れない', () => {
  assert.equal(isLocalUnproxied(req('192.168.1.20')), false);
  assert.equal(isLocalUnproxied(req('10.231.0.2')), false);
});

test('★★ メンバーかどうかは本体に聞く: 200 なら入れる、それ以外は断る', async () => {
  const calls: string[] = [];
  const ok = async (url: string, init?: RequestInit) => { calls.push(`${url} ${(init?.headers as Record<string, string>).Authorization}`); return new Response('{}', { status: 200 }); };
  const ng = async () => new Response('{}', { status: 403 });
  const room = '11111111-1111-4111-8111-111111111111';
  assert.equal(await checkRoomMember('http://127.0.0.1:3000', 'tok', room, ok), true);
  assert.deepEqual(calls, [`http://127.0.0.1:3000/api/rooms/${room} Bearer tok`]);
  assert.equal(await checkRoomMember('http://127.0.0.1:3000', 'tok', room, ng), false);
});

test('★ 部屋の ID の形が違えば本体に聞かずに断る / 本体に届かなければ断る', async () => {
  let called = false;
  const f = async () => { called = true; return new Response('{}', { status: 200 }); };
  assert.equal(await checkRoomMember('http://x', 'tok', 'default', f), false);
  assert.equal(await checkRoomMember('http://x', 'tok', '../admin', f), false);
  assert.equal(called, false);
  const boom = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal(await checkRoomMember('http://x', 'tok', '11111111-1111-4111-8111-111111111111', boom), false);
});
