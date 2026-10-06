// 消費者画面の日英対応
// STR＝画面の文言、TERMS＝マスタから来る言葉の英語名。TERMS にない言葉（自由入力のメモなど）は訳さずそのまま出す
import { useEffect, useState } from 'react'

export const TERMS = {
  // 魚種
  'メカジキ': 'Swordfish', 'ヨシキリザメ': 'Blue shark', 'メバチ': 'Bigeye tuna', 'キハダ': 'Yellowfin tuna', 'クロマグロ': 'Pacific bluefin tuna',
  'ミナミマグロ': 'Southern bluefin tuna', 'カツオ': 'Skipjack tuna',
  // 銘柄（サイズの区分）
  '大': 'Large', '中': 'Medium', '小': 'Small', '区分なし': 'Ungraded',
  // 海域・港
  '北西太平洋（FAO 61）': 'Northwest Pacific (FAO 61)', '三陸沖': 'Off Sanriku', '中東部大西洋（FAO 34）': 'Eastern Central Atlantic (FAO 34)',
  '中西部太平洋（FAO 71）': 'Western Central Pacific (FAO 71)', '南西太平洋（FAO 81）': 'Southwest Pacific (FAO 81)', 'インド洋東部（FAO 57）': 'Eastern Indian Ocean (FAO 57)',
  '気仙沼港': 'Kesennuma Port', 'ラス・パルマス港（スペイン）': 'Port of Las Palmas (Spain)',
  // 漁法・保存方法
  'はえ縄': 'Longline', '一本釣り': 'Pole and line', '−18℃以下': '−18°C or below', '4℃以下': '4°C or below',
  // 製品
  'メカジキ ロイン（冷凍）': 'Swordfish loin (frozen)', 'メカジキ 切り身パック': 'Swordfish fillet pack',
  'サメ ヒレ（乾燥前）': 'Shark fin (undried)', 'サメ 肉（冷凍）': 'Shark meat (frozen)', 'サメ 皮': 'Shark skin',
  'クロマグロ 柵（冷凍）': 'Bluefin tuna block (frozen)', 'メバチ 柵（生）': 'Bigeye tuna block (fresh)',
  'カツオ たたき（冷凍）': 'Seared skipjack (frozen)', 'カツオ 刺身用ロイン（生）': 'Skipjack loin for sashimi (fresh)',
  // 漁船・事業者（サンプルの名前。本番ではマスタに英語名の欄を持たせる）
  '第八 海鳴丸': 'Kainari Maru No. 8', '第五 浜風丸': 'Hamakaze Maru No. 5', '第十八 潮丸': 'Ushio Maru No. 18',
  '気仙沼市魚市場（サンプル）': 'Kesennuma City Fish Market (sample)', 'サンプル加工': 'Sample Processing Co.', 'サンプル小売': 'Sample Retail',
}

// 言葉を表示する言語に合わせる
export const term = (lang, s) => (lang === 'en' && s && TERMS[s]) || s

