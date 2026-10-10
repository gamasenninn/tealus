/**
 * #564 会話モードでも、AI が読める部屋を「会話している人が入っている部屋」に絞る。
 * ★ 会話モードは道具を agent-server の中で使い回す (立ち上がりを速くするため) ので、道具を呼ぶ手前で絞る
 */
import { requesterRoomIds, scopeToolArgs, filterListRooms } from '../../src/lib/voiceChatRequesterScope.mts';

const CUR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HIDDEN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const known = new Set([CUR, OTHER]);

describe('requesterRoomIds', () => {
  it('bot と会話している人の両方が入っている部屋を返す', async () => {
    const q = jest.fn(async (_sql: string, _params: unknown[]) => ({ rows: [{ room_id: CUR }, { room_id: OTHER }] }));
    expect(await requesterRoomIds({ query: q }, 'BOT_LOGIN', 'user-1', CUR)).toEqual(known);
    expect(q.mock.calls[0][1]).toEqual(['BOT_LOGIN', 'user-1']);
  });
  it('★ 引けなければ今の部屋だけ (広げる側に倒さない)', async () => {
    const q = jest.fn(async () => { throw new Error('db down'); });
    expect(await requesterRoomIds({ query: q }, 'BOT_LOGIN', 'user-1', CUR)).toEqual(new Set([CUR]));
  });
});

describe('scopeToolArgs', () => {
  const noMsg = async () => null;
  it('★ 部屋の指定が無い検索は、今の部屋に絞る', async () => {
    const r = await scopeToolArgs('search_messages', { q: '朝礼' }, { currentRoomId: CUR, known, messageRoomOf: noMsg });
    expect(r).toEqual({ ok: true, args: { q: '朝礼', room_id: CUR } });
  });
  it('部屋の指定がある検索はそのまま (部屋の確かめは resolveRoomArg が行う)', async () => {
    const r = await scopeToolArgs('search_messages', { q: 'x', room_id: OTHER }, { currentRoomId: CUR, known, messageRoomOf: noMsg });
    expect(r).toEqual({ ok: true, args: { q: 'x', room_id: OTHER } });
  });
  it('★ 投稿の ID の部屋が知っている部屋でなければ、呼ばずに返す', async () => {
    const r = await scopeToolArgs('get_message_media', { message_id: 'm1' }, { currentRoomId: CUR, known, messageRoomOf: async () => HIDDEN });
    expect(r.ok).toBe(false);
  });
  it('投稿の ID の部屋が知っている部屋なら通す (無い投稿は道具の返事に任せる)', async () => {
    expect((await scopeToolArgs('read_document', { message_id: 'm1' }, { currentRoomId: CUR, known, messageRoomOf: async () => OTHER })).ok).toBe(true);
    expect((await scopeToolArgs('read_document', { message_id: 'm1' }, { currentRoomId: CUR, known, messageRoomOf: noMsg })).ok).toBe(true);
  });
});

describe('filterListRooms', () => {
  it('★ 部屋の一覧を、知っている部屋だけに減らす', () => {
    const result = { content: [{ type: 'text', text: JSON.stringify({ rooms: [{ id: CUR }, { id: HIDDEN }, { id: OTHER }] }) }] };
    const out = filterListRooms(result, known) as typeof result;
    expect(JSON.parse(out.content[0].text).rooms.map((r: { id: string }) => r.id)).toEqual([CUR, OTHER]);
  });
  it('読めない形ならそのまま返さず、空の一覧にする (広げる側に倒さない)', () => {
    const out = filterListRooms({ content: [{ type: 'text', text: 'not json' }] }, known) as { content: { text: string }[] };
    expect(JSON.parse(out.content[0].text)).toEqual({ rooms: [] });
  });
});
