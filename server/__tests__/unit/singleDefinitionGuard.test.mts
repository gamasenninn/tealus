/**
 * 同じ決まりを 1 か所だけに書く (改善ループ 130)。写しが残ると、片方だけ直したときに食い違う
 * - UUID の形の正規表現 → utils/uuid.mts (isUuid)
 * - URL の誤りの文言 → utils/webUrl.mts
 * - 表示名の最大 → utils/userFields.mts
 * - 署名の base64url → utils/b64url.mts
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '../../src');
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.m?ts$/.test(e.name) ? [p] : [];
  });
}
const all = files(SRC).map((f) => ({ f: path.relative(SRC, f).split(path.sep).join('/'), s: fs.readFileSync(f, 'utf8') }));
const where = (re: RegExp) => all.filter((x) => re.test(x.s)).map((x) => x.f).sort();

describe('同じ決まりは 1 か所だけ', () => {
  it('UUID の形を確かめる正規表現 (^ で始まる) は utils/uuid.mts だけ。ログで ID を伏せる requestFlood の置き換えは別の用途', () => {
    expect(where(/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/)).toEqual(['utils/uuid.mts']);
  });
  it('「URL は http:// か https:// で始めてください」は utils/webUrl.mts だけ (部屋のアプリの「アプリの URL は…」は別の文言)', () => {
    expect(where(/'URL は http:\/\/ か https:\/\/ で始めてください'/)).toEqual(['utils/webUrl.mts']);
  });
  it('表示名の最大 (DISPLAY_NAME_MAX = ) は utils/userFields.mts だけ', () => {
    expect(where(/DISPLAY_NAME_MAX\s*=/)).toEqual(['utils/userFields.mts']);
  });
  it('base64url の作り方は utils/b64url.mts だけ', () => {
    expect(where(/replace\(\/=\+\$\/, ''\)/)).toEqual(['utils/b64url.mts']);
  });
});
