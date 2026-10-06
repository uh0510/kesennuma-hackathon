-- 2026-10-06 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql にも同じ内容を入れてある）
-- 漁船が「自分が申告した魚のその後」を見る読み取り口。
-- ふだんの見える範囲（visible_item_ids）は上流だけなので、漁船には市場より先の記録が見えない。
-- ここでは、ログインした漁船の申告から水揚げされた魚と、そこから作られたもの（加工品・加工ロット・その先）だけを返す。
-- 返すのは画面に出す項目だけ（記録の中身すべては返さない）
create or replace function vessel_followup() returns json
language sql stable security definer set search_path = public as $$
  with recursive me as (
    select b.id from members m join businesses b on b.id = m.business_id
    where m.user_id = auth.uid() and b.role = 'vessel'
  ), roots as (
    select e.item_id as id, e.payload->'declaration'->>'id' as declaration_id
    from events e join me on e.payload->'declaration'->'by'->>'id' = me.id::text
    where e.type = 'landing'
  ), down as (
    select id from roots
    union
    select i.id from items i join down d on i.parent_id = d.id or d.id = any(i.inputs)
  )
  select json_build_object(
    'roots', (select coalesce(json_agg(r), '[]'::json) from roots r),
    'items', (select coalesce(json_agg(json_build_object(
                'id', i.id, 'kind', i.kind, 'name', i.name, 'species', i.species, 'weight_kg', i.weight_kg, 'quantity', i.quantity,
                'parent_id', i.parent_id, 'inputs', i.inputs, 'landed_at', i.landed_at, 'landing_port', i.landing_port, 'created_at', i.created_at
              ) order by i.created_at, i.id), '[]'::json) from items i where i.id in (select id from down)),
    'events', (select coalesce(json_agg(json_build_object(
                'item_id', e.item_id, 'type', e.type, 'at', e.created_at, 'who', b.name,
                'to', e.payload->'to'->>'name', 'display_name', e.payload->>'display_name'
              ) order by e.id), '[]'::json)
              from events e join businesses b on b.id = e.actor where e.item_id in (select id from down))
  )
$$;
revoke execute on function vessel_followup() from public, anon;
grant execute on function vessel_followup() to authenticated;

-- 確認：関数ができている（漁船以外で実行すると roots は空）
select proname from pg_proc where proname = 'vessel_followup';
