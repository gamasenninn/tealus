/**
 * CC ブリッジの受け付けを本体へ (#650、docs/14、2026-11-23)
 *
 * ★ CC_INTAKE=server のときだけ本体が受け箱に書く。未設定なら何も書かない (今までどおり agent-server が書く)
 * ★ 1 行の形は agent-server と同じ (docs/12 §4.1)。agent-server の ccQueueLineContract.test.mts の約束をここでも固定する
 * ★ 判定 (ゲスト・送り主の除外・同報・編集で足した宛先・持ち主の札) は agent-server の handlerCc*.test.mts から
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { _resetCcSkipSenderIds, addCcSkipSenderId, learnAssistantSender, checkAgentIntake, warnIfAliasesNotCarried } from '../../src/services/cc/ccIntake.mts';
import { logger } from '../../src/utils/logger.mts';
import { _resetLineCounts } from '../../src/services/cc/ccQueue.mts';
import { WRITER_FILE, releaseWriter } from '../../src/services/cc/ccWriter.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

/** docs/12 §4.1 の id の形と鍵の集合 (agent-server の ccQueueLineContract.test.mts と同じ) */
const QUEUE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LINE_KEYS = ['content', 'created_at', 'id', 'recipients', 'room_id', 'room_name', 'sender', 'type'];
const SENDER_KEYS = ['display_name', 'id', 'role'];

const ORIG_DIR = process.env.CC_QUEUE_DIR;
let dir: string;
let human: TestUser, other: TestUser;

const file = (project: string) => path.join(dir, `${project}.jsonl`);
const lines = (project: string) => (fs.existsSync(file(project))
  ? fs.readFileSync(file(project), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
  : []);
/** 受け付けは待たずに投げるので、行が入るまで待つ (入らないことを確かめるときは短く待ってから見る) */
async function settle(ms = 300): Promise<void> { await new Promise((r) => setTimeout(r, ms)); }
async function waitLines(project: string, n: number): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < 50; i++) {
    const l = lines(project);
    if (l.length >= n) return l;
    await settle(40);
  }
  return lines(project);
}

async function group(name = '業務メモ'): Promise<string> {
  const res = await request(app).post('/api/rooms').set('Authorization', `Bearer ${human.token}`)
    .send({ name, member_ids: [other.user.id] });
  return res.body.room.id as string;
}
async function post(u: TestUser, roomId: string, content: string): Promise<string> {
  const res = await request(app).post('/api/bot/push').set('Authorization', `Bearer ${u.token}`).send({ room_id: roomId, content });
  expect(res.status).toBe(201);
  return res.body.message.id as string;
}

