-- 魚籍（GYOSEKI） DB定義（Supabase / PostgreSQL）
-- 方針：データ本体はDB、チェーンにはハッシュと親子関係だけを記録する
--       events は「追記のみ」。UPDATE / DELETE はトリガーで拒否する

create extension if not exists pgcrypto;

-- 事業者マスタ（市場・加工業者・小売など）
create table businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  role        text not null check (role in ('market','processor','retailer','exporter','admin')),
  wallet      text unique,              -- 署名に使うアドレス（0x...）
  address     text,                     -- 登録住所
  lat         double precision,         -- 登録住所の座標（記録した場所と比べる）
  lng         double precision,
  created_at  timestamptz not null default now()
);

-- 利用者（Supabase Auth のユーザーと事業者をつなぐ）
create table members (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id),
  display_name text
);

-- 船マスタ（最初の1回だけ登録）
create table ships (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,            -- 漁船名
  reg_no      text not null,            -- 漁船登録番号
  permit_no   text,                     -- 漁業許可番号
  gear        text not null,            -- 漁法
  owner_line_id text,                   -- 将来：LINE連携用
  created_at  timestamptz not null default now()
);

-- 製品マスタ（保存方法・期限・歩留まりの範囲）
create table products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  species     text not null,
  storage     text,
  shelf_days  int,
  yield_min   numeric(4,3),             -- 例 0.550（元の重量に対する割合の下限）
  yield_max   numeric(4,3)              -- 例 0.700
);

-- 個体・水揚げロット・加工品
-- individual＝1尾ずつ管理する魚（マグロ系）、catch_lot＝船 × 水揚げ日 × 魚種 × 銘柄のまとまり（カツオ・メバチなど。quantity は尾数）
create table items (
  id          text primary key,         -- KSN-PBF-261006-001 / -P01 / -P01-K01
  kind        text not null constraint items_kind_check check (kind in ('individual','catch_lot','product')),
  parent_id   text references items(id),
  species     text not null,
  name        text not null,
  weight_kg   numeric(10,2) not null check (weight_kg > 0),
  ship_id     uuid references ships(id),        -- 個体のみ
  product_id  uuid references products(id),     -- 加工品のみ
  catch_area  text,                             -- 個体のみ（例：北西太平洋（FAO 61））
  landed_at   timestamptz,                      -- 個体のみ
  landing_port text default '気仙沼港',
  qr_status   text not null default 'issued' check (qr_status in ('issued','active')),
  quantity    int not null default 1 check (quantity > 0),          -- 加工品はロットのパック数、水揚げロットは尾数（おおよそ）、個体は 1
  unit_kg     numeric(10,3) check (unit_kg is null or unit_kg > 0), -- 1パックの重さ（weight_kg はロットの総重量）
  created_by  uuid not null references businesses(id),
  created_at  timestamptz not null default now(),
  constraint items_kind_parent_check
    check ((kind in ('individual','catch_lot') and parent_id is null) or (kind = 'product' and parent_id is not null))
);
create index on items(parent_id);

-- 追記の記録（追記のみ）
create table events (
  id          bigserial primary key,
  item_id     text not null references items(id),
  type        text not null check (type in ('catch','landing','auction','storage','process','born','ship','fix','activate','receive','sell')),
  actor       uuid not null references businesses(id),
  payload     jsonb not null default '{}'::jsonb,   -- 海域・買受人・加工内容など
  prev_hash   text,                                 -- 同じ item の直前の記録の hash
  hash        text not null,                        -- sha256(正規化JSON) 0x...
  tx_hash     text,                                 -- チェーンに記録したトランザクション
  created_at  timestamptz not null default now()
);
create index on events(item_id, id);

-- 追記のみを強制（tx_hash の後付けだけは許可）
create or replace function events_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'events は削除できません（訂正は fix として追記してください）';
  end if;
  if tg_op = 'UPDATE' then
    if (new.item_id, new.type, new.actor, new.payload, new.prev_hash, new.hash, new.created_at)
       is distinct from (old.item_id, old.type, old.actor, old.payload, old.prev_hash, old.hash, old.created_at)
       or old.tx_hash is not null then
      raise exception 'events は書き換えできません（tx_hash の初回記録のみ可）';
    end if;
  end if;
  return new;
