-- 2026-10-06 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql・seed.sql にも同じ内容を入れてある）
-- 指定の仕入れ先：事業者ごとに「どの船の魚を」「どの事業者から」買うかを決めておく。
-- 受け取るときに、指定の外から来た魚なら画面で警告する（閉じた流通の中だけで「登録された船の魚だけ」と言えるようにする）
--   designated_ships     ：この船の魚だけを買う（null＝決めていない＝確かめない）
--   designated_suppliers ：この事業者からだけ受け取る（null＝決めていない＝確かめない）
alter table businesses add column if not exists designated_ships uuid[];
alter table businesses add column if not exists designated_suppliers uuid[];

-- 表示例：サンプル加工は、第八 海鳴丸と第十八 潮丸の魚を、市場からだけ買う（第五 浜風丸は指定の外）
update businesses set
  designated_ships = array(select id from ships where name in ('第八 海鳴丸', '第十八 潮丸') order by name),
  designated_suppliers = array['00000000-0000-0000-0000-000000000001'::uuid]
where id = '00000000-0000-0000-0000-000000000002';
-- サンプル小売は、サンプル加工からだけ受け取る
update businesses set designated_suppliers = array['00000000-0000-0000-0000-000000000002'::uuid]
where id = '00000000-0000-0000-0000-000000000003';

-- 確認：サンプル加工に船が2隻、仕入れ先が1つ。サンプル小売に仕入れ先が1つ
select name, cardinality(designated_ships) as ships, cardinality(designated_suppliers) as suppliers from businesses order by id;
