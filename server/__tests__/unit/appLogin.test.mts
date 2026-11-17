/**
 * ログインの札の許可表 (docs/11 §5.5)。APP_LOGIN_TARGETS = `<origin>|<戻り先のパス>` をカンマで並べる
 */
import { parseLoginTargets, loginCallbackUrl } from '../../src/utils/appLogin.mts';

describe('parseLoginTargets', () => {
  it('origin と戻り先のパスの組を読む (前後の空白は捨てる)', () => {
    const m = parseLoginTargets(' https://a.example.com|/auth/?a=tcallback , https://b.example.com:8443|/login ');
    expect(m.get('https://a.example.com')).toBe('/auth/?a=tcallback');
    expect(m.get('https://b.example.com:8443')).toBe('/login');
  });

  it('★ 崩れた行は読まない (https でない・origin でない・パスが / で始まらない・// や /\\ で始まる)', () => {
    const m = parseLoginTargets([
      'http://a.example.com|/auth/',
      'https://b.example.com/x|/auth/',
      'https://c.example.com|auth/',
      'https://d.example.com|//evil.example.com/',
      'https://e.example.com|/\\evil.example.com',
      'https://f.example.com',
      'https://g.example.com|/ok',
    ].join(','));
    expect([...m.keys()]).toEqual(['https://g.example.com']);
  });

  it('空・未設定は空の表', () => {
    expect(parseLoginTargets(undefined).size).toBe(0);
    expect(parseLoginTargets('').size).toBe(0);
  });
});

describe('loginCallbackUrl', () => {
  it('戻り先に ? があれば & で、無ければ ? で札を付ける (札は URL に使える形に)', () => {
    expect(loginCallbackUrl('https://a.example.com', '/auth/?a=tcallback', 'v1.x.y'))
      .toBe('https://a.example.com/auth/?a=tcallback&tealus_login=v1.x.y');
    expect(loginCallbackUrl('https://a.example.com', '/login', 'v1.x+y'))
      .toBe('https://a.example.com/login?tealus_login=v1.x%2By');
  });
});
