-- 魚籍（GYOSEKI） サンプルのマスタ（schema.sql のあとに SQL Editor で実行）
-- 名前・番号はすべて仮。ヒアリングで分かったら差し替える
-- 事業者の id を固定しておくと、ISSUER_KEYS（事業者ごとの署名鍵）の設定で迷わない

insert into businesses (id, name, role, address, lat, lng) values
  ('00000000-0000-0000-0000-000000000001', '気仙沼市魚市場（サンプル）', 'market',    '宮城県気仙沼市（魚市場付近・仮）', 38.9017, 141.5779),
  ('00000000-0000-0000-0000-000000000002', 'サンプル加工',               'processor', '宮城県気仙沼市（鹿折付近・仮）',   38.9128, 141.5870),
  ('00000000-0000-0000-0000-000000000003', 'サンプル小売',               'retailer',  '宮城県仙台市（仙台駅付近・仮）',   38.2601, 140.8822);

-- 署名用アドレス（公開してよい値。チェーンの発行者を事業者名に直すのに使う）
update businesses set wallet = '0x565984e1955B5d4176F4dC1AF5151c4F01B279D4' where id = '00000000-0000-0000-0000-000000000001';
update businesses set wallet = '0xb97621650acF1D9A057d2B1F6aBf3792E62ff626' where id = '00000000-0000-0000-0000-000000000002';
update businesses set wallet = '0xaE3Aa5DACebCB87B7f47471B5ADF731De29FC962' where id = '00000000-0000-0000-0000-000000000003';

insert into ships (name, reg_no, permit_no, gear) values
  ('第八 海鳴丸', 'MG3-[登録番号]', '[許可番号]', 'はえ縄'),
  ('第五 浜風丸', 'MG3-[登録番号]', '[許可番号]', 'はえ縄'),
  ('第十八 潮丸', 'MG3-[登録番号]', '[許可番号]', '一本釣り');

-- 船の位置の記録（AIS）との照らし合わせの表示例（migrations/011_vessel_demo.sql と同じ。名前は架空）
-- 第八 海鳴丸：実在の船の公開データを表示例として使う ／ 第五 浜風丸：作りものの見本データ（申告と違う海域の例）
update ships set gfw_vessel_id = 'e6e26391d-d2e2-1679-3f5f-a27afb14f0d7', ais_sample = true where name = '第八 海鳴丸';
update ships set gfw_vessel_id = 'sample:south-pacific', ais_sample = true where name = '第五 浜風丸';

-- 歩留まりは仮の値（加工業者へのヒアリングで確定する）
insert into products (name, species, storage, shelf_days, yield_min, yield_max) values
  ('メカジキ ロイン（冷凍）', 'メカジキ',     '−18℃以下', 182, 0.550, 0.700),
  ('メカジキ 切り身パック',   'メカジキ',     '4℃以下',     2, 0.800, 1.000),
  ('サメ ヒレ（乾燥前）',     'ヨシキリザメ', '−18℃以下', 365, null,  null),
  ('サメ 肉（冷凍）',         'ヨシキリザメ', '−18℃以下', 182, null,  null),
  ('サメ 皮',                 'ヨシキリザメ', '−18℃以下', 365, null,  null),
  ('クロマグロ 柵（冷凍）',   'クロマグロ',   '−18℃以下', 182, 0.450, 0.650),
  ('メバチ 柵（生）',         'メバチ',       '4℃以下',     2, 0.450, 0.650),
  ('カツオ たたき（冷凍）',   'カツオ',       '−18℃以下', 182, 0.400, 0.600),
  ('カツオ 刺身用ロイン（生）', 'カツオ',     '4℃以下',     2, 0.450, 0.650);

-- ログインユーザーと事業者のひも付け
-- 先に Authentication → Users → Add user でユーザーを作り、メールアドレスを書き換えてから実行する
insert into members (user_id, business_id, display_name)
select id, '00000000-0000-0000-0000-000000000001', '市場（デモ）' from auth.users where email = 'market@example.com';
insert into members (user_id, business_id, display_name)
select id, '00000000-0000-0000-0000-000000000002', '加工場（デモ）' from auth.users where email = 'processor@example.com';
insert into members (user_id, business_id, display_name)
select id, '00000000-0000-0000-0000-000000000003', '小売（デモ）' from auth.users where email = 'retail@example.com';
