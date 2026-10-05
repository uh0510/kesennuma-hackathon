-- 2026-10-05 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql にも同じ内容を入れてある）
-- 見える範囲を絞る
--   事業者（ログイン）：自分が記録した・自分に引き渡された（引き渡し中を含む）魚と、その上流（親・祖先）だけ
--   消費者（ログインなし）：QR の ID を指定したときだけ、販売開始で有効になったものに限って public_trace で返す
-- QR の有効化は販売開始のとき（record-event が自動で行う）

-- ログイン中の事業者が見てよい ID
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
    select i.parent_id from items i join up on i.id = up.id where i.parent_id is not null
  )
  select id from up
$$;
revoke execute on function visible_item_ids() from public, anon;
grant execute on function visible_item_ids() to authenticated;

-- items / events は「誰でも読める」をやめ、ログインした事業者の見える範囲だけにする
drop policy if exists items_read_all  on items;
drop policy if exists events_read_all on events;
drop policy if exists items_read_related  on items;
drop policy if exists events_read_related on events;
create policy items_read_related  on items  for select to authenticated using (id in (select visible_item_ids()));
create policy events_read_related on events for select to authenticated using (item_id in (select visible_item_ids()));
revoke select on items, events, item_balance from anon;

-- 消費者の画面：QR の ID 1件分（その商品と上流の記録、重さの内訳に使う兄弟の行）
-- 有効になっていなければ {status:'inactive'}、ID がなければ null
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
      select id, parent_id from items where id = p_item
      union
      select i.id, i.parent_id from items i join up on i.id = up.parent_id
    )
    select json_build_object(
      'status', 'ok',
      'items', (select coalesce(json_agg(i order by i.created_at, i.id), '[]'::json) from items i
                where i.id in (select id from up) or (pid is not null and i.parent_id = pid)),
      'events', (select coalesce(json_agg(e order by e.id), '[]'::json) from events e where e.item_id in (select id from up))
    )
  );
end $$;
revoke execute on function public_trace(text) from public;
grant execute on function public_trace(text) to anon, authenticated;

-- すでに販売を始めているものは有効にしておく（これまでは手で有効化していた）
update items set qr_status = 'active'
where qr_status = 'issued' and id in (select item_id from events where type = 'sell');
