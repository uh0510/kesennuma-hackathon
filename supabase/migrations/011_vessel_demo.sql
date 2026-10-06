-- 2026-10-06 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql・seed.sql にも同じ内容を入れてある）
-- ⚠️ 画面（web）を「船マスタは公開してよい列だけ読む」形に更新してから実行する（先に実行すると、古い画面が船マスタを読めなくなる）

-- 1. 表示例の印（true の船は、消費者の画面の照らし合わせ欄に「表示例」と出す）
alter table ships add column if not exists ais_sample boolean not null default false;

-- 2. AIS の番号と GFW の船のIDは公開しない（実在の船を表示例に使うとき、どの船か分からないように）
--    照らし合わせは Edge Function（vessel-activity、service_role）がサーバーで行うので、画面からは読まなくてよい
revoke select on ships from anon, authenticated;
grant select (id, name, reg_no, permit_no, gear, owner_line_id, created_at, ais_sample) on ships to anon, authenticated;

-- 3. デモの船（サンプル。名前は架空）
--    第五 浜風丸：作りものの見本データ（南西太平洋 FAO 81 で操業）。実在の船には結び付かない
--                 → 登録で「北西太平洋（FAO 61）」と申告すると「申告と違う海域」の例になる
--    実在の船の公開データを表示例として使う船のひも付けは、リポジトリが公開なのでここには書かない
--    （どの実在の船か分からないようにするため。手元の docs/ にある SQL で行う）
update ships set gfw_vessel_id = 'sample:south-pacific', ais_sample = true where name = '第五 浜風丸';

-- 確認：2隻にIDが入っている（このSQL Editor は管理者なので見える）
select name, gfw_vessel_id, ais_sample from ships order by name;
