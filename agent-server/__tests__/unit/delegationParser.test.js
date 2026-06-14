/**
 * #295: `%` 委譲構文パーサ テスト (Red)
 *
 * 仕様:
 *   - 先頭 `%` (先行空白は許容) を委譲 trigger とする。先頭 `%` でなければ null (= 委譲でない)。
 *   - `%<room名> <task>`。room 名は既知 room 一覧に対する「最長一致」で確定する。
 *     room 名の直後は空白または文末でなければならない (= 途中一致での誤分割を防ぐ)。
 *   - 解決できた → { ok: true, room: { id, name }, task }
 *   - 先頭 `%` だが解決不能 → { ok: false, reason } (silent fail せず委譲元へ返すため)
 *       reason: 'room_not_found' | 'empty_task' | 'ambiguous'
 */
const { parseDelegation } = require('../../src/webhook/delegationParser');

const ROOMS = [
  { id: 'r-db', name: '社内DB検索' },
  { id: 'r-test', name: 'テスト（自動)' },
  { id: 'r-ono', name: '小野哲 ↔ アシスタント' },
  { id: 'r-sales', name: '営業' },
  { id: 'r-sales-dept', name: '営業部' },
];

describe('parseDelegation (#295 `%` 委譲構文)', () => {
  test('先頭が % でない通常メッセージは null (委譲でない)', () => {
    expect(parseDelegation('売上を集計して', ROOMS)).toBeNull();
    expect(parseDelegation('進捗は50%です', ROOMS)).toBeNull();
    expect(parseDelegation('@アシスタント やあ', ROOMS)).toBeNull();
  });

  test('基本: %<room> <task> を分解する', () => {
    const r = parseDelegation('%社内DB検索 売上を集計して結果を教えて', ROOMS);
    expect(r).toEqual({
      ok: true,
      room: { id: 'r-db', name: '社内DB検索' },
      task: '売上を集計して結果を教えて',
    });
  });

  test('room 名にスペースを含む場合も最長一致で確定する', () => {
    const r = parseDelegation('%小野哲 ↔ アシスタント やあ', ROOMS);
    expect(r.ok).toBe(true);
    expect(r.room.id).toBe('r-ono');
    expect(r.task).toBe('やあ');
  });

  test('最長一致: 営業 と 営業部 があれば長い方を選ぶ', () => {
    const r = parseDelegation('%営業部 今月の数字', ROOMS);
    expect(r.ok).toBe(true);
    expect(r.room.id).toBe('r-sales-dept');
    expect(r.task).toBe('今月の数字');
  });

  test('短い room 名も空白区切りなら正しく選ぶ', () => {
    const r = parseDelegation('%営業 今月の数字', ROOMS);
    expect(r.ok).toBe(true);
    expect(r.room.id).toBe('r-sales');
    expect(r.task).toBe('今月の数字');
  });

  test('先行空白があっても認識する', () => {
    const r = parseDelegation('   %社内DB検索 集計して', ROOMS);
    expect(r.ok).toBe(true);
    expect(r.room.id).toBe('r-db');
    expect(r.task).toBe('集計して');
  });

  test('task 前後の余分な空白は trim する', () => {
    const r = parseDelegation('%社内DB検索    集計して   ', ROOMS);
    expect(r.ok).toBe(true);
    expect(r.task).toBe('集計して');
  });

  test('未登録 room は room_not_found', () => {
    const r = parseDelegation('%存在しない部屋 なにか', ROOMS);
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'room_not_found' }));
  });

  test('room 名直後が空白でない (区切り無し) は誤分割せず room_not_found', () => {
    // '社内DB検索' は prefix だが直後が '売' で区切りが無い → clean match ではない
    const r = parseDelegation('%社内DB検索売上を集計', ROOMS);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('room_not_found');
  });

  test('room 名のみ (task 無し) は empty_task', () => {
    expect(parseDelegation('%社内DB検索', ROOMS).reason).toBe('empty_task');
    expect(parseDelegation('%社内DB検索    ', ROOMS).reason).toBe('empty_task');
  });

  test('% 単体は room_not_found (空文字に一致する room は無い)', () => {
    const r = parseDelegation('%', ROOMS);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('room_not_found');
  });

  test('同名 room が複数あれば ambiguous', () => {
    const dupRooms = [
      { id: 'r-1', name: '共有' },
      { id: 'r-2', name: '共有' },
    ];
    const r = parseDelegation('%共有 これ', dupRooms);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ambiguous');
  });

  test('rooms が空配列なら room_not_found', () => {
    const r = parseDelegation('%社内DB検索 集計', []);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('room_not_found');
  });

  test('不正入力 (null / 非文字列) は null', () => {
    expect(parseDelegation(null, ROOMS)).toBeNull();
    expect(parseDelegation(undefined, ROOMS)).toBeNull();
    expect(parseDelegation(123, ROOMS)).toBeNull();
  });
});
