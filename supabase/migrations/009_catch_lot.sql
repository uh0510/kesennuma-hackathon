-- 2026-10-06 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql・seed.sql にも同じ内容を入れてある）
-- 水揚げロット（catch_lot）：1尾ずつ管理しない魚（カツオ・メバチなど）は「船 × 水揚げ日 × 魚種 × 銘柄（サイズ）」の
-- まとまりで1つのIDにする。せりはこの単位で行われ、1つのまとまりは1社が買うので、最初の引き渡しまで1本でたどれる。
-- 1尾ずつ管理するのはマグロ系だけ（individual）。items.quantity はロットの尾数（おおよそ）に使う

-- kind の決まりを付け直す（名前の分からない自動の制約も含め、kind を見ている CHECK を外してから付ける）
do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'items'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table items drop constraint %I', r.conname);
  end loop;
end $$;
alter table items add constraint items_kind_check check (kind in ('individual', 'catch_lot', 'product'));
alter table items add constraint items_kind_parent_check
  check ((kind in ('individual', 'catch_lot') and parent_id is null) or (kind = 'product' and parent_id is not null));

-- 新しい魚種の加工品（歩留まりは仮の値。ヒアリングで確定する）
insert into products (name, species, storage, shelf_days, yield_min, yield_max) values
  ('クロマグロ 柵（冷凍）',   'クロマグロ', '−18℃以下', 182, 0.450, 0.650),
  ('メバチ 柵（生）',         'メバチ',     '4℃以下',     2, 0.450, 0.650),
  ('カツオ たたき（冷凍）',   'カツオ',     '−18℃以下', 182, 0.400, 0.600),
  ('カツオ 刺身用ロイン（生）', 'カツオ',   '4℃以下',     2, 0.450, 0.650);

-- カツオの一本釣りの船（サンプル。名前・番号は仮）
insert into ships (name, reg_no, permit_no, gear) values ('第十八 潮丸', 'MG3-[登録番号]', '[許可番号]', '一本釣り');

-- 確認：kind の制約が2つ、カツオの加工品が2つ
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'items'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%';
select name, species from products where species in ('クロマグロ', 'メバチ', 'カツオ');
