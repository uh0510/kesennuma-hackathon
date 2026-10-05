# kesennuma-hackathon
ハッカツオン2026　開発リポジトリ

## 魚籍（GYOSEKI）

魚の戸籍。水揚げした魚に1尾ごとのIDを付け、加工品は親IDでたどれるようにし、記録の指紋（ハッシュ）をブロックチェーンに残すシステムのリポジトリです。

## 構成

```
kesennuma-hackathon/
├─ docs/                    計画書・技術仕様書・ヒアリングリスト・画面イメージ
├─ web/                     画面（React + Vite + Mantine）
│  ├─ src/main.jsx          画面イメージ（いまはサンプルデータで動く）
│  └─ src/lib/
│     ├─ hash.js            記録のハッシュ計算・改ざん検証
│     └─ rules.js           重量の整合チェック・子IDの採番
├─ supabase/
│  ├─ schema.sql            DB定義（追記のみのトリガー、QRの1回だけ有効化、見える範囲の制限、重量チェック用ビュー）
│  └─ functions/
│     ├─ record-event/      追記 → ハッシュ計算 → DB保存 → チェーン記録
│     └─ ocr-slip/          伝票の写真をAIで読み取る（Claude API）
├─ contracts/               ブロックチェーン（Solidity + Hardhat）
│  ├─ contracts/TraceRegistry.sol
│  ├─ scripts/deploy.js
│  └─ test/TraceRegistry.test.js
└─ .env.example             設定値のひな形
```

## 動かし方

### 1. 画面だけ動かす（サンプルデータ）
DB につなぐときは `web/.env` に `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を書く（Vite は `web` フォルダの `.env` を読む）。
```
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/index.html 1ファイルにまとまる（ダブルクリックで開ける）
```

### 2. コントラクト
```
cd contracts
npm install
npx hardhat test                 # ローカルでテスト
cp ../.env.example .env          # DEPLOYER_KEY / ISSUERS を入れる
npm run deploy:base-sepolia      # Base Sepolia テストネットに配置。表示されたアドレスを控える
```
テストネット用の ETH（練習用・無料）は faucet から入手します（例：ZalalenA。本物の暗号資産の残高を求めるサイトは使えない）。
Polygon Amoy にも配置できる（`npm run deploy:amoy`）が、手数料が高めで練習用の通貨が足りなかったため、プロトタイプは Base Sepolia を使う。

### 3. DB と Edge Functions（Supabase）
1. Supabase でプロジェクトを作成
2. SQL Editor で `supabase/schema.sql` → `supabase/seed.sql` の順に実行（seed の最後はログインユーザーを作ってから）
   - 作成済みの DB には、`supabase/migrations/` の SQL を番号順に実行して追いつかせる（schema.sql には反映済み）
3. Supabase CLI で関数を配置
```
supabase functions deploy record-event
supabase functions deploy ocr-slip
supabase secrets set CHAIN_RPC_URL=https://sepolia.base.org REGISTRY_ADDRESS=0x... ISSUER_KEYS='{"<business_id>":"0x..."}'
```

### 4. 公開
`web` を Vercel か Cloudflare Pages に配置し、審査員が触れる公開URLを用意します。

## 設計の要点
- **データ本体はDB、チェーンには指紋だけ**：費用が安く、個人情報や価格を公開しない
- **追記のみ**：events の更新・削除はDBのトリガーで拒否。訂正は `fix` として追記
- **前の記録のハッシュを含める**：途中の1件を書き換えると、以降のハッシュがすべて合わなくなる
- **署名は事業者ごと**：誰が発行・追記したかをチェーン上で否定できない（プロトタイプでは鍵をサーバーで預かる）
- **見える範囲**：事業者は自分が記録した・受け取る（受け取った）魚とその上流だけ。消費者は QR の ID 1件分だけで、販売開始で QR が有効になってから
- **不正対策**：QRは販売開始で1回だけ有効化、子の重量の合計と歩留まりをチェック

## 注意
- `.env` や秘密鍵は Git に入れない
- 制度上の必須項目は水産課に確認してから確定する
- ライブラリのバージョンは着手時に最新の安定版を確認する
