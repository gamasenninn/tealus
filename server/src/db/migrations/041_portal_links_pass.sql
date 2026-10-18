-- #607 ホーム画面のタブ (ポータルのリンク) にも「Tealus の通行証を添える」を付けられるようにする (docs/11 §5.4)。
-- ★ 部屋のアプリ (rooms.app_urls[].pass) だけに付けていて、ホームの社内ポータルが相手側の案内ページになった
ALTER TABLE portal_links ADD COLUMN IF NOT EXISTS pass BOOLEAN NOT NULL DEFAULT false;
