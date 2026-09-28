/**
 * .env 読み込み (#330 TS 移行で導入)
 *
 * ESM は static import が全てコード実行前に評価されるため、app.mts の途中で
 * dotenv.config() を呼んでも pool / auth (JWT_SECRET) 等の module 初期化に間に合わない。
 * app.mts の先頭で `import './env.mts'` することで、他 module の評価前に .env を確定させる。
 */
import dotenv from 'dotenv';

// ★ テスト中 (Jest の中) は本番の .env を読まない (#468、2026-09-28)。
//   jest.setup.js が .env.test を読んだ後にここで .env も読むと、.env.test に無い項目 (24 個) が本番の値になり、
//   npm test のたびにテストのダミーが本番のメディアのフォルダへ書かれていた (外部 API の設定も見えていた)。
//   ★ CI には本番の .env が無く、その状態で全テストが通る = テストはこれらを必要としていない
if (!process.env.JEST_WORKER_ID) {
  dotenv.config();
}
