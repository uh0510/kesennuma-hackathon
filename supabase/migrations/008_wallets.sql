-- 2026-10-05 追加：作成済みの DB に対して SQL Editor で1回実行する（seed.sql にも同じ内容を入れてある）
-- 事業者の署名用アドレス（公開してよい値）。チェーンの記録から「どの事業者が発行したか」を名前で出すのに使う
-- （記録が消された疑いの画面で、チェーンに残っている発行者のアドレスを事業者名に直す）
update businesses set wallet = '0x565984e1955B5d4176F4dC1AF5151c4F01B279D4' where id = '00000000-0000-0000-0000-000000000001';
update businesses set wallet = '0xb97621650acF1D9A057d2B1F6aBf3792E62ff626' where id = '00000000-0000-0000-0000-000000000002';
update businesses set wallet = '0xaE3Aa5DACebCB87B7f47471B5ADF731De29FC962' where id = '00000000-0000-0000-0000-000000000003';

-- 確認：3社とも wallet が入っている
select name, wallet from businesses order by id;