beforeAll(async () => { await setupTestDb(); });
afterAll(async () => { await closeTestDb(); process.env.CC_QUEUE_DIR = ORIG_DIR; });
beforeEach(async () => {
  await cleanTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-intake-'));
  process.env.CC_QUEUE_DIR = dir;
  process.env.CC_INTAKE = 'server';
  delete process.env.CC_SKIP_SENDER_IDS;
  _resetCcSkipSenderIds();
  _resetLineCounts();
  human = await createTestUser({ login_id: 'EMP001', display_name: '田中' });
  other = await createTestUser({ login_id: 'EMP002', display_name: '鈴木' });
});
afterEach(() => {
  delete process.env.CC_INTAKE;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('★ テストの隔離 (docs/14 §10)', () => {
  it('★★ テスト中の受け箱は本番の ~/.tealus/cc-queue ではない (jest.setup.js が一時フォルダに向ける)', () => {
    const prod = path.join(os.homedir(), '.tealus', 'cc-queue');
    expect(ORIG_DIR).toBeTruthy();
    expect(path.resolve(String(ORIG_DIR))).not.toBe(path.resolve(prod));
    expect(process.env.CC_ALIASES_FILE).toBeTruthy();
    expect(String(process.env.CC_ALIASES_FILE)).not.toContain(path.join('server', 'config'));
  });
});

describe('CC_INTAKE の切り替え', () => {
  it('★★ 未設定なら本体は書かない (今までどおり agent-server が受け付ける)', async () => {
    delete process.env.CC_INTAKE;
    const roomId = await group();
    await post(human, roomId, '@cc-tealus 見てください');
    await settle();
    expect(lines('tealus')).toHaveLength(0);
  });

  it('★★ CC_INTAKE=server なら本体が書く。1 行の形は docs/12 §4.1 のとおり', async () => {
    const roomId = await group();
    const id = await post(human, roomId, '@cc-tealus 見てください');
    const [line] = await waitLines('tealus', 1);
    expect(Object.keys(line).sort()).toEqual(LINE_KEYS);
    expect(Object.keys(line.sender as object).sort()).toEqual(SENDER_KEYS);
    expect(line.id).toBe(id);
    expect(line.id).toMatch(QUEUE_ID_RE);
    expect(line.room_id).toBe(roomId);
    expect(line.room_name).toBe('業務メモ');
    expect(line.sender).toEqual({ id: human.user.id, display_name: '田中', role: 'user' });
    expect(line.content).toBe('@cc-tealus 見てください');
    expect(line.type).toBe('text');
    expect(line.recipients).toEqual(['tealus']);
    expect(typeof line.created_at).toBe('string');
  });

  it('宛先の無い投稿は書かない', async () => {
    const roomId = await group();
    await post(human, roomId, 'お疲れさまです @cc-tealus');
    await settle();
    expect(lines('tealus')).toHaveLength(0);
  });
});

describe('判定 (agent-server の handlerCc* から写した)', () => {
  it('★ #387 1 行目の先頭に並べた宛先には全部配る。recipients に全体を載せる', async () => {
    const roomId = await group();
    await post(human, roomId, '@cc-tealus @cc-organon 両方へ');
    const [a] = await waitLines('tealus', 1);
    const [b] = await waitLines('organon', 1);
    expect(a.recipients).toEqual(['tealus', 'organon']);
    expect(b.id).toBe(a.id);
  });

  it('★ #491 ゲストの便は配らない', async () => {
    const roomId = await group();
    await getTestPool().query("UPDATE users SET role = 'guest' WHERE id = $1", [other.user.id]);
    await post(other, roomId, '@cc-tealus 外の人から');
    await settle();
    expect(lines('tealus')).toHaveLength(0);
  });

  it('★ 送り主の除外 (CC_SKIP_SENDER_IDS) の便は配らない', async () => {
    const roomId = await group();
    process.env.CC_SKIP_SENDER_IDS = `x, ${other.user.id}`;
    await post(other, roomId, '@cc-tealus 自分の返事');
    await settle();
    expect(lines('tealus')).toHaveLength(0);
  });

  it('★★ アシスタントは班を起こせない (docs/14 §11 の 1)。口座は agent-server に聞いて足す', async () => {
    const roomId = await group();
    const fakeFetch = (async () => new Response(JSON.stringify({ user_id: other.user.id, display_name: 'アシスタント' }), { status: 200 })) as typeof fetch;
    expect(await learnAssistantSender('http://agent.invalid', 'tok', fakeFetch)).toBe(other.user.id);
    await post(other, roomId, '@cc-tealus アシスタントから');
    await post(human, roomId, '@cc-tealus 人から');
    const l = await waitLines('tealus', 1);
    await settle();
    expect(lines('tealus')).toHaveLength(1);
    expect((l[0].sender as { id: string }).id).toBe(human.user.id);
  });

  it('アシスタントの口座を聞けなければ設定の値だけ (落ちない)', async () => {
    const failing = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    expect(await learnAssistantSender('http://agent.invalid', 'tok', failing)).toBeNull();
  });

  it('★ 1 対 1 の部屋は「A ↔ B」を部屋の名前にする (webhook と同じ)', async () => {
    const res = await request(app).post('/api/rooms/direct').set('Authorization', `Bearer ${human.token}`).send({ partner_id: other.user.id });
    const roomId = res.body.room.id as string;
    await post(human, roomId, '@cc-tealus 1 対 1 から');
    const [line] = await waitLines('tealus', 1);
    expect(String(line.room_name).split(' ↔ ').sort()).toEqual(['田中', '鈴木']);
  });
});

describe('編集で宛先を足した便 (#338 の救済)', () => {
  it('★★ 新しく足した班にだけ積む。形は新規と同じ (type・created_at・表示名が欠けない、§5.2)', async () => {
    const roomId = await group();
    const id = await post(human, roomId, '@cc-tealus はじめ');
    await waitLines('tealus', 1);
    const res = await request(app).put(`/api/rooms/${roomId}/messages/${id}`).set('Authorization', `Bearer ${human.token}`)
      .send({ content: '@cc-tealus @cc-organon はじめ' });
    expect(res.status).toBe(200);
    const [line] = await waitLines('organon', 1);
    await settle();
    expect(lines('tealus')).toHaveLength(1);   // 既に届いた班は 2 回起こさない
    expect(Object.keys(line).sort()).toEqual(LINE_KEYS);
    expect(line.id).toBe(id);
    expect(line.type).toBe('text');
    expect(line.sender).toEqual({ id: human.user.id, display_name: '田中', role: 'user' });
    expect(line.recipients).toEqual(['tealus', 'organon']);
  });
});

describe('★ 受け箱の持ち主の札 (docs/14 §6)', () => {
  it('★★ 同じ機械で生きている agent-server が札を持っていれば書かない', async () => {
    fs.writeFileSync(path.join(dir, WRITER_FILE), JSON.stringify({ process: 'agent-server', host: os.hostname(), pid: process.pid, started_at: 'x' }));
    const roomId = await group();
    await post(human, roomId, '@cc-tealus 書かれないはず');
    await settle();
    expect(lines('tealus')).toHaveLength(0);
  });

  it('★ 札の持ち主が死んでいれば取って書く', async () => {
    fs.writeFileSync(path.join(dir, WRITER_FILE), JSON.stringify({ process: 'agent-server', host: os.hostname(), pid: 2 ** 22 + 12345, started_at: 'x' }));
    const roomId = await group();
    await post(human, roomId, '@cc-tealus 取り返す');
    await waitLines('tealus', 1);
    expect(JSON.parse(fs.readFileSync(path.join(dir, WRITER_FILE), 'utf8')).process).toBe('server');
  });

  it('★ 別の機械の札は見ない (Syncthing で写ってきた札)', async () => {
    fs.writeFileSync(path.join(dir, WRITER_FILE), JSON.stringify({ process: 'agent-server', host: 'other-host', pid: process.pid, started_at: 'x' }));
    const roomId = await group();
    await post(human, roomId, '@cc-tealus 別の機械');
    expect(await waitLines('tealus', 1)).toHaveLength(1);
  });

  it('送り主の除外は札より前 (除外した便では札を取らない)', async () => {
    addCcSkipSenderId(human.user.id);
    const roomId = await group();
    await post(human, roomId, '@cc-tealus x');
    await settle();
    expect(fs.existsSync(path.join(dir, WRITER_FILE))).toBe(false);
  });
});

describe('★ 起動時の見張り (#650 の監査 2・7)', () => {
  const res = (status: number) => (async () => new Response('{}', { status })) as typeof fetch;

  it('★★ agent-server の /cc-queue/pending が 410 なら受け付けをやめている。それ以外は「まだ受け付けている」(両方が書く)', async () => {
    expect(await checkAgentIntake('http://agent.invalid', 't', res(410))).toBe('stopped');
    expect(await checkAgentIntake('http://agent.invalid', 't', res(401))).toBe('still-taking');
    expect(await checkAgentIntake('http://agent.invalid', 't', res(200))).toBe('still-taking');
    expect(await checkAgentIntake('http://agent.invalid', 't', (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch)).toBe('unreachable');
  });

  it('★ 別名の設定を本体へ写し忘れていたら warn (agent-server 側に別名があるときだけ)', () => {
    const saved = process.env.CC_ALIASES_FILE;
    const warn = jest.spyOn(logger, 'warn');
    try {
      delete process.env.CC_ALIASES_FILE;   // 既定の server/config/cc-aliases.json を見る (この repo には無い)
      const agentAliases = path.join(dir, 'agent-aliases.json');
      fs.writeFileSync(agentAliases, JSON.stringify({ aliases: [{ mention: 'Helper', project: 'x' }] }));
      warnIfAliasesNotCarried(agentAliases);
      expect(warn.mock.calls.map((c) => String(c[0])).some((s) => s.includes('別名の設定が本体にありません'))).toBe(true);
      warn.mockClear();
      fs.writeFileSync(agentAliases, JSON.stringify({ aliases: [] }));
      warnIfAliasesNotCarried(agentAliases);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      process.env.CC_ALIASES_FILE = saved;
      warn.mockRestore();
    }
  });

  it('★ releaseWriter は自分の役の札を PID によらず外す (前の自分が強制終了で残した札、監査 1)', () => {
    fs.writeFileSync(path.join(dir, WRITER_FILE), JSON.stringify({ process: 'server', host: os.hostname(), pid: 99999, started_at: 'x' }));
    releaseWriter(dir);
    expect(fs.existsSync(path.join(dir, WRITER_FILE))).toBe(false);
    fs.writeFileSync(path.join(dir, WRITER_FILE), JSON.stringify({ process: 'agent-server', host: os.hostname(), pid: 99999, started_at: 'x' }));
    releaseWriter(dir);
    expect(fs.existsSync(path.join(dir, WRITER_FILE))).toBe(true);
  });
});
