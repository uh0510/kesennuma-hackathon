-- 2026-10-04 追加：作成済みの DB に対して SQL Editor で1回実行する（schema.sql にも同じ内容を入れてある）
-- 記録の種類に「受け取り（receive）」「販売開始（sell）」を足す
-- せり（auction）・出荷（ship）は payload.to に渡す相手を持ち、相手が receive して持ち主が移る
alter table events drop constraint if exists events_type_check;
alter table events add constraint events_type_check
  check (type in ('catch','landing','auction','storage','process','born','ship','fix','activate','receive','sell'));