// 画面の言葉は「見出し＋短い値」。説明の文は使わず、必要なものだけ一行の注記にする
export const STR = {
  ja: {
    eyebrow: 'GYOSEKI · 個体の記録', eyebrowLot: 'GYOSEKI · 水揚げロットの記録', eyebrowMix: 'GYOSEKI · 商品の記録',
    mixTitle: (n) => `原料 ${n}件`, mixLead: '加工ロットに入れた魚。1件ずつ船の位置データと照合。',
    mixChapter: (n) => `${n}件をまとめて加工`, declaredBy: (who, at) => `申告：${who}（${at}）`, mixOk: '申告どおり', mixNoAis: '位置データなし', mixLanded: (d, kg) => `水揚げ ${d} · ${kg} kg`,
    familyLeadMix: '加工品の重さの合計 ≦ 原料の重さ（記録ごとに照合）', mixShare: '原料の割合（重さ）',
    fromLot: (day, ship, species, grade, count, kg) => `水揚げロット：${day} · ${ship ?? '—'} · ${species}（${grade ?? '区分なし'}）約${count}尾 · ${kg} kg`,
    tagline: '水産物の来歴記録',
    meta: (kg, ship, species) => `${kg} kg ・ ${species}${ship ? ` ・ 漁船：${ship}` : ''}`,
    sealWait: '照合中', sealOk: '改ざんなし', sealNg: '記録不一致',
    sealWaitSub: '', sealOkSub: (n) => `記録 ${n}件を照合済み`, sealNgSub: '一部の記録が書き換えられた可能性',
    statKm: '移動距離', daysUnit: () => ' 日', statDays: '水揚げからの日数', recordsUnit: ' 件', statRecords: '記録件数',
    photoRoot: '水揚げ時', photoRootLot: '水揚げ時', photoOk: '写真：照合済み', photoProcessed: '加工後',
    photoAlt: (species) => `${species}（水揚げ時）`, photoAltOwn: (name) => name,
    mapTitle: '移動経路', mapNote: '海域は代表地点。地図 © OpenFreeMap / OpenStreetMap', mapFallback: '地図を表示できません',
    replayFishing: '操業', replayVoyage: '航海', replayLanded: '水揚げ', replayStop: '記録', replayFishCount: (n) => `操業 ${n}回`, replayAgain: '▶ 再生',
    pinCatch: '漁獲', pinApprox: '（代表地点）', unknownArea: '海域不明', pinLanded: '水揚げ', pinLandedProcessed: '水揚げ・加工',
    pinDid: { landing: '水揚げ', auction: 'せり', storage: '保管', process: '加工', born: '加工', activate: 'ラベル貼付', ship: '出荷', receive: '受け取り', sell: '販売' },
    handedTo: (n) => `引き渡し先：${n}`, receivedFrom: (n) => `受け取り元：${n}`, displayedAs: (n) => `売場表示：${n}`,
    lotPack: (unit, q) => `${unit} × ${q}パック`, packNo: (n, q) => `パック ${n} / ${q}`,
    journeyTitle: '記録の一覧',
    noArea: '海域：記録なし', period: (p) => `漁獲期間 ${p}`, landedOn: (d) => `水揚げ ${d}`, processedOn: (d) => `加工 ${d}`,
    storage: (s) => `保存 ${s}`, bestBefore: '賞味期限', useBy: '消費期限', keepAt: (s) => `保存方法：${s}`,
    familyTitle: (kg, name, n) => <>{name} {kg}<br />→ 加工品 {n}件</>,
    familyLead: '加工品の重さの合計 ≦ 元の重さ（記録ごとに照合）',
    familyLeadLot: '水揚げロット（船・水揚げ日・銘柄）単位で記録。加工品の重さの合計 ≦ ロットの重さ（記録ごとに照合）',
    thisProduct: '本商品', otherProducts: 'その他の加工品', trimmings: '骨・皮・端材',
    proofToggle: '記録の証明', proofFor: 'ハッシュ・ブロックチェーン',
    proofLead: '各記録は直前の記録のハッシュを含む。1件でも書き換えると、以降のハッシュが一致しなくなる。',
    proofOnchain: 'ハッシュはブロックチェーンにも記録済み。記録した事業者も変更不可。「チェーンで確認」から照合できる。',
    proofPending: '（最新の記録をブロックチェーンへ書き込み中）',
    proofNone: '（ブロックチェーン接続前の記録を含む。そのハッシュはデータベースのみに保存）',
    proofOff: '（ブロックチェーン未接続。ハッシュはデータベースに保存）',
    evProcess: '子ID発行', evActivate: 'QR有効化', viewOnChain: 'チェーンで確認', notOnChain: 'チェーン未記録',
    forBusiness: '事業者ログイン', empty: '記録なし',
    inactiveTitle: 'ラベル未有効', inactiveLead: '販売開始後に記録を表示します。',
    missingTitle: '記録が見つかりません', missingLead: 'QR を読み直してください。', demoPicker: '表示する商品（デモ）',
    erasedTitle: '記録削除の疑い',
    erasedLead: 'このラベル番号はブロックチェーンに登録済みですが、データベースに記録がありません。販売店または登録事業者に確認してください。',
    erasedId: 'ラベル番号', erasedIssuer: '登録事業者',
    aisTitle: '船の位置データとの照合',
    aisLead: '漁船の位置信号（AIS）の公開データ（Global Fishing Watch）と申告を照合。',
    aisArea: '漁場', aisDeclared: (a, p) => `申告：${a}${p ? ` · ${p}` : ''}`, aisSeen: (list, total) => `位置データ：${list}（操業 ${total}回）`,
    aisAreaOk: '申告どおり', aisAreaPartial: '一部が申告外の海域', aisAreaNg: '申告と違う海域',
    aisAreaNone: '操業データなし（信号未受信の可能性）',
    aisAreaNoneInPeriod: '漁獲期間内に操業データなし（期間違い・信号未受信の可能性）',
    aisPort: '入港', aisPortOk: (port, d) => `${port} ${d}`, aisPortNg: (port) => `${port}の入港データなし`,
    aisRoute: '寄港地', aisNote: 'データは約4日遅れ。点＝操業位置',
    aisLoading: '照合中…', aisError: '位置データを読み込めません',
    aisSample: '表示例：位置データは見本（この商品の船のものではありません）', aisMapNote: '橙の点＝操業位置（AIS）',
  },
  en: {
    eyebrow: 'GYOSEKI · Fish record', eyebrowLot: 'GYOSEKI · Catch lot record', eyebrowMix: 'GYOSEKI · Product record',
    mixTitle: (n) => `Inputs: ${n}`, mixLead: 'Fish in this processing lot. Each checked against vessel tracking data.',
    mixChapter: (n) => `${n} catches processed together`, declaredBy: (who, at) => `Declared by ${who} (${at})`, mixOk: 'Matches declaration', mixNoAis: 'No tracking data', mixLanded: (d, kg) => `Landed ${d} · ${kg} kg`,
    familyLeadMix: 'Total product weight ≤ input weight (checked on every record)', mixShare: 'Input share (by weight)',
    fromLot: (day, ship, species, grade, count, kg) => `Catch lot: ${day} · ${ship ?? '—'} · ${species} (${grade ?? 'Ungraded'}) approx. ${count} fish · ${kg} kg`,
    tagline: 'Seafood traceability records',
    meta: (kg, ship, species) => `${kg} kg · ${species}${ship ? ` · Vessel: ${ship}` : ''}`,
    sealWait: 'Verifying', sealOk: 'Not altered', sealNg: 'Records do not match',
    sealWaitSub: '', sealOkSub: (n) => `${n} record${n === 1 ? '' : 's'} verified`, sealNgSub: 'Part of the record may have been altered',
    statKm: 'Distance', daysUnit: (n) => (n === 1 ? ' day' : ' days'), statDays: 'Since landing', recordsUnit: '', statRecords: 'Records',
    photoRoot: 'At landing', photoRootLot: 'At landing', photoOk: 'Photo verified', photoProcessed: 'Processed',
    photoAlt: (species) => `${species} (at landing)`, photoAltOwn: (name) => name,
    mapTitle: 'Route', mapNote: 'Fishing area at a representative point. Map © OpenFreeMap / OpenStreetMap', mapFallback: 'Map unavailable',
    replayFishing: 'FISHING', replayVoyage: 'VOYAGE', replayLanded: 'LANDED', replayStop: 'RECORDED', replayFishCount: (n) => `${n} fishing events`, replayAgain: '▶ Play',
    pinCatch: 'Caught', pinApprox: ' (approx.)', unknownArea: 'Unknown area', pinLanded: 'Landed', pinLandedProcessed: 'Landed & processed',
    pinDid: { landing: 'Landed', auction: 'Auction', storage: 'Stored', process: 'Processed', born: 'Processed', activate: 'Labeled', ship: 'Shipped', receive: 'Received', sell: 'On sale' },
    handedTo: (n) => `To: ${n}`, receivedFrom: (n) => `From: ${n}`, displayedAs: (n) => `Shelf name: ${n}`,
    lotPack: (unit, q) => `${unit} × ${q} packs`, packNo: (n, q) => `Pack ${n} / ${q}`,
    journeyTitle: 'Record log',
    noArea: 'Area: not recorded', period: (p) => `Fishing period ${p}`, landedOn: (d) => `Landed ${d}`, processedOn: (d) => `Processed ${d}`,
    storage: (s) => `Storage ${s}`, bestBefore: 'Best before', useBy: 'Use by', keepAt: (s) => `Storage: ${s}`,
    familyTitle: (kg, name, n) => <>{name} {kg}<br />→ {n} products</>,
    familyLead: 'Total product weight ≤ original weight (checked on every record)',
    familyLeadLot: 'Recorded per catch lot (vessel · landing date · grade). Total product weight ≤ lot weight (checked on every record)',
    thisProduct: 'This product', otherProducts: 'Other products', trimmings: 'Bones, skin, trimmings',
    proofToggle: 'Proof', proofFor: 'Hashes · blockchain',
    proofLead: 'Each record includes the hash of the previous record. Changing any record breaks every hash after it.',
    proofOnchain: 'Hashes are also recorded on a blockchain and cannot be changed, even by the recording business. Verify with "View on chain".',
    proofPending: '(Writing the latest record to the blockchain)',
    proofNone: '(Includes records made before the blockchain connection; their hashes are stored in the database only)',
    proofOff: '(Blockchain not connected; hashes stored in the database)',
    evProcess: 'Sub-IDs issued', evActivate: 'QR activated', viewOnChain: 'View on chain', notOnChain: 'Not on chain',
    forBusiness: 'Business login', empty: 'No records',
    inactiveTitle: 'Label not active', inactiveLead: 'Records are shown once the product is on sale.',
    missingTitle: 'Record not found', missingLead: 'Scan the QR code again.', demoPicker: 'Product (demo)',
    erasedTitle: 'Possible deletion of records',
    erasedLead: 'This label number is registered on the blockchain, but its records are missing from the database. Contact the store or the registering business.',
    erasedId: 'Label number', erasedIssuer: 'Registered by',
    aisTitle: 'Vessel tracking check',
    aisLead: 'Declaration checked against public AIS data (Global Fishing Watch).',
    aisArea: 'Fishing area', aisDeclared: (a, p) => `Declared: ${a}${p ? ` · ${p}` : ''}`, aisSeen: (list, total) => `Tracking: ${list} (${total} fishing events)`,
    aisAreaOk: 'Matches declaration', aisAreaPartial: 'Partly outside declared area', aisAreaNg: 'Outside declared area',
    aisAreaNone: 'No fishing activity found (signal may not have been received)',
    aisAreaNoneInPeriod: 'No fishing activity in the declared period (wrong period or signal not received)',
    aisPort: 'Port call', aisPortOk: (port, d) => `${port} ${d}`, aisPortNg: (port) => `No port call at ${port}`,
    aisRoute: 'Port calls', aisNote: 'Data delayed approx. 4 days. Dots = fishing positions',
    aisLoading: 'Checking…', aisError: 'Tracking data unavailable',
    aisSample: 'Sample: tracking data is not from this product’s vessel', aisMapNote: 'Orange dots = fishing positions (AIS)',
  },
}

