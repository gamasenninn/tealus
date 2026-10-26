import { isAllowedImage, imageExt } from '../../src/utils/imageUpload.mts';

describe('アバター・アイコンは画像だけ (L)', () => {
  it('★ 画像の種類だけ通し、SVG・HTML などは通さない', () => {
    for (const m of ['image/jpeg', 'image/png', 'image/webp', 'IMAGE/PNG', 'image/heic']) expect(isAllowedImage(m)).toBe(true);
    for (const m of ['image/svg+xml', 'text/html', 'application/octet-stream', '', undefined]) expect(isAllowedImage(m)).toBe(false);
  });
  it('★ 保存名の拡張子は画像のものだけ (違えば種類から決める)', () => {
    expect(imageExt('me.JPG', 'image/jpeg')).toBe('.jpg');
    expect(imageExt('me.html', 'image/png')).toBe('.png');
    expect(imageExt('me', 'image/webp')).toBe('.webp');
    expect(imageExt('a.php', 'image/x-unknown')).toBe('.img');
  });
});
