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

export const STR = {
  ja: {
    eyebrow: 'GYOSEKI · この1尾の戸籍', eyebrowLot: 'GYOSEKI · この魚の戸籍',
    fromLot: (day, ship, species, grade, count, kg) => `${day} に${ship ?? ''}が水揚げした${species}（${grade ?? '区分なし'}）約 ${count} 尾・${kg} kg のまとまりから`,
    tagline: '獲れた海から食卓まで、1尾ごとの戸籍',
    meta: (kg, ship, species, fromProduct) => `${kg} kg${ship ? ` ・ ${ship} が獲った${species}${fromProduct ? 'から' : ''}` : ''}`,
    sealWait: '記録を照合しています', sealOk: '記録は書き換えられていません', sealNg: '記録が一致しません',
    sealWaitSub: '少しお待ちください', sealOkSub: (n) => `${n}件の記録をすべて確かめました`, sealNgSub: '記録の一部が書き換えられた可能性があります',
    statKm: '獲れた海からの道のり', daysUnit: () => ' 日', statDays: '水揚げから', recordsUnit: ' 件', statRecords: 'ここまでの記録',
    photoRoot: '水揚げ時の、この魚の元の姿', photoRootLot: '水揚げ時の様子', photoOk: '写真も記録と一致', photoProcessed: '加工後',
    photoAlt: (species) => `${species}の水揚げ時の写真`, photoAltOwn: (name) => `${name}の写真`,
    mapTitle: '海から、気仙沼へ。', mapNote: '海域は代表地点です。地図 © OpenFreeMap / OpenStreetMap', mapFallback: 'この端末では地図を表示できませんでした',
    pinCatch: '漁獲', pinApprox: '（代表地点）', unknownArea: '海域不明', pinLanded: '水揚げ', pinLandedProcessed: '水揚げ・加工',
    pinDid: { landing: '水揚げ', auction: 'せり', storage: '保管', process: '加工', born: '加工', activate: 'ラベル貼付', ship: '出荷', receive: '受け取り', sell: '販売' },
    handedTo: (n) => `${n} へ引き渡し`, receivedFrom: (n) => `${n} から受け取り`, displayedAs: (n) => `売場での表示：${n}`,
    lotPack: (unit, q) => `${unit} × ${q}パックのロットの1パック`, packNo: (n, q) => `${q}パックのうち ${n} 番`,
    journeyTitle: 'ここまでの、すべての記録。',
    noArea: '海域の記録なし', period: (p) => `漁獲期間 ${p}`, landedOn: (d) => `${d} 水揚げ`, processedOn: (d) => `${d} 加工`,
    storage: (s) => `保存 ${s}`, bestBefore: '賞味期限', useBy: '消費期限', keepAt: (s) => `${s}で保存してください`,
    familyTitle: (kg, name, n) => <>{kg}の{name}から、<br />{n}つの加工品が生まれました。</>,
    familyLead: 'これはそのうちの1つです。分けた重さの合計が元の重さを超えないことを、記録のたびに確かめています。',
    familyLeadLot: 'これはそのうちの1つです。1尾ずつではなく、同じ船・同じ日・同じ銘柄のまとまりで記録しています。分けた重さの合計がまとまりの重さを超えないことを、記録のたびに確かめています。',
    thisProduct: 'この商品', otherProducts: 'ほかの加工品', trimmings: '骨・皮・端材など',
    proofToggle: '記録の証明を見る', proofFor: 'バイヤー・専門家向け',
    proofLead: 'それぞれの記録は、ひとつ前の記録の指紋（ハッシュ）を含んでいます。1件でも書き換えると、それ以降の指紋がすべて合わなくなります。',
    proofOnchain: '指紋はブロックチェーンにも残しているので、記録した事業者自身でもあとから書き換えられません。下のカードの「チェーンで確認」から、ブロックチェーン上の記録を誰でも確かめられます。',
    proofPending: '（最新の記録をブロックチェーンに書き込んでいるところです。数秒〜数十秒で反映されます）',
    proofNone: '（この商品にはブロックチェーンにつなぐ前の記録が含まれます。それらの指紋はデータベースだけに保存しています）',
    proofOff: '（この環境はまだブロックチェーンにつないでいません。指紋はデータベースに保存しています）',
    evProcess: '子IDを発行', evActivate: 'QRを有効化', viewOnChain: 'チェーンで確認', notOnChain: 'チェーン未接続',
    forBusiness: '事業者の方はこちら', empty: 'まだ記録がありません',
    inactiveTitle: 'このラベルはまだ有効になっていません', inactiveLead: 'お店で販売が始まると、この魚の記録を見られるようになります。',
    missingTitle: 'このQRの記録が見つかりません', missingLead: 'ラベルの QR をもう一度読み取ってください。', demoPicker: '表示する商品（デモ用）',
    erasedTitle: '記録が消された疑いがあります',
    erasedLead: 'このラベルの番号は、たしかに登録されていました（あとから消せない台帳＝ブロックチェーンに残っています）。ところが今は、その記録を見ることができません。お店か、下の事業者にお問い合わせください。',
    erasedId: 'ラベルの番号', erasedIssuer: '登録した事業者',
    aisTitle: '申告は、船の位置の記録と合っているか。',
    aisLead: '漁船は自分の位置の信号（AIS）を出しています。その記録を Global Fishing Watch がまとめた公開データと、水揚げのときの申告を照らし合わせています。',
    aisArea: '漁をした海域', aisDeclared: (a, p) => `申告：${a}${p ? `・${p}` : ''}`, aisSeen: (list, total) => `位置の記録：${list}（漁をしたと見られる ${total} 回のうち）`,
    aisAreaOk: '申告どおりの海域で漁をしていました', aisAreaPartial: '一部は申告と違う海域で漁をしていました', aisAreaNg: '申告と違う海域で漁をしていました',
    aisAreaNone: '漁の記録が見つかりません（位置の信号が届いていなかった可能性があります）',
    aisAreaNoneInPeriod: '申告した期間に、漁の記録が見つかりません（期間が違う、または位置の信号が届いていなかった可能性があります）',
    aisPort: '水揚げした港', aisPortOk: (port, d) => `${port} への入港を確認しました（${d}）`, aisPortNg: (port) => `${port} への入港が、位置の記録に見つかりません`,
    aisRoute: '寄った港（位置の記録）', aisNote: 'データは約4日遅れです。漁をしたと見られる場所を点で示しています',
    aisLoading: '船の位置の記録を確かめています…', aisError: '船の位置の記録を読めませんでした',
    aisSample: '表示例：この欄は仕組みを見せるための見本です。位置の記録は、この商品の船のものではありません（別の船の公開データ、または作りもののデータ）。', aisMapNote: '橙の点＝船が漁をしたと見られる場所（AIS）',
  },
  en: {
    eyebrow: 'GYOSEKI · The registry of this fish', eyebrowLot: 'GYOSEKI · The registry of this catch',
    fromLot: (day, ship, species, grade, count, kg) => `From a catch of about ${count} ${species} (${grade ?? 'Ungraded'}, ${kg} kg in total) landed by ${ship ?? 'a vessel'} on ${day}`,
    tagline: 'A registry for every fish, from the sea to your table',
    meta: (kg, ship, species, fromProduct) => `${kg} kg${ship ? ` · ${fromProduct ? `from a ${species}` : species} caught by ${ship}` : ''}`,
    sealWait: 'Checking the records', sealOk: 'The records have not been altered', sealNg: 'The records do not match',
    sealWaitSub: 'One moment, please', sealOkSub: (n) => (n === 1 ? 'The record is verified' : `All ${n} records verified`), sealNgSub: 'Part of the record may have been altered',
    statKm: 'Journey from the sea', daysUnit: (n) => (n === 1 ? ' day' : ' days'), statDays: 'Since landing', recordsUnit: '', statRecords: 'Records so far',
    photoRoot: 'This fish as it was landed', photoRootLot: 'The catch as it was landed', photoOk: 'Photo matches the record', photoProcessed: 'Processed',
    photoAlt: (species) => `${species} at landing`, photoAltOwn: (name) => `Photo of ${name}`,
    mapTitle: 'From the sea to Kesennuma.', mapNote: 'Fishing area shown at a representative point. Map © OpenFreeMap / OpenStreetMap', mapFallback: 'The map cannot be shown on this device',
    pinCatch: 'Caught', pinApprox: ' (approx.)', unknownArea: 'Unknown area', pinLanded: 'Landed', pinLandedProcessed: 'Landed & processed',
    pinDid: { landing: 'Landed', auction: 'Auction', storage: 'Stored', process: 'Processed', born: 'Processed', activate: 'Labeled', ship: 'Shipped', receive: 'Received', sell: 'On sale' },
    handedTo: (n) => `Handed to ${n}`, receivedFrom: (n) => `Received from ${n}`, displayedAs: (n) => `Sold as: ${n}`,
    lotPack: (unit, q) => `One pack from a lot of ${q} × ${unit}`, packNo: (n, q) => `Pack ${n} of ${q}`,
    journeyTitle: 'Every step, on the record.',
    noArea: 'No fishing area recorded', period: (p) => `Fishing period: ${p}`, landedOn: (d) => `Landed ${d}`, processedOn: (d) => `Processed ${d}`,
    storage: (s) => `Storage: ${s}`, bestBefore: 'Best before', useBy: 'Use by', keepAt: (s) => `Keep at ${s}`,
    familyTitle: (kg, name, n) => <>One {kg} {name}<br />became {n} products.</>,
    familyLead: 'This is one of them. Every time a record is added, we check that the pieces never weigh more than the original fish.',
    familyLeadLot: 'This is one of them. The catch is recorded as one batch — same vessel, same day, same size grade — rather than fish by fish. Every time a record is added, we check that the pieces never weigh more than the batch.',
    thisProduct: 'This product', otherProducts: 'Other products', trimmings: 'Bones, skin and trimmings',
    proofToggle: 'See the proof', proofFor: 'For buyers and experts',
    proofLead: 'Each record contains the fingerprint (hash) of the record before it. Change a single record, and every fingerprint after it stops matching.',
    proofOnchain: 'The fingerprints are also written to a blockchain, so not even the business that made a record can change it later. Anyone can check them on the blockchain with "View on chain" below.',
    proofPending: '(The latest record is being written to the blockchain. It appears within a few seconds.)',
    proofNone: '(This product includes records made before the blockchain was connected. Their fingerprints are kept in the database only.)',
    proofOff: '(This environment is not connected to a blockchain yet. The fingerprints are kept in the database.)',
    evProcess: 'Sub-IDs issued', evActivate: 'QR activated', viewOnChain: 'View on chain', notOnChain: 'Not on chain',
    forBusiness: 'For businesses', empty: 'No records yet',
    inactiveTitle: 'This label is not active yet', inactiveLead: 'Its record becomes visible once the product goes on sale in a store.',
    missingTitle: 'No record found for this QR code', missingLead: 'Please scan the label again.', demoPicker: 'Product to show (demo)',
    erasedTitle: 'This record may have been deleted',
    erasedLead: 'This label number was registered — the blockchain, which cannot be altered afterwards, still holds that fact. But its records can no longer be found. Please contact the store or the business below.',
    erasedId: 'Label number', erasedIssuer: 'Registered by',
    aisTitle: 'Does the declaration match where the vessel actually was?',
    aisLead: 'Fishing vessels broadcast their position (AIS). We compare the declaration made at landing with public data compiled by Global Fishing Watch.',
    aisArea: 'Fishing area', aisDeclared: (a, p) => `Declared: ${a}${p ? `, ${p}` : ''}`, aisSeen: (list, total) => `Tracking data: ${list} (of ${total} apparent fishing events)`,
    aisAreaOk: 'Fished in the declared area', aisAreaPartial: 'Part of the fishing was outside the declared area', aisAreaNg: 'Fished outside the declared area',
    aisAreaNone: 'No fishing activity found (the position signal may not have been received)',
    aisAreaNoneInPeriod: 'No fishing activity found in the declared period (the period may be wrong, or the position signal may not have been received)',
    aisPort: 'Port of landing', aisPortOk: (port, d) => `Port call at ${port} confirmed (${d})`, aisPortNg: (port) => `No port call at ${port} found in the tracking data`,
    aisRoute: 'Port calls (tracking data)', aisNote: 'Data is delayed by about 4 days. Dots show apparent fishing locations',
    aisLoading: 'Checking the vessel tracking data…', aisError: 'Could not load the vessel tracking data',
    aisSample: 'Sample display: this panel only demonstrates how the check works. The tracking data is not from this product’s vessel (it is public data from another vessel, or made-up data).', aisMapNote: 'Orange dots = apparent fishing locations (AIS)',
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
