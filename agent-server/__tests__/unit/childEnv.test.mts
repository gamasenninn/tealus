/**
 * #565 AI (codex) の子プロセスに渡す環境変数を、必要なものだけの一覧に絞る。
 * ★ 以前は agent-server の環境変数をそのまま渡していて、AI がシェルで動かすコマンドにも鍵が届いていた
 * ★ 値のパスはスラッシュで書く (ヒアドキュメント経由でバックスラッシュが減り \u が Unicode の書き方として読まれた)
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
import { agentChildEnv } from '../../src/lib/childEnv.mts';
import { buildCodexExecEnv } from '../../src/agents/deepCodex.mts';

const FAKE: NodeJS.ProcessEnv = {
  Path: 'C:/Windows;C:/node', PATHEXT: '.EXE', SystemRoot: 'C:/Windows', ComSpec: 'cmd.exe',
  TEMP: 'C:/t', TMP: 'C:/t', USERPROFILE: 'C:/Users/u', APPDATA: 'C:/a', LOCALAPPDATA: 'C:/l',
  HOME: '/home/u', LANG: 'ja_JP.UTF-8', HTTPS_PROXY: 'http://proxy:8080',
  OPENAI_API_KEY: 'sk-x', GOOGLE_API_KEY: 'g', TEALUS_BOT_PASS: 'p', TEALUS_BOT_ID: 'AI_AGENT',
  DB_PASSWORD: 'd', DB_HOST: 'h', JWT_SECRET: 'j', WEBHOOK_SECRET: 'w', AIVIS_API_KEY: 'a', TAVILY_API_KEY: 't',
  SOMETHING_CUSTOM: 'c',
};

describe('agentChildEnv (#565)', () => {
  const env = agentChildEnv(FAKE);
  it('OS の基本 (PATH・一時フォルダ・ホーム・Windows の基本・言語・プロキシ) は渡す', () => {
    expect(env).toMatchObject({
      Path: FAKE.Path, PATHEXT: '.EXE', SystemRoot: 'C:/Windows', TEMP: 'C:/t', USERPROFILE: 'C:/Users/u',
      APPDATA: 'C:/a', LOCALAPPDATA: 'C:/l', HOME: '/home/u', LANG: 'ja_JP.UTF-8', HTTPS_PROXY: 'http://proxy:8080',
    });
  });
  it('★ 鍵・パスワード・DB・独自の変数は渡さない', () => {
    for (const k of ['OPENAI_API_KEY', 'GOOGLE_API_KEY', 'TEALUS_BOT_PASS', 'TEALUS_BOT_ID', 'DB_PASSWORD', 'DB_HOST',
      'JWT_SECRET', 'WEBHOOK_SECRET', 'AIVIS_API_KEY', 'TAVILY_API_KEY', 'SOMETHING_CUSTOM']) {
      expect(env).not.toHaveProperty(k);
    }
  });
  it('大文字小文字の違う名前 (Windows の Path / PATH) も拾う', () => {
    expect(agentChildEnv({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
  });
});

describe('Deep codex (#565)', () => {
  it('★ 元にする環境変数を指定しないとき、鍵は入らない (CODEX_HOME と API キーは明示して足す)', () => {
    const saved = { ...process.env };
    Object.assign(process.env, { TEALUS_BOT_PASS: 'p', DB_PASSWORD: 'd', GOOGLE_API_KEY: 'g' });
    try {
      const env = buildCodexExecEnv({ codexHomePath: 'C:/h', useSubscription: false, openaiApiKey: 'sk-y' });
      expect(env.CODEX_HOME).toBe('C:/h');
      expect(env.OPENAI_API_KEY).toBe('sk-y');
      expect(env).not.toHaveProperty('TEALUS_BOT_PASS');
      expect(env).not.toHaveProperty('DB_PASSWORD');
      expect(env).not.toHaveProperty('GOOGLE_API_KEY');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});
