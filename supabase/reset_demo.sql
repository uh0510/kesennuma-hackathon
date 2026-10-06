-- 魚籍（GYOSEKI） デモの前に、試しに入れた記録をすべて消す（SQL Editor で実行）
-- 消えるもの：個体・加工品（items）と記録（events）、漁船の申告（declarations）のすべて
-- 残るもの　：事業者・ログインのひも付け・漁船・製品のマスタ・はかりの登録
--
-- ふだんは消せない（追記のみのトリガー）。TRUNCATE は1行ずつのトリガーを通らないので、管理者だけがこれで消せる
-- チェーン（テストネット）の記録は消えない。消したIDと同じIDを使うとチェーンの指紋と合わなくなるので、
--   水揚げの登録画面は「チェーンにすでにあるID」を飛ばして次の番号を振る
-- 写真（Storage の photos バケット）は残る。消したいときは Dashboard → Storage → photos で消す

begin;
truncate table events, items, declarations restart identity;
commit;

-- 確認：どちらも 0 になる
select (select count(*) from items) as items, (select count(*) from events) as events, (select count(*) from declarations) as declarations;
