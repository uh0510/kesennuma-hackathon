-- 2026-10-04 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql にも同じ内容を入れてある）
-- 加工品をロット（同じ規格のパックのまとまり）で発行する：quantity＝パック数、unit_kg＝1パックの重さ、weight_kg＝ロットの総重量
alter table items add column if not exists quantity int not null default 1 check (quantity > 0);
alter table items add column if not exists unit_kg numeric(10,3) check (unit_kg is null or unit_kg > 0);

-- 書き換え禁止の対象に quantity・unit_kg も加える
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
