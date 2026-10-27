import { isAllowedImage, imageExt, imageOnlyFilter, imageUploadError } from '../../src/utils/imageUpload.mts';

describe('画像でないファイルを断ったときの文 (2026-10-27 改善ループ 17 回目)', () => {
  // ★ 以前は種類で落としても「画像ファイルが添付されていません」と出ていた (添付はしている)
  const run = (mimetype: string) => {
    const req = {} as Parameters<typeof imageOnlyFilter>[0];
    let accepted: boolean | undefined;
    imageOnlyFilter(req, { mimetype, originalname: 'x.bin' } as Express.Multer.File, ((_e: unknown, ok?: boolean) => { accepted = ok; }) as never);
    return { req, accepted };
  };
  it('★ 種類で断ったら、受け付ける種類を言う', () => {
    const { req, accepted } = run('application/octet-stream');
    expect(accepted).toBe(false);
    expect(imageUploadError(req)).toContain('JPEG');
  });
  it('★ 種類が空・octet-stream で届いても、拡張子が画像なら通す (Windows の Chrome は .heic に種類を付けないことがある)', () => {
    const req = {} as Parameters<typeof imageOnlyFilter>[0];
    let accepted: boolean | undefined;
    for (const mimetype of ['', 'application/octet-stream']) {
      imageOnlyFilter(req, { mimetype, originalname: 'IMG_0001.HEIC' } as Express.Multer.File, ((_e: unknown, ok?: boolean) => { accepted = ok; }) as never);
      expect(accepted).toBe(true);
    }
    imageOnlyFilter(req, { mimetype: '', originalname: 'a.html' } as Express.Multer.File, ((_e: unknown, ok?: boolean) => { accepted = ok; }) as never);
    expect(accepted).toBe(false);
  });
  it('添付が無いときは今までどおり', () => {
    expect(imageUploadError({} as never)).toBe('画像ファイルが添付されていません');
  });
});

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
