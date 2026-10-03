-- 2026-10-03 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql にも同じ内容を入れてある）
-- items は QR の有効化（issued → active）以外は書き換え・削除できない
-- 内容を直したいときは、新しい記録（fix）を足す
create or replace function items_lock() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'items は削除できません（訂正は fix として追記してください）';
  end if;
  if (new.id, new.kind, new.parent_id, new.species, new.name, new.weight_kg, new.ship_id, new.product_id,
      new.catch_area, new.landed_at, new.landing_port, new.created_by, new.created_at)
     is distinct from
     (old.id, old.kind, old.parent_id, old.species, old.name, old.weight_kg, old.ship_id, old.product_id,
      old.catch_area, old.landed_at, old.landing_port, old.created_by, old.created_at) then
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
