-- 2026-10-06 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql にも同じ内容を入れてある）
-- 加工ロット（process_lot）：加工場が、受け取った魚を何尾かまとめて1回の加工に入れる単位。
-- 加工で混ざってタグが外れても、「この箱はどの魚たちから作ったか」を一覧で持つ（inputs＝入れた魚のID）。
-- 入れた魚の一覧と重さは、加工ロットの発行の記録（payload.inputs）にも入り、指紋に含まれる。
-- 加工ロットから先の切り分け（加工品の発行）は、今までどおり parent_id でつなぐ。quantity は 1（ラベルの枚数に使うため）

alter table items add column if not exists inputs text[];

-- kind の決まりを付け直す（009 と同じやり方）
do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'items'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table items drop constraint %I', r.conname);
  end loop;
end $$;
alter table items add constraint items_kind_check check (kind in ('individual', 'catch_lot', 'process_lot', 'product'));
alter table items add constraint items_kind_parent_check check (
  (kind in ('individual', 'catch_lot') and parent_id is null and inputs is null)
  or (kind = 'process_lot' and parent_id is null and cardinality(inputs) >= 1)
  or (kind = 'product' and parent_id is not null and inputs is null));

-- items は書き換えできない（inputs も含める）
create or replace function items_lock() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'items は削除できません（訂正は fix として追記してください）';
  end if;
  if (new.id, new.kind, new.parent_id, new.species, new.name, new.weight_kg, new.ship_id, new.product_id,
      new.catch_area, new.landed_at, new.landing_port, new.created_by, new.created_at, new.quantity, new.unit_kg, new.inputs)
     is distinct from
     (old.id, old.kind, old.parent_id, old.species, old.name, old.weight_kg, old.ship_id, old.product_id,
      old.catch_area, old.landed_at, old.landing_port, old.created_by, old.created_at, old.quantity, old.unit_kg, old.inputs) then
    raise exception 'items の内容は書き換えできません（QRの有効化のみ可）';
  end if;
  if old.qr_status = 'active' and new.qr_status is distinct from 'active' then
    raise exception 'QRの有効化は取り消せません';
  end if;
  return new;
end $$;

-- 見える範囲・消費者の画面：上流をたどるときに、親だけでなく加工ロットに入れた魚もたどる
create or replace function visible_item_ids() returns setof text
language sql stable security definer set search_path = public as $$
  with recursive me as (
    select business_id from members where user_id = auth.uid()
  ), direct as (
    select distinct e.item_id as id
    from events e join me on e.actor = me.business_id or e.payload->'to'->>'id' = me.business_id::text
  ), up as (
    select id from direct
    union
    select x.id from items i join up on i.id = up.id
    cross join lateral unnest(array_remove(array[i.parent_id], null) || coalesce(i.inputs, '{}'::text[])) as x(id)
  )
  select id from up
$$;

create or replace function public_trace(p_item text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  st text;
  pid text;
begin
  select qr_status, parent_id into st, pid from items where id = p_item;
  if st is null then return null; end if;
  if st <> 'active' then return json_build_object('status', 'inactive'); end if;
  return (
    with recursive up as (
      select id from items where id = p_item
      union
      select x.id from items i join up on i.id = up.id
      cross join lateral unnest(array_remove(array[i.parent_id], null) || coalesce(i.inputs, '{}'::text[])) as x(id)
    )
    select json_build_object(
      'status', 'ok',
      'items', (select coalesce(json_agg(i order by i.created_at, i.id), '[]'::json) from items i
                where i.id in (select id from up) or (pid is not null and i.parent_id = pid)),
      'events', (select coalesce(json_agg(e order by e.id), '[]'::json) from events e where e.item_id in (select id from up))
    )
  );
end $$;

-- 確認：kind に process_lot が入っている。inputs の列がある
select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'items'::regclass and conname = 'items_kind_check';
select column_name, data_type from information_schema.columns where table_name = 'items' and column_name = 'inputs';
