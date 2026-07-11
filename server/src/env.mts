/**
 * .env 読み込み (#330 TS 移行で導入)
 *
 * ESM は static import が全てコード実行前に評価されるため、app.mts の途中で
 * dotenv.config() を呼んでも pool / auth (JWT_SECRET) 等の module 初期化に間に合わない。
 * app.mts の先頭で `import './env.mts'` することで、他 module の評価前に .env を確定させる。
 */
import dotenv from 'dotenv';

dotenv.config();
