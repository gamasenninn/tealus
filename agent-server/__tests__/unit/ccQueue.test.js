/**
 * cc-queue (Claude Code routing) ユニットテスト
 * #213 Phase A
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractCcProject, appendCcEvent, shouldSkipCcSender, loadSkipSenderIds, getClaudeDefaultProject } = require('../../src/webhook/ccQueue');

describe('extractCcProject (先頭マッチング、#215)', () => {
  test('文字列の先頭にあれば match', () => {
    expect(extractCcProject('@cc-tealus 進捗教えて')).toBe('tealus');
    expect(extractCcProject('@cc-life-line')).toBe('life-line');
    expect(extractCcProject('@cc-foo123')).toBe('foo123');
    expect(extractCcProject('@cc-multi-hyphen-name')).toBe('multi-hyphen-name');
  });

  test('改行直後 (新しい行の先頭) なら match (multi-line)', () => {
    expect(extractCcProject('hello\n@cc-tealus 進捗')).toBe('tealus');
    expect(extractCcProject('line1\nline2\n@cc-foo')).toBe('foo');
  });

  test('文中 (先頭以外) なら null (#215 で挙動変更)', () => {
    expect(extractCcProject('hello @cc-tealus bye')).toBeNull();
    expect(extractCcProject('これも見て @cc-tealus')).toBeNull();
    expect(extractCcProject('  @cc-tealus  ')).toBeNull(); // 前に whitespace
  });

  test('複数 @cc mention があり、先頭のものが返る', () => {
    expect(extractCcProject('@cc-foo middle @cc-bar')).toBe('foo');
    expect(extractCcProject('not at start\n@cc-bar')).toBe('bar'); // 2 行目の先頭は match
  });

  test('hyphen 無し / project 名空は null', () => {
    expect(extractCcProject('@cc')).toBeNull();
    expect(extractCcProject('@cc-')).toBeNull();
  });

  test('別形式の mention は null', () => {
    expect(extractCcProject('hello world')).toBeNull();
    expect(extractCcProject('@AI please help')).toBeNull();
  });

  test('null / undefined / 空文字を安全に処理', () => {
    expect(extractCcProject('')).toBeNull();
    expect(extractCcProject(null)).toBeNull();
    expect(extractCcProject(undefined)).toBeNull();
  });

  test('mailto 偽 match を回避 (引き続き)', () => {
    expect(extractCcProject('mailto:user@cc-test.com')).toBeNull();
    expect(extractCcProject('a@cc-test')).toBeNull();
    expect(extractCcProject('user@cc-test')).toBeNull();
  });

  test('英大文字は不可 (lowercase 規約、引き続き)', () => {
    expect(extractCcProject('@cc-Tealus')).toBeNull();
    expect(extractCcProject('@cc-TEALUS')).toBeNull();
  });
});

describe('@Claude mention routing (#263)', () => {
  // 既存 cc-tealus bot の display_name "Claude" で mention picker から
  // 挿入される `@Claude` も @cc-{default-project} 同等に routing する
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_DEFAULT_PROJECT;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.CLAUDE_DEFAULT_PROJECT;
    else process.env.CLAUDE_DEFAULT_PROJECT = origEnv;
  });

  test('@Claude 行頭 → default project (tealus) に routing', () => {
    expect(extractCcProject('@Claude 進捗教えて')).toBe('tealus');
    expect(extractCcProject('@Claude README をレビュー')).toBe('tealus');
  });

  test('case-insensitive で受け付け', () => {
    expect(extractCcProject('@claude hello')).toBe('tealus');
    expect(extractCcProject('@CLAUDE hello')).toBe('tealus');
    expect(extractCcProject('@cLaUdE hello')).toBe('tealus');
  });

  test('改行直後の @Claude も match', () => {
    expect(extractCcProject('hello\n@Claude 進捗')).toBe('tealus');
  });

  test('文中 (先頭以外) なら null (#215 同 stance)', () => {
    expect(extractCcProject('hello @Claude bye')).toBeNull();
    expect(extractCcProject('  @Claude  ')).toBeNull();
  });

  test('@Claudeなんとか (続き字) は word boundary 違反で match しない', () => {
    expect(extractCcProject('@Claudette is different')).toBeNull();
    expect(extractCcProject('@Claudia hello')).toBeNull();
  });

  test('CLAUDE_DEFAULT_PROJECT env で override 可能', () => {
    process.env.CLAUDE_DEFAULT_PROJECT = 'myproj';
    expect(extractCcProject('@Claude hello')).toBe('myproj');
  });

  test('@cc-{project} と @Claude が共存する場合 cc- が優先', () => {
    expect(extractCcProject('@cc-foo bar @Claude')).toBe('foo');
  });

  test('@Claude 単独 (引数なし) でも match', () => {
    expect(extractCcProject('@Claude')).toBe('tealus');
  });
});

describe('getClaudeDefaultProject', () => {
  let origEnv;
  beforeEach(() => { origEnv = process.env.CLAUDE_DEFAULT_PROJECT; });
  afterEach(() => {
    if (origEnv === undefined) delete process.env.CLAUDE_DEFAULT_PROJECT;
    else process.env.CLAUDE_DEFAULT_PROJECT = origEnv;
  });

  test('env 未設定なら "tealus"', () => {
    delete process.env.CLAUDE_DEFAULT_PROJECT;
    expect(getClaudeDefaultProject()).toBe('tealus');
  });

  test('env 設定済なら env value', () => {
    process.env.CLAUDE_DEFAULT_PROJECT = 'myproj';
    expect(getClaudeDefaultProject()).toBe('myproj');
  });
});

describe('cc-aliases.json (Level 2 config file、#263 follow-up)', () => {
  // AGENT_CONFIG_DIR を tmp dir に向けて test isolation
  const { loadAliases, reloadAliases, getAliasesConfigPath } = require('../../src/webhook/ccQueue');
  let origConfigDir;
  let testConfigDir;

  beforeEach(() => {
    origConfigDir = process.env.AGENT_CONFIG_DIR;
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-aliases-test-'));
    process.env.AGENT_CONFIG_DIR = testConfigDir;
    reloadAliases();  // cache clear
  });

  afterEach(() => {
    if (origConfigDir === undefined) delete process.env.AGENT_CONFIG_DIR;
    else process.env.AGENT_CONFIG_DIR = origConfigDir;
    fs.rmSync(testConfigDir, { recursive: true, force: true });
    reloadAliases();  // cache clear
  });

  function writeConfig(obj) {
    fs.writeFileSync(path.join(testConfigDir, 'cc-aliases.json'), JSON.stringify(obj));
  }

  test('config file 不在で extractCcProject は @cc-* のみ動作 (alias なし)', () => {
    expect(extractCcProject('@cc-tealus hello')).toBe('tealus');
    expect(extractCcProject('@Claude hello')).toBeNull();  // alias 未登録なので null
  });

  test('cc-aliases.json で 単一 alias を登録', () => {
    writeConfig({ aliases: [{ mention: 'Claude', project: 'tealus' }] });
    reloadAliases();
    expect(extractCcProject('@Claude hello')).toBe('tealus');
  });

  test('複数 alias を登録、それぞれ別 project に routing', () => {
    writeConfig({
      aliases: [
        { mention: 'Claude', project: 'tealus' },
        { mention: 'Helper', project: 'proj1' },
        { mention: 'AI', project: 'proj2' },
      ],
    });
    reloadAliases();
    expect(extractCcProject('@Claude hello')).toBe('tealus');
    expect(extractCcProject('@Helper task')).toBe('proj1');
    expect(extractCcProject('@AI ask')).toBe('proj2');
  });

  test('alias は case-insensitive で match', () => {
    writeConfig({ aliases: [{ mention: 'Claude', project: 'tealus' }] });
    reloadAliases();
    expect(extractCcProject('@claude hello')).toBe('tealus');
    expect(extractCcProject('@CLAUDE hello')).toBe('tealus');
    expect(extractCcProject('@cLaUdE hello')).toBe('tealus');
  });

  test('alias でも word boundary で誤 match 防止', () => {
    writeConfig({ aliases: [{ mention: 'Claude', project: 'tealus' }] });
    reloadAliases();
    expect(extractCcProject('@Claudette hello')).toBeNull();
    expect(extractCcProject('@Claudia hello')).toBeNull();
  });

  test('alias でも 行頭 only (#215 同 stance)', () => {
    writeConfig({ aliases: [{ mention: 'Claude', project: 'tealus' }] });
    reloadAliases();
    expect(extractCcProject('hello @Claude bye')).toBeNull();
    expect(extractCcProject('  @Claude  ')).toBeNull();
  });

  test('複数 alias で先に登録された方が優先 (登録順)', () => {
    writeConfig({
      aliases: [
        { mention: 'Helper', project: 'proj-a' },
        { mention: 'Helper', project: 'proj-b' },  // duplicate mention
      ],
    });
    reloadAliases();
    expect(extractCcProject('@Helper task')).toBe('proj-a');
  });

  test('@cc-{project} は alias より優先 (regex 順)', () => {
    writeConfig({ aliases: [{ mention: 'cc-test', project: 'override' }] });
    reloadAliases();
    expect(extractCcProject('@cc-test hello')).toBe('test');  // alias でなく標準 path
  });

  test('CLAUDE_DEFAULT_PROJECT env で Claude alias の project を override (legacy)', () => {
    writeConfig({ aliases: [{ mention: 'Claude', project: 'tealus' }] });
    reloadAliases();
    process.env.CLAUDE_DEFAULT_PROJECT = 'myproj';
    try {
      expect(extractCcProject('@Claude hello')).toBe('myproj');
    } finally {
      delete process.env.CLAUDE_DEFAULT_PROJECT;
    }
  });

  test('CLAUDE_DEFAULT_PROJECT は Claude 以外の alias には影響なし', () => {
    writeConfig({ aliases: [{ mention: 'Helper', project: 'proj1' }] });
    reloadAliases();
    process.env.CLAUDE_DEFAULT_PROJECT = 'myproj';
    try {
      expect(extractCcProject('@Helper hello')).toBe('proj1');  // override されない
    } finally {
      delete process.env.CLAUDE_DEFAULT_PROJECT;
    }
  });

  test('invalid JSON は空 alias 扱い (graceful degrade)', () => {
    fs.writeFileSync(path.join(testConfigDir, 'cc-aliases.json'), '{ invalid json');
    reloadAliases();
    expect(extractCcProject('@Claude hello')).toBeNull();
    expect(extractCcProject('@cc-tealus hello')).toBe('tealus');  // 標準 path は健在
  });

  test('aliases field が array でない場合は空扱い', () => {
    writeConfig({ aliases: 'not-an-array' });
    reloadAliases();
    expect(extractCcProject('@Claude hello')).toBeNull();
  });

  test('alias entry に必須 field が無いものは skip', () => {
    writeConfig({
      aliases: [
        { mention: 'Valid', project: 'good' },
        { mention: '' },  // empty mention
        { project: 'no-mention' },  // no mention
        { mention: 'NoProject' },  // no project
        null,
        { mention: 'Helper', project: '' },  // empty project
      ],
    });
    reloadAliases();
    expect(extractCcProject('@Valid hello')).toBe('good');
    expect(extractCcProject('@NoProject hello')).toBeNull();
    expect(extractCcProject('@Helper hello')).toBeNull();
  });

  test('特殊文字を含む mention 名も escape されて regex として安全', () => {
    writeConfig({ aliases: [{ mention: 'Bot.X+Y', project: 'special' }] });
    reloadAliases();
    expect(extractCcProject('@Bot.X+Y hello')).toBe('special');
    expect(extractCcProject('@BotXY hello')).toBeNull();  // . が literal なので match しない
  });

  test('reloadAliases() で file 編集後の変更が反映される', () => {
    writeConfig({ aliases: [{ mention: 'Claude', project: 'tealus' }] });
    reloadAliases();
    expect(extractCcProject('@Claude hello')).toBe('tealus');

    // file を rewrite
    writeConfig({ aliases: [{ mention: 'Claude', project: 'newproj' }] });
    reloadAliases();
    expect(extractCcProject('@Claude hello')).toBe('newproj');
  });

  test('AGENT_CONFIG_DIR で config 場所を override', () => {
    expect(getAliasesConfigPath()).toBe(path.join(testConfigDir, 'cc-aliases.json'));
  });

  test('loadAliases は array を返す (内部 structure 確認)', () => {
    writeConfig({
      aliases: [
        { mention: 'Claude', project: 'tealus' },
        { mention: 'AI', project: 'proj1' },
      ],
    });
    reloadAliases();
    const aliases = loadAliases();
    expect(aliases).toHaveLength(2);
    expect(aliases[0].mention).toBe('Claude');
    expect(aliases[0].project).toBe('tealus');
    expect(aliases[0].regex).toBeInstanceOf(RegExp);
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

describe('shouldSkipCcSender (self-loop prevention)', () => {
  test('skip set が空ならどんな sender でも false', () => {
    expect(shouldSkipCcSender('any-id', new Set())).toBe(false);
    expect(shouldSkipCcSender('any-id', null)).toBe(false);
    expect(shouldSkipCcSender('any-id', undefined)).toBe(false);
  });

  test('senderId が skip set に含まれていれば true', () => {
    const set = new Set(['bot-1', 'bot-2']);
    expect(shouldSkipCcSender('bot-1', set)).toBe(true);
    expect(shouldSkipCcSender('bot-2', set)).toBe(true);
  });

  test('senderId が skip set に含まれていなければ false', () => {
    const set = new Set(['bot-1']);
    expect(shouldSkipCcSender('user-1', set)).toBe(false);
  });

  test('senderId が空 / null / undefined なら false', () => {
    const set = new Set(['bot-1']);
    expect(shouldSkipCcSender('', set)).toBe(false);
    expect(shouldSkipCcSender(null, set)).toBe(false);
    expect(shouldSkipCcSender(undefined, set)).toBe(false);
  });
});

describe('loadSkipSenderIds', () => {
  test('CSV から Set を構築', () => {
    const set = loadSkipSenderIds('id-1,id-2,id-3');
    expect(set.size).toBe(3);
    expect(set.has('id-1')).toBe(true);
    expect(set.has('id-2')).toBe(true);
    expect(set.has('id-3')).toBe(true);
  });

  test('前後 whitespace を trim', () => {
    const set = loadSkipSenderIds(' id-1 , id-2 ,id-3 ');
    expect(set.has('id-1')).toBe(true);
    expect(set.has('id-2')).toBe(true);
    expect(set.has('id-3')).toBe(true);
  });

  test('空 / undefined / null は空 Set', () => {
    expect(loadSkipSenderIds('').size).toBe(0);
    expect(loadSkipSenderIds(undefined).size).toBe(0);
    expect(loadSkipSenderIds(null).size).toBe(0);
  });

  test('単一 ID も処理', () => {
    const set = loadSkipSenderIds('only-one');
    expect(set.size).toBe(1);
    expect(set.has('only-one')).toBe(true);
  });
});
