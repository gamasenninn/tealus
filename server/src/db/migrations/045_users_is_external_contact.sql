-- 045 社外の窓口の印 (2026-11-13 小野さん判断「お客様の部屋のタブ」、docs/02 の users)
-- ★ 社外の人の代わりに部屋に入っている口座 (EC サイトのお客様の発言を中継する口座など) に付ける。
--   この口座がいる部屋を、画面のタブ「お客様」にまとめる。付けるのは管理者だけ。表示の分類であって、記録から外す約束ではない
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_external_contact BOOLEAN NOT NULL DEFAULT false;
