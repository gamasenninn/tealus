/**
 * cc-queue (Claude Code routing) ユニットテスト
 * #213 Phase A
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractCcProject, appendCcEvent } = require('../../src/webhook/ccQueue');

describe('extractCcProject', () => {
  test('@cc-{name} mention があれば project 名を返す', () => {
    expect(extractCcProject('@cc-tealus 進捗教えて')).toBe('tealus');
    expect(extractCcProject('hello @cc-life-line bye')).toBe('life-line');
    expect(extractCcProject('@cc-foo123')).toBe('foo123');
    expect(extractCcProject('@cc-multi-hyphen-name')).toBe('multi-hyphen-name');
  });

  test('@cc mention が無ければ null を返す', () => {
    expect(extractCcProject('hello world')).toBeNull();
    expect(extractCcProject('@AI please help')).toBeNull();
    expect(extractCcProject('@cc')).toBeNull(); // hyphen 無し
    expect(extractCcProject('@cc-')).toBeNull(); // project 名空
  });

  test('null / undefined / 空文字を安全に処理', () => {
    expect(extractCcProject('')).toBeNull();
    expect(extractCcProject(null)).toBeNull();
    expect(extractCcProject(undefined)).toBeNull();
  });

  test('複数 @cc mention があれば最初の 1 つを返す', () => {
    expect(extractCcProject('@cc-foo @cc-bar')).toBe('foo');
  });

  test('単語境界: メールアドレス内の偽 match を回避', () => {
    expect(extractCcProject('mailto:user@cc-test.com')).toBeNull();
    expect(extractCcProject('a@cc-test')).toBeNull();
  });

  test('英大文字は不可 (lowercase 規約)', () => {
    expect(extractCcProject('@cc-Tealus')).toBeNull();
    expect(extractCcProject('@cc-TEALUS')).toBeNull();
  });

  test('改行や前後 whitespace でも match', () => {
    expect(extractCcProject('foo\n@cc-tealus 進捗')).toBe('tealus');
    expect(extractCcProject('  @cc-tealus  ')).toBe('tealus');
  });
});

describe('appendCcEvent', () => {
  let testDir;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-queue-test-'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('project 用の jsonl file を作成して payload を 1 行 append する', () => {
    const filePath = appendCcEvent('tealus', { id: 'msg1', content: 'hello' }, testDir);

    expect(filePath).toBe(path.join(testDir, 'tealus.jsonl'));
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf8');
    expect(JSON.parse(content.trim())).toEqual({ id: 'msg1', content: 'hello' });
  });

  test('複数 append で行が順序通り保たれる', () => {
    appendCcEvent('tealus', { id: 'msg1' }, testDir);
    appendCcEvent('tealus', { id: 'msg2' }, testDir);
    appendCcEvent('tealus', { id: 'msg3' }, testDir);

    const lines = fs.readFileSync(path.join(testDir, 'tealus.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).id).toBe('msg1');
    expect(JSON.parse(lines[1]).id).toBe('msg2');
    expect(JSON.parse(lines[2]).id).toBe('msg3');
  });

  test('別 project は別 file に書く', () => {
    appendCcEvent('tealus', { id: 'msg1' }, testDir);
    appendCcEvent('life-line', { id: 'msg2' }, testDir);

    const tealus = fs.readFileSync(path.join(testDir, 'tealus.jsonl'), 'utf8');
    const lifeline = fs.readFileSync(path.join(testDir, 'life-line.jsonl'), 'utf8');
    expect(JSON.parse(tealus.trim()).id).toBe('msg1');
    expect(JSON.parse(lifeline.trim()).id).toBe('msg2');
  });

  test('project が空 / null なら例外を投げる', () => {
    expect(() => appendCcEvent('', {}, testDir)).toThrow();
    expect(() => appendCcEvent(null, {}, testDir)).toThrow();
    expect(() => appendCcEvent(undefined, {}, testDir)).toThrow();
  });

  test('queue dir が存在しない場合は再帰的に作成', () => {
    const newDir = path.join(testDir, 'sub', 'cc-queue');
    appendCcEvent('tealus', { id: 'msg1' }, newDir);

    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.existsSync(path.join(newDir, 'tealus.jsonl'))).toBe(true);
  });
});
