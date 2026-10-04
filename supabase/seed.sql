-- 魚籍（GYOSEKI） サンプルのマスタ（schema.sql のあとに SQL Editor で実行）
-- 名前・番号はすべて仮。ヒアリングで分かったら差し替える
-- 事業者の id を固定しておくと、ISSUER_KEYS（事業者ごとの署名鍵）の設定で迷わない

insert into businesses (id, name, role) values
  ('00000000-0000-0000-0000-000000000001', '気仙沼市魚市場（サンプル）', 'market'),
  ('00000000-0000-0000-0000-000000000002', 'サンプル加工',               'processor'),
  ('00000000-0000-0000-0000-000000000003', 'サンプル小売',               'retailer');

insert into ships (name, reg_no, permit_no, gear) values
  ('第八 海鳴丸', 'MG3-[登録番号]', '[許可番号]', 'はえ縄'),
  ('第五 浜風丸', 'MG3-[登録番号]', '[許可番号]', 'はえ縄');

-- 歩留まりは仮の値（加工業者へのヒアリングで確定する）
insert into products (name, species, storage, shelf_days, yield_min, yield_max) values
  ('メカジキ ロイン（冷凍）', 'メカジキ',     '−18℃以下', 182, 0.550, 0.700),
  ('メカジキ 切り身パック',   'メカジキ',     '4℃以下',     2, 0.800, 1.000),
  ('サメ ヒレ（乾燥前）',     'ヨシキリザメ', '−18℃以下', 365, null,  null),
  ('サメ 肉（冷凍）',         'ヨシキリザメ', '−18℃以下', 182, null,  null),
  ('サメ 皮',                 'ヨシキリザメ', '−18℃以下', 365, null,  null);

-- ログインユーザーと事業者のひも付け
-- 先に Authentication → Users → Add user でユーザーを作り、メールアドレスを書き換えてから実行する
insert into members (user_id, business_id, display_name)
select id, '00000000-0000-0000-0000-000000000001', '市場（デモ）' from auth.users where email = 'market@example.com';
insert into members (user_id, business_id, display_name)
select id, '00000000-0000-0000-0000-000000000002', '加工場（デモ）' from auth.users where email = 'processor@example.com';
