-- 2026-10-06 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql にも同じ内容を入れてある）
-- はかり：自分の鍵を持ち、量った重さと日時に署名する（はかりの画面 ?scale）。
-- 水揚げ・受け取りの重さを、はかりの署名つきの値で記録できる。record-event が署名・登録・時間・使い回しを確かめる
--   address     ：はかりの鍵のアドレス（0x…、小文字）
--   business_id ：はかりを持つ事業者（ほかの事業者のはかりの値は使えない）
-- 登録は、事業者がログインしたはかりの画面から record-event を通して行う（公開キーからは書けない）
create table if not exists scales (
  address     text primary key,
  name        text not null,
  business_id uuid not null references businesses(id),
  created_at  timestamptz not null default now()
);
alter table scales enable row level security;
drop policy if exists scales_read_all on scales;
create policy scales_read_all on scales for select using (true);
grant select on scales to anon, authenticated;
revoke insert, update, delete, truncate on scales from anon, authenticated;

-- 確認：scales の表ができている（最初は 0 件）
select count(*) from scales;
