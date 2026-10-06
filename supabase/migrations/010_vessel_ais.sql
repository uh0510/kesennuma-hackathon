-- 2026-10-06 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql にも同じ内容を入れてある）
-- 漁船の AIS（船が出す位置の信号）の識別番号。Global Fishing Watch の公開データから、その船が実際に漁をした海域と
-- 入港した港を取ってきて、申告した漁獲海域・水揚げ港と照らし合わせるのに使う
--   mmsi          ：AIS の番号（9桁）
--   gfw_vessel_id ：Global Fishing Watch の船のID
alter table ships add column if not exists mmsi text;
alter table ships add column if not exists gfw_vessel_id text;

-- 確認：2つの列が増えている
select column_name from information_schema.columns where table_name = 'ships' and column_name in ('mmsi', 'gfw_vessel_id');
