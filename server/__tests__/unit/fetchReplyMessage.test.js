const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');

// Import after DB setup
let fetchReplyMessage;

describe('fetchReplyMessage', () => {
  let pool;

  beforeAll(async () => {
    await setupTestDb();
    pool = getTestPool();
    fetchReplyMessage = require('../../src/socket/handlers/message').fetchReplyMessage;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
  });

  async function createUser(employeeId, displayName) {
    const result = await pool.query(
      `INSERT INTO users (employee_id, display_name, password_hash)
       VALUES ($1, $2, 'dummy') RETURNING id, display_name`,
      [employeeId, displayName]
    );
    return result.rows[0];
  }

  async function createRoom(userId) {
    const result = await pool.query(
      `INSERT INTO rooms (type, name, created_by) VALUES ('group', 'test', $1) RETURNING id`,
      [userId]
    );
    await pool.query(
      `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [result.rows[0].id, userId]
    );
    return result.rows[0].id;
  }

  it('should return null for non-existent message', async () => {
    const result = await fetchReplyMessage('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('should return text message with sender info', async () => {
    const user = await createUser('EMP001', '田中太郎');
    const roomId = await createRoom(user.id);

    const msg = await pool.query(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, 'テスト', 'text') RETURNING id`,
      [roomId, user.id]
    );

    const result = await fetchReplyMessage(msg.rows[0].id);
    expect(result).not.toBeNull();
    expect(result.content).toBe('テスト');
    expect(result.sender_display_name).toBe('田中太郎');
    expect(result.type).toBe('text');
  });

  it('should return voice message with transcription text as content', async () => {
    const user = await createUser('EMP002', '鈴木花子');
    const roomId = await createRoom(user.id);

    const msg = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type) VALUES ($1, $2, 'voice') RETURNING id`,
      [roomId, user.id]
    );

    await pool.query(
      `INSERT INTO voice_transcriptions (message_id, version, raw_text, formatted_text, status)
       VALUES ($1, 1, '生のテキスト', '整形済みテキスト', 'done')`,
      [msg.rows[0].id]
    );

    const result = await fetchReplyMessage(msg.rows[0].id);
    expect(result).not.toBeNull();
    expect(result.content).toBe('整形済みテキスト');
    expect(result.type).toBe('voice');
  });

  it('should use raw_text when formatted_text is null', async () => {
    const user = await createUser('EMP003', '五条悟');
    const roomId = await createRoom(user.id);

    const msg = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type) VALUES ($1, $2, 'voice') RETURNING id`,
      [roomId, user.id]
    );

    await pool.query(
      `INSERT INTO voice_transcriptions (message_id, version, raw_text, status)
       VALUES ($1, 1, '生のテキストのみ', 'done')`,
      [msg.rows[0].id]
    );

    const result = await fetchReplyMessage(msg.rows[0].id);
    expect(result.content).toBe('生のテキストのみ');
  });

  it('should return latest version of transcription', async () => {
    const user = await createUser('EMP004', '佐藤次郎');
    const roomId = await createRoom(user.id);

    const msg = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type) VALUES ($1, $2, 'voice') RETURNING id`,
      [roomId, user.id]
    );

    await pool.query(
      `INSERT INTO voice_transcriptions (message_id, version, formatted_text, status) VALUES ($1, 1, '初版', 'done')`,
      [msg.rows[0].id]
    );
    await pool.query(
      `INSERT INTO voice_transcriptions (message_id, version, formatted_text, status) VALUES ($1, 2, '修正版', 'done')`,
      [msg.rows[0].id]
    );

    const result = await fetchReplyMessage(msg.rows[0].id);
    expect(result.content).toBe('修正版');
  });
});
