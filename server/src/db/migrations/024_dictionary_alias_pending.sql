-- #327 自己成長 hook 用の別名ライフサイクル。
-- 単一編集では corpus-precision(= 修正回数/出現) が判定できない(初回 count=1 → P 低 → 誤棄却)。
-- そこで auto 別名は 'pending'(累積中・補正には未使用) で入り、corpus-precision を通過したら
-- 'active'(有効) に昇格する。安価ゲート(短別名/音韻)は書込前、corpus-precision は昇格ゲート。
-- (補正段/オーバーレイは status='active' のみ引くので pending は効かない = 安全に累積できる)
ALTER TABLE dictionary_aliases DROP CONSTRAINT IF EXISTS dictionary_aliases_status_check;
ALTER TABLE dictionary_aliases ADD CONSTRAINT dictionary_aliases_status_check
    CHECK (status IN ('active', 'pending', 'rejected'));
