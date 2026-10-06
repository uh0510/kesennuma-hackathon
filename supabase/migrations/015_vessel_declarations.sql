-- 2026-10-06 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql・seed.sql にも同じ内容を入れてある）
-- 漁船の申告：漁船が自分の鍵で、水揚げの前に「魚種・海域・漁獲期間・その場の位置」を申告する。
-- 市場は水揚げの登録でその申告を選び、重さと港を足す（海域・期間は申告のまま。市場は書き換えられない）。
-- 申告した人（漁船）と量った人（市場）が分かれる。チェーンでも、申告は漁船の鍵、水揚げは市場の鍵でしか書けない（TraceRegistryV2）

-- 事業者の種類に「漁船」を足す（role を見ている CHECK を外してから付け直す）
do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'businesses'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%role%'
  loop
    execute format('alter table businesses drop constraint %I', r.conname);
  end loop;
end $$;
alter table businesses add constraint businesses_role_check check (role in ('vessel', 'market', 'processor', 'retailer', 'exporter', 'admin'));
-- 漁船の事業者が乗る船
alter table businesses add column if not exists ship_id uuid references ships(id);

-- 表示例の漁船（第八 海鳴丸）。署名用アドレスは公開してよい値
insert into businesses (id, name, role, wallet, ship_id)
select '00000000-0000-0000-0000-000000000004', '第八 海鳴丸（サンプル漁船）', 'vessel', '0x9611aFB0e2d8DdC8E4C9154b8c05677Db49A971D', id
from ships where name = '第八 海鳴丸'
on conflict (id) do nothing;

-- 漁獲の申告（追記のみ。書き換え・削除できない。tx_hash の後付けだけ可）
create table if not exists declarations (
  id          text primary key,               -- DCL-261006-1A2B
  ship_id     uuid not null references ships(id),
  declared_by uuid not null references businesses(id),
  species     text not null,
  catch_area  text not null,
  catch_from  date not null,
  catch_to    date not null,
  payload     jsonb not null,                 -- 指紋を取った内容（見込みの重さ・尾数・位置・写真）
  hash        text not null,                  -- sha256(正規化JSON)
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
drop trigger if exists trg_declarations_append_only on declarations;
create trigger trg_declarations_append_only before update or delete on declarations
for each row execute function declarations_append_only();

-- ログインした事業者は読める（市場が水揚げの登録で選ぶため）。書き込みは record-event だけ
alter table declarations enable row level security;
drop policy if exists declarations_read on declarations;
create policy declarations_read on declarations for select to authenticated using (true);
grant select on declarations to authenticated;
revoke insert, update, delete, truncate on declarations from anon, authenticated;

-- 確認：漁船の事業者が1つ（船がひも付いている）、申告の表は 0 件
select name, role, ship_id is not null as has_ship from businesses where role = 'vessel';
select count(*) from declarations;
