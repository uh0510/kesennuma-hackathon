-- 2026-10-04 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql・seed.sql にも同じ内容を入れてある）
-- 事業者の登録住所と座標（記録した場所が登録住所から離れていないかを確かめるため）
-- 事業者の所在地は公開情報なので、ほかのマスタと同じく誰でも読める
alter table businesses add column if not exists address text;
alter table businesses add column if not exists lat double precision;
alter table businesses add column if not exists lng double precision;

-- サンプルの事業者の座標（仮の位置。本物の事業者を登録するときに差し替える）
update businesses set address = '宮城県気仙沼市（魚市場付近・仮）', lat = 38.9017, lng = 141.5779 where id = '00000000-0000-0000-0000-000000000001';
update businesses set address = '宮城県気仙沼市（鹿折付近・仮）',   lat = 38.9128, lng = 141.5870 where id = '00000000-0000-0000-0000-000000000002';
update businesses set address = '宮城県仙台市（仙台駅付近・仮）',   lat = 38.2601, lng = 140.8822 where id = '00000000-0000-0000-0000-000000000003';