end $$;
create trigger trg_events_append_only before update or delete on events
for each row execute function events_append_only();

-- items は QR の有効化（issued → active）以外は書き換え・削除できない
-- 内容を直したいときは、新しい記録（fix）を足す
create or replace function items_lock() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'items は削除できません（訂正は fix として追記してください）';
  end if;
  if (new.id, new.kind, new.parent_id, new.species, new.name, new.weight_kg, new.ship_id, new.product_id,
      new.catch_area, new.landed_at, new.landing_port, new.created_by, new.created_at, new.quantity, new.unit_kg)
     is distinct from
     (old.id, old.kind, old.parent_id, old.species, old.name, old.weight_kg, old.ship_id, old.product_id,
      old.catch_area, old.landed_at, old.landing_port, old.created_by, old.created_at, old.quantity, old.unit_kg) then
    raise exception 'items の内容は書き換えできません（QRの有効化のみ可）';
  end if;
  if old.qr_status = 'active' and new.qr_status is distinct from 'active' then
    raise exception 'QRの有効化は取り消せません';
  end if;
  return new;
end $$;
drop trigger if exists trg_items_lock on items;
create trigger trg_items_lock before update or delete on items
for each row execute function items_lock();

-- QR は1回だけ有効化（販売開始のときに record-event から呼ぶ）
create or replace function activate_qr(p_item text) returns void language plpgsql as $$
begin
  update items set qr_status = 'active' where id = p_item and qr_status = 'issued';
  if not found then
    raise exception 'このQRはすでに有効化されているか、存在しません：%', p_item;
  end if;
end $$;

-- 重量の整合チェック用ビュー：子の合計が親を超えていないか
create or replace view item_balance as
select p.id as parent_id,
       p.weight_kg as parent_kg,
       coalesce(sum(c.weight_kg), 0) as children_kg,
       case when p.weight_kg > 0 then coalesce(sum(c.weight_kg), 0) / p.weight_kg end as ratio,
       coalesce(sum(c.weight_kg), 0) > p.weight_kg as over_weight
from items p
left join items c on c.parent_id = p.id
group by p.id, p.weight_kg;

-- ==== 権限 ====
-- 画面に埋め込む公開キー（anon / authenticated）でできるのは「読む」だけ。
-- 書き込みはすべて Edge Function（record-event、service_role）を通す。
-- 直接 INSERT できると、ハッシュ計算とチェーン記録を飛ばした記録が作れてしまうため。

alter table businesses enable row level security;
alter table members    enable row level security;
alter table ships      enable row level security;
alter table products   enable row level security;
alter table items      enable row level security;
alter table events     enable row level security;

-- 漁船・事業者・製品の名前は誰でも読める（消費者の画面の表示にも使う）
create policy businesses_read_all on businesses for select using (true);
create policy ships_read_all      on ships      for select using (true);
create policy products_read_all   on products   for select using (true);

-- items / events は、ログインした事業者が「自分が記録した・自分に引き渡された（引き渡し中を含む）魚と、その上流」だけ読める
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

create policy items_read_related  on items  for select to authenticated using (id in (select visible_item_ids()));
create policy events_read_related on events for select to authenticated using (item_id in (select visible_item_ids()));

-- 消費者（ログインなし）は QR の ID 1件分だけ。販売開始で有効になったものに限る
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

-- 所属は自分の行だけ読める（画面で「どの事業者としてログインしているか」を出すため）
create policy members_read_own    on members    for select using (user_id = auth.uid());

-- 念のため、公開キーからの書き込み権限そのものを外しておく（RLS の設定漏れがあっても書けない）
grant usage on schema public to anon, authenticated;
grant select on businesses, ships, products to anon, authenticated;
grant select on items, events, item_balance to authenticated;
grant select on members to authenticated;
revoke insert, update, delete, truncate on businesses, members, ships, products, items, events from anon, authenticated;

-- 重量チェック用ビューは、呼んだ人の権限で読む
alter view item_balance set (security_invoker = true);

-- QRの有効化は record-event（販売開始）からだけ呼ぶ
revoke execute on function activate_qr(text) from public, anon, authenticated;
grant execute on function activate_qr(text) to service_role;

-- 写真の置き場所（Storage の photos バケット）
-- 消費者はログインなしで見られるよう公開読み取り。書き込みは Edge Function（service_role）だけ
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