// 記録の種類（大きな英語の見出し＋日本語）
export const EV_LABEL = {
  landing: { en: 'LANDED', ja: '水揚げ' },
  auction: { en: 'AUCTION', ja: 'せり' },
  storage: { en: 'STORED', ja: '冷凍・保管' },
  born: { en: 'PROCESSED', ja: '加工' },
  ship: { en: 'SHIPPED', ja: '出荷' },
  fix: { en: 'CORRECTED', ja: '訂正' },
  receive: { en: 'RECEIVED', ja: '受け取り' },
  sell: { en: 'ON SALE', ja: '販売' },
}

// 最初の言語：URL の ?lang= → 前回選んだ言語 → 端末の言語（日本語以外なら英語）
function initialLang() {
  const q = new URLSearchParams(location.search).get('lang')
  if (q === 'ja' || q === 'en') return q
  try {
    const saved = localStorage.getItem('hama-lang')
    if (saved === 'ja' || saved === 'en') return saved
  } catch { /* 保存できない環境でも動かす */ }
  return (navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export function useLang() {
  const [lang, setLang] = useState(initialLang)
  useEffect(() => {
    document.documentElement.lang = lang
    try { localStorage.setItem('hama-lang', lang) } catch { /* 同上 */ }
  }, [lang])
  return [lang, setLang]
}
