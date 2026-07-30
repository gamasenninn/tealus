/**
 * #354 エージェント指示の履歴 API
 *
 * GET /api/rooms/:id/prompts/history?targets=アシスタント,cc-tealus&limit=30
 *
 * 「登録ゼロ」で過去の指示を再利用するための読み取り専用 API。新テーブルは持たず
 * messages を読むだけ。cc project 一覧は agent-server 側にあり本体 server は知らない
 * ため、宛先リストは client から targets= で渡してもらいサーバ側で絞る。
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const TARGETS = 'アシスタント,cc-tealus';

describe('Prompt History API', () => {
  let user1: TestUser, user2: TestUser, roomId: string, otherRoomId: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;

    const otherRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: '別ルーム', member_ids: [] });
    otherRoomId = otherRes.body.room.id;
  });

  /** メッセージを投稿して id を返す */
  async function send(token: string, room: string, content: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await request(app)
      .post(`/api/rooms/${room}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content, ...extra });
    return res.body.message.id;
  }

  /** 並び順テスト用に created_at を決定的に固定する (now() の同一 μ秒衝突を避ける) */
  async function setCreatedAt(messageId: string, iso: string): Promise<void> {
    await getTestPool().query('UPDATE messages SET created_at = $1 WHERE id = $2', [iso, messageId]);
  }

  function get(token: string, room: string, query = `targets=${encodeURIComponent(TARGETS)}`) {
    return request(app)
      .get(`/api/rooms/${room}/prompts/history?${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  // ============================================
  // 基本
  // ============================================
  describe('抽出', () => {
    it('自分の @アシスタント 宛メッセージを返す', async () => {
      await send(user1.token, roomId, '@アシスタント 直近24hをまとめて');

      const res = await get(user1.token, roomId);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].target).toBe('アシスタント');
      expect(res.body.items[0].body).toBe('直近24hをまとめて');
      // 表示 = 挿入される文字列。content は宛先込みの全文をそのまま返す
      expect(res.body.items[0].content).toBe('@アシスタント 直近24hをまとめて');
    });

    it('@cc-* 宛メッセージも返す', async () => {
      await send(user1.token, roomId, '@cc-tealus tsc --noEmit を通して');

      const res = await get(user1.token, roomId);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].target).toBe('cc-tealus');
      expect(res.body.items[0].body).toBe('tsc --noEmit を通して');
    });

    it('targets に無い宛先 (人間へのメンション) は返さない', async () => {
      await send(user1.token, roomId, '@鈴木花子 これ見ておいて');
      await send(user1.token, roomId, '@アシスタント 要約して');

      const res = await get(user1.token, roomId);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].target).toBe('アシスタント');
    });

    it('メンションで始まらないメッセージは返さない', async () => {
      await send(user1.token, roomId, 'おはようございます');
      await send(user1.token, roomId, 'これは @アシスタント への依頼ではない');

      const res = await get(user1.token, roomId);

      expect(res.body.items).toHaveLength(0);
    });

    it('宛先のみで本文が無いものは返さない (指示として再利用できないため)', async () => {
      await send(user1.token, roomId, '@アシスタント');
      await send(user1.token, roomId, '@アシスタント   ');

      const res = await get(user1.token, roomId);

      expect(res.body.items).toHaveLength(0);
    });

    it('他人のメッセージは返さない', async () => {
      await send(user2.token, roomId, '@アシスタント 鈴木さんの指示');
      await send(user1.token, roomId, '@アシスタント 田中の指示');

      const res = await get(user1.token, roomId);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].body).toBe('田中の指示');
    });

    it('他ルームのメッセージは返さない (このルームのみ)', async () => {
      await send(user1.token, otherRoomId, '@アシスタント 別ルームの指示');
      await send(user1.token, roomId, '@アシスタント このルームの指示');

      const res = await get(user1.token, roomId);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].body).toBe('このルームの指示');
    });

    // #354 実データ調査で判明: organon/kairos のフォーム回答は 1 日 1-2 件出て各 200-400 字。
    // 混ざると履歴パネルの上半分が一回きりの回答文で埋まり、実際に再利用したい定型
    // (「朝のバッチを回そう」等) が押し下げられる。
    //
    // 現状これらが漏れていないのは buildAnswerText (client/src/utils/parseForm.ts) が
    // 宛先を単独行に置く = メンション直後が改行、という偶然に依っている。組み立てが
    // スペース区切りに変わった瞬間に漏れ出すので、意図として固定する。
    //
    // 「フォーム回答」の定義は hasUserAnsweredForm と揃える:
    // reply_to がフォーム、かつ本文に 【回答】 を含む。
    describe('フォーム回答', () => {
      /** フォーム本体を投稿して id を返す */
      async function sendForm(token: string, room: string): Promise<string> {
        return send(token, room, '📋 Day80 Q0\n\n```tealus-form\n{"version":1}\n```', { type: 'form' });
      }

      it('宛先が単独行のフォーム回答は返さない (現行の buildAnswerText 形式)', async () => {
        const formId = await sendForm(user1.token, roomId);
        await send(user1.token, roomId, '@アシスタント\n\n【回答】Day80 Q0\n設問1: はい', { reply_to: formId });

        const res = await get(user1.token, roomId);

        expect(res.body.items).toHaveLength(0);
      });

      it('宛先がスペース区切りでもフォーム回答は返さない (組み立てが変わっても漏れない)', async () => {
        const formId = await sendForm(user1.token, roomId);
        await send(user1.token, roomId, '@アシスタント 【回答】Day80 Q0\n設問1: はい', { reply_to: formId });

        const res = await get(user1.token, roomId);

        expect(res.body.items).toHaveLength(0);
      });

      it('フォーム回答は target_counts にも数えない', async () => {
        const formId = await sendForm(user1.token, roomId);
        await send(user1.token, roomId, '@アシスタント 【回答】Day80 Q0\n設問1: はい', { reply_to: formId });

        const res = await get(user1.token, roomId);

        expect(res.body.target_counts).toEqual({});
      });

      it('フォームへのコメント返信で出した指示は返す (回答ではないため)', async () => {
        const formId = await sendForm(user1.token, roomId);
        await send(user1.token, roomId, '@アシスタント このフォームを作り直して', { reply_to: formId });

        const res = await get(user1.token, roomId);

        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].body).toBe('このフォームを作り直して');
      });

      it('フォーム以外への返信は 【回答】 を含んでいても返す (誤爆させない)', async () => {
        const target = await send(user1.token, roomId, '普通のメッセージ');
        await send(user1.token, roomId, '@アシスタント 【回答】と書いてあるだけの普通の指示', { reply_to: target });

        const res = await get(user1.token, roomId);

        expect(res.body.items).toHaveLength(1);
      });

      it('返信でない通常の指示は当然返す', async () => {
        await send(user1.token, roomId, '@アシスタント 朝のバッチを回そう');

        const res = await get(user1.token, roomId);

        expect(res.body.items).toHaveLength(1);
      });
    });

    it('削除済みメッセージは返さない', async () => {
      const id = await send(user1.token, roomId, '@アシスタント 消した指示');
      await request(app)
        .delete(`/api/rooms/${roomId}/messages/${id}`)
        .set('Authorization', `Bearer ${user1.token}`);

      const res = await get(user1.token, roomId);

      expect(res.body.items).toHaveLength(0);
    });
  });

  // ============================================
  // 重複除去
  // ============================================
  describe('重複除去', () => {
    it('同じ文面は最新の1件にまとめる', async () => {
      const older = await send(user1.token, roomId, '@アシスタント 要約して');
      const newer = await send(user1.token, roomId, '@アシスタント 要約して');
      await setCreatedAt(older, '2026-07-01T00:00:00Z');
      await setCreatedAt(newer, '2026-07-02T00:00:00Z');

      const res = await get(user1.token, roomId);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].message_id).toBe(newer);
    });

    it('前後の空白と連続空白の違いは同一文面とみなす', async () => {
      await send(user1.token, roomId, '@アシスタント 要約して');
      await send(user1.token, roomId, '@アシスタント  要約して  ');

      const res = await get(user1.token, roomId);

      expect(res.body.items).toHaveLength(1);
    });

    it('宛先が違えば別扱いにする', async () => {
      await send(user1.token, roomId, '@アシスタント 要約して');
      await send(user1.token, roomId, '@cc-tealus 要約して');

      const res = await get(user1.token, roomId);

      expect(res.body.items).toHaveLength(2);
    });
  });

  // ============================================
  // 並び順・件数
  // ============================================
  describe('並び順と件数', () => {
    it('新しい順で返す (表示側で反転する既存の messages API と同じ約束)', async () => {
      const a = await send(user1.token, roomId, '@アシスタント 古い指示');
      const b = await send(user1.token, roomId, '@アシスタント 中くらいの指示');
      const c = await send(user1.token, roomId, '@アシスタント 新しい指示');
      await setCreatedAt(a, '2026-07-01T00:00:00Z');
      await setCreatedAt(b, '2026-07-02T00:00:00Z');
      await setCreatedAt(c, '2026-07-03T00:00:00Z');

      const res = await get(user1.token, roomId);

      expect(res.body.items.map((i: { body: string }) => i.body)).toEqual([
        '新しい指示', '中くらいの指示', '古い指示',
      ]);
    });

    it('limit で件数を絞れる', async () => {
      const a = await send(user1.token, roomId, '@アシスタント 指示1');
      const b = await send(user1.token, roomId, '@アシスタント 指示2');
      const c = await send(user1.token, roomId, '@アシスタント 指示3');
      await setCreatedAt(a, '2026-07-01T00:00:00Z');
      await setCreatedAt(b, '2026-07-02T00:00:00Z');
      await setCreatedAt(c, '2026-07-03T00:00:00Z');

      const res = await get(user1.token, roomId, `targets=${encodeURIComponent(TARGETS)}&limit=2`);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].body).toBe('指示3');
    });
  });

  // ============================================
  // 宛先チップの並び (頻度順)
  // ============================================
  describe('target_counts', () => {
    it('宛先ごとの使用回数を返す (チップ列を頻度順に並べるため)', async () => {
      await send(user1.token, roomId, '@アシスタント 指示1');
      await send(user1.token, roomId, '@アシスタント 指示2');
      await send(user1.token, roomId, '@cc-tealus 指示3');

      const res = await get(user1.token, roomId);

      expect(res.body.target_counts).toEqual({ 'アシスタント': 2, 'cc-tealus': 1 });
    });

    it('回数は重複除去前で数える (同じ指示を繰り返すほどよく使う宛先)', async () => {
      await send(user1.token, roomId, '@アシスタント 要約して');
      await send(user1.token, roomId, '@アシスタント 要約して');
      await send(user1.token, roomId, '@cc-tealus ビルドして');

      const res = await get(user1.token, roomId);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.target_counts).toEqual({ 'アシスタント': 2, 'cc-tealus': 1 });
    });

    it('一度も使っていない宛先は含めない (client 側の宛先一覧と突き合わせる)', async () => {
      await send(user1.token, roomId, '@アシスタント 指示1');

      const res = await get(user1.token, roomId);

      expect(res.body.target_counts).toEqual({ 'アシスタント': 1 });
    });
  });

  // ============================================
  // 入力検証・アクセス制御
  // ============================================
  describe('検証とアクセス制御', () => {
    it('targets 未指定は 400', async () => {
      const res = await get(user1.token, roomId, '');
      expect(res.status).toBe(400);
    });

    it('targets が空文字は 400', async () => {
      const res = await get(user1.token, roomId, 'targets=');
      expect(res.status).toBe(400);
    });

    it('非メンバーは 403', async () => {
      const res = await get(user2.token, otherRoomId);
      expect(res.status).toBe(403);
    });

    it('未認証は 401', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/prompts/history?targets=${encodeURIComponent(TARGETS)}`);
      expect(res.status).toBe(401);
    });

    it('宛先名に LIKE のワイルドカードが含まれても素の文字列として扱う', async () => {
      await send(user1.token, roomId, '@アシスタント 要約して');

      // '%' が任意文字列として効いてしまうと上の1件が漏れる
      const res = await get(user1.token, roomId, `targets=${encodeURIComponent('%')}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
    });
  });
});
