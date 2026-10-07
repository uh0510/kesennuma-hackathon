-- 2026-10-07 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql にも同じ内容を入れてある）
-- 水揚げロットを入札の単位（箱・山）に分ける：市場が、水揚げロットの下に子の水揚げロットを発行する。
--   子は kind = 'catch_lot' のまま parent_id に元の水揚げロットを持つ（船・海域・水揚げ日は元から写す）。
--   子の重さの合計は元の重さを超えられない（record-event で確かめる）。
--   記録の種類に「仕分け（split）」を足す：子の最初の記録（payload.from＝元）と、元への記録（payload.lots＝分けた一覧）

alter table events drop constraint if exists events_type_check;
alter table events add constraint events_type_check
  check (type in ('catch','landing','auction','storage','process','born','ship','fix','activate','receive','sell','split'));

alter table items drop constraint if exists items_kind_parent_check;
alter table items add constraint items_kind_parent_check check (
  (kind = 'individual' and parent_id is null and inputs is null)
  or (kind = 'catch_lot' and inputs is null)
  or (kind = 'process_lot' and parent_id is null and cardinality(inputs) >= 1)
  or (kind = 'product' and parent_id is not null and inputs is null));

-- 確認：events の type に split、items の決まりで catch_lot が親を持てる
select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'events'::regclass and conname = 'events_type_check';
select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'items'::regclass and conname = 'items_kind_parent_check';
