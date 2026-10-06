-- 魚籍（GYOSEKI） DB定義（Supabase / PostgreSQL）
-- 方針：データ本体はDB、チェーンにはハッシュと親子関係だけを記録する
--       events は「追記のみ」。UPDATE / DELETE はトリガーで拒否する

create extension if not exists pgcrypto;

-- 事業者マスタ（市場・加工業者・小売など）
create table businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  role        text not null constraint businesses_role_check check (role in ('vessel','market','processor','retailer','exporter','admin')),
  wallet      text unique,              -- 署名に使うアドレス（0x...）
  address     text,                     -- 登録住所
  lat         double precision,         -- 登録住所の座標（記録した場所と比べる）
  lng         double precision,
  designated_ships     uuid[],          -- 指定の仕入れ先：この船の魚だけを買う（null＝確かめない）
  designated_suppliers uuid[],          -- 指定の仕入れ先：この事業者からだけ受け取る（null＝確かめない）
  created_at  timestamptz not null default now()
);
-- 漁船の事業者が乗る船（ships の後で足す）

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
  mmsi        text,                     -- AIS の番号（9桁）
  gfw_vessel_id text,                   -- Global Fishing Watch の船のID（操業した海域・入港した港の照合に使う）。'sample:' で始まるものは作りものの見本
  ais_sample  boolean not null default false, -- 表示例（画面に「見本」と出す）
  created_at  timestamptz not null default now()
);

alter table businesses add column ship_id uuid references ships(id);

-- 漁獲の申告：漁船が自分の鍵で、水揚げの前に魚種・海域・漁獲期間・その場の位置を申告する（追記のみ）
-- 市場は水揚げの登録で申告を選び、重さと港を足す（海域・期間は申告のまま）
create table declarations (
  id          text primary key,               -- DCL-261006-1A2B
  ship_id     uuid not null references ships(id),
  declared_by uuid not null references businesses(id),
  species     text not null,
  catch_area  text not null,
  catch_from  date not null,
  catch_to    date not null,
  payload     jsonb not null,                 -- 指紋を取った内容（見込みの重さ・尾数・位置・写真）
  hash        text not null,
  tx_hash     text,
  created_at  timestamptz not null default now()
);
create or replace function declarations_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'declarations は削除できません'; end if;
  if (to_jsonb(new) - 'tx_hash') is distinct from (to_jsonb(old) - 'tx_hash') or old.tx_hash is not null then
    raise exception 'declarations は書き換えできません（tx_hash の初回記録のみ可）';
  end if;
  return new;
end $$;
create trigger trg_declarations_append_only before update or delete on declarations
for each row execute function declarations_append_only();

-- はかり：自分の鍵で、量った重さと日時に署名する（address＝鍵のアドレス、小文字）。登録は record-event を通す
create table scales (
  address     text primary key,
  name        text not null,
  business_id uuid not null references businesses(id),
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
-- process_lot＝加工ロット：加工場が受け取った魚を何尾かまとめて1回の加工に入れる単位（inputs＝入れた魚のID。quantity は入れた数）
create table items (
  id          text primary key,         -- KSN-PBF-261006-001 / -P01 / -P01-K01
  kind        text not null constraint items_kind_check check (kind in ('individual','catch_lot','process_lot','product')),
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
  inputs      text[],                           -- 加工ロットのみ：入れた魚のID
  created_by  uuid not null references businesses(id),
  created_at  timestamptz not null default now(),
  constraint items_kind_parent_check
    check ((kind in ('individual','catch_lot') and parent_id is null and inputs is null)
        or (kind = 'process_lot' and parent_id is null and cardinality(inputs) >= 1)
        or (kind = 'product' and parent_id is not null and inputs is null))
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
alter table scales enable row level security;
create policy scales_read_all on scales for select using (true);
-- 申告はログインした事業者が読める（市場が水揚げの登録で選ぶ）
alter table declarations enable row level security;
create policy declarations_read on declarations for select to authenticated using (true);

-- items / events は、ログインした事業者が「自分が記録した・自分に引き渡された（引き渡し中を含む）魚と、その上流」だけ読める
-- 上流は、親（parent_id）と、加工ロットに入れた魚（inputs）の両方をたどる
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
revoke execute on function public_trace(text) from public;
grant execute on function public_trace(text) to anon, authenticated;

-- 漁船が自分の申告から水揚げされた魚の「その後」を見る（上流だけの見える範囲とは別。画面に出す項目だけ返す）
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

-- 所属は自分の行だけ読める（画面で「どの事業者としてログインしているか」を出すため）
create policy members_read_own    on members    for select using (user_id = auth.uid());

-- 念のため、公開キーからの書き込み権限そのものを外しておく（RLS の設定漏れがあっても書けない）
grant usage on schema public to anon, authenticated;
grant select on businesses, products, scales to anon, authenticated;
-- 船マスタの AIS の番号・GFW の船のIDは公開しない（照合は vessel-activity がサーバーで行う）
-- Supabase は最初から全部の列を読めるようにしているので、いったん外してから読んでよい列だけ渡す
revoke select on ships from anon, authenticated;
grant select (id, name, reg_no, permit_no, gear, owner_line_id, created_at, ais_sample) on ships to anon, authenticated;
grant select on items, events, item_balance to authenticated;
grant select on members, declarations to authenticated;
revoke insert, update, delete, truncate on businesses, members, ships, products, items, events, scales, declarations from anon, authenticated;

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
