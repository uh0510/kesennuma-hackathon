// Supabase Edge Function：追記を受け取り、ハッシュを計算してDBに保存し、チェーンに記録する
// 呼び出し：POST /functions/v1/record-event
//   { itemId, type, payload, parentId?, newItem?, photo? }   ※ Authorization ヘッダにログイン中のユーザーのトークン
//   まとめて送る：{ batch: [{ itemId, type, payload, parentId?, newItem? }, ...], photo?, location? }
//     加工（born）・引き渡し（ship / auction）・受け取り（receive）を、同じ種類だけまとめて1回で記録する。
//     確認の決まりは1件ずつのときと同じ。チェーンは引き渡し・受け取りを recordBatch の1回の取引にまとめる
//   photo = { base64, mediaType }。Storage（photos バケット）に保存し、写真の指紋を payload.photo に入れて記録の指紋に含める
//   location = { lat, lng, accuracy }（記録した場所）。その時点の事業者の登録住所の座標と距離を添えて payload.location に入れる
// 水揚げ（landing）は、1尾ずつ（individual：マグロ系）か、まとまり（catch_lot：船 × 水揚げ日 × 魚種 × 銘柄。quantity は尾数）
// 加工品（born）の魚種は、画面から送られた値ではなく親の魚種を使う（途中で魚種を書き換えられないように）
// 加工ロット：{ mix: { itemId, name, inputs: [魚のID, ...], detail? }, photo?, location? }
//   自分が持っている・まだ加工していない魚を何尾かまとめて1つの加工ロット（process_lot）にする。
//   加工ロットに born（入れた魚と重さの一覧 payload.inputs を指紋に含める）、入れた魚それぞれに process（payload.into）を記録する。
//   入れた魚は、そのあと加工・引き渡し・販売できない（加工ロットから加工品を発行する）
// 入札の単位に分ける（仕分け）：{ split: { parentId, lots: [{ itemId, weightKg, count, grade?, lengthCm? }, ...] }, photo?, location? }（市場だけ）
//   自分が持っている水揚げロットを、入札にかける箱・山ごとに子の水揚げロット（ID は 親ID-01, -02 …）に分ける。
//   子の重さの合計は元の重さを超えられない。子に split（payload.from＝元）、元に split（payload.lots＝分けた一覧）を記録する。
//   分けたあとの元は、せり・出荷・販売できない（分けたものごとに記録する）。チェーンでは子を元の子として発行する（水揚げと同じ種類）
// 受け渡しの鎖：せり・出荷で payload.toId に渡す相手を指定 → 相手が receive すると持ち主が移る。
//   加工・せり・出荷・保管・QR有効化・販売開始は今の持ち主だけ。受け取りは指定された相手だけ。それ以外は拒否する
// 秘密情報（Supabase の secrets に登録）：
//   CHAIN_RPC_URL（旧 AMOY_RPC_URL）, REGISTRY_ADDRESS, ISSUER_KEYS = {"<business_id>":"0x<private key>", ...}
//   REGISTRY_ADDRESS が未設定のあいだはチェーン記録を飛ばす（DBだけで動かす。tx_hash は空のまま）
//   チェーンへの送信に失敗しても DB の記録は残っているので ok:true で返し、chainError に理由を入れる
// QR は販売開始（sell）を記録したときに自動で有効にする（消費者が読めるのは店頭に出てから）。
//   手で有効化する type='activate' は受け付けない
// 個体・加工品の発行（landing / born）では、そのときの値とマスタの値を payload.item に写し取り、指紋に含める。
//   → あとでマスタを直しても、この記録の内容と指紋は変わらない。items の値が写しと食い違えば検証で分かる
// 現場の人にウォレット操作をさせないため、事業者ごとの鍵をサーバーで預かって署名する（プロトタイプの割り切り）
// チェーンは TraceRegistryV2：記録の種類ごとに書ける役割が決まっている（漁獲申告＝漁船、水揚げ・せり＝市場、加工＝加工・小売、販売開始＝小売）。
//   同じ決まりをここでも先に確かめ、DB とチェーンが食い違わないようにする（ROLE_BIT・ALLOWED はコントラクトと同じ）
// 漁獲の申告：{ declare: { species, catchArea, catchFrom, catchTo, estKg?, estCount? }, location?, photo? }（漁船だけ）
//   水揚げ（landing）で payload.declarationId を送ると、魚種・船・海域・漁獲期間は申告の値を使い、申告の写しを payload.declaration に入れる
// はかりの署名つきの重さ：水揚げ・受け取りで payload.scale_reading（まとめて受け取るときは body.scale_reading）に
//   { id, kg, at, a（はかりのアドレス）, s（署名） } を送ると、署名・登録・30分以内・使い回し・重さの一致を確かめて payload.scale に入れる
//   はかりの登録：{ registerScale: { address, name, sig } }（sig は登録の文への、はかりの鍵の署名）
import { createClient } from 'npm:@supabase/supabase-js@2'
import { ethers } from 'npm:ethers@6'

const ABI = [
  'function issue(bytes32 itemId, bytes32 parentId, uint8 kind, bytes32 dataHash)',
  'function issueMix(bytes32 itemId, bytes32[] inputs, bytes32 dataHash)',
  'function record(bytes32 itemId, uint8 kind, bytes32 dataHash)',
  'function recordBatch(bytes32[] itemIds, uint8 kind, bytes32[] dataHashes)',
]
// 記録の種類（コントラクトの番号）と、書ける役割（コントラクトの初期値と同じ）
const KIND: Record<string, number> = { catch: 1, landing: 2, split: 2, auction: 3, receive: 4, ship: 5, process: 6, born: 6, sell: 7, storage: 8, fix: 9 }
const ROLE_BIT: Record<string, number> = { vessel: 1, market: 2, processor: 4, retailer: 8, exporter: 16 }
const TRADE = 2 | 4 | 8 | 16
const ALLOWED: Record<number, number> = { 1: 1, 2: 2, 3: 2, 4: TRADE, 5: TRADE, 6: 4 | 8, 7: 8, 8: TRADE, 9: TRADE | 1 }
const KIND_NAME: Record<string, string> = {
  catch: '漁獲の申告', landing: '水揚げの登録', split: '入札の単位に分けること', auction: 'せり', receive: '受け取り', ship: '出荷', process: '加工', born: '加工品の発行',
  sell: '販売開始', storage: '保管', fix: '訂正',
}
const ROLE_NAME: Record<number, string> = { 1: '漁船', 2: '市場', 4: '加工', 8: '小売', 16: '輸出' }
// deno-lint-ignore no-explicit-any
async function checkRole(supa: any, actor: string, type: string) {
  const kind = KIND[type]
  if (!kind) throw new Error(`記録の種類 ${type} は受け付けません`)
  const { data: me } = await supa.from('businesses').select('role').eq('id', actor).maybeSingle()
  if (!((ROLE_BIT[me?.role] ?? 0) & ALLOWED[kind])) {
    const who = Object.entries(ROLE_NAME).filter(([b]) => Number(b) & ALLOWED[kind]).map(([, n]) => n).join('・')
    throw new Error(`${KIND_NAME[type]}は${who}だけができます`)
  }
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
}
async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return '0x' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const itemKey = (id: string) => sha256Hex('item:' + id)

// ブラウザから呼ぶための CORS
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS })

// 画面から受け取ってよい項目だけを取り出す（qr_status などを勝手に送り込めないように）
function pickNewItem(newItem: Record<string, unknown>, type: string, parentId: string | null) {
  const n = (v: unknown) => (v === undefined || v === '' ? null : v)
  if (type === 'landing' && (newItem.kind === 'individual' || newItem.kind === 'catch_lot') && !parentId) {
    const lot = newItem.kind === 'catch_lot'
    const quantity = lot ? Math.trunc(Number(newItem.quantity ?? 1)) : 1
    if (!(quantity >= 1 && quantity <= 1000000)) throw new Error('尾数を正しく入れてください')
    if (!(Number(newItem.weight_kg) > 0)) throw new Error('重さを正しく入れてください')
    return {
      kind: newItem.kind, species: newItem.species, name: newItem.name, weight_kg: Number(newItem.weight_kg), quantity,
      ship_id: n(newItem.ship_id), catch_area: n(newItem.catch_area), landed_at: n(newItem.landed_at), landing_port: (n(newItem.landing_port) ?? '気仙沼港'),
    }
  }
  if (type === 'born' && newItem.kind === 'product' && parentId) {
    // ロット：quantity＝パック数、unit_kg＝1パックの重さ。総重量はサーバーで計算する（食い違いを作らない）
    const quantity = Math.trunc(Number(newItem.quantity ?? 1))
    const unit = Number(newItem.unit_kg ?? newItem.weight_kg)
    if (!(quantity >= 1 && quantity <= 100000) || !(unit > 0)) throw new Error('パック数と1パックの重さを正しく入れてください')
    return {
      kind: 'product', species: newItem.species, name: newItem.name, product_id: n(newItem.product_id),
      quantity, unit_kg: Math.round(unit * 1000) / 1000, weight_kg: Math.round(quantity * unit * 100) / 100,
    }
  }
  throw new Error('個体・水揚げロットは landing、加工品は born（親IDつき）で発行してください')
}

// 写真を保存し、写真そのものの指紋（SHA-256）を返す。写真を差し替えると指紋が合わなくなる
const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const PHOTO_MAX = 4 * 1024 * 1024
// deno-lint-ignore no-explicit-any
async function savePhoto(supa: any, itemId: string, photo: { base64?: string; mediaType?: string }) {
  const type = photo.mediaType ?? 'image/jpeg'
  if (!PHOTO_TYPES[type]) throw new Error('写真は JPEG / PNG / WebP にしてください')
  if (!photo.base64) throw new Error('写真のデータがありません')
  const bytes = Uint8Array.from(atob(photo.base64), (c) => c.charCodeAt(0))
  if (bytes.length > PHOTO_MAX) throw new Error('写真が大きすぎます（4MBまで）')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const sha256 = '0x' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const path = `${itemId}/${sha256.slice(2, 18)}.${PHOTO_TYPES[type]}`
  const { error } = await supa.storage.from('photos').upload(path, bytes, { contentType: type, upsert: true })
  if (error) throw error
  return { path, sha256, type }
}

// チェーンへ送る。公開 RPC は直前の取引の通し番号（nonce）を知らないことがあるので、ずれたら取り直して送り直す
// deno-lint-ignore no-explicit-any
async function sendWithRetry(wallet: ethers.Wallet, send: (nonce: number) => Promise<any>) {
  let nonce = await wallet.getNonce('pending')
  for (let i = 0; ; i++) {
    try {
      return await send(nonce)
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      if (i >= 3 || !/nonce|replacement|already known/i.test(msg)) throw e
      nonce = Math.max(nonce + 1, await wallet.getNonce('pending'))
    }
  }
}

// 今の持ち主と、引き渡し中の相手を記録の並びから割り出す
// deno-lint-ignore no-explicit-any
async function custody(supa: any, itemId: string) {
  const { data: evs } = await supa.from('events').select('type, actor, payload').eq('item_id', itemId).order('id')
  return custodyOf(evs ?? [])
}
// deno-lint-ignore no-explicit-any
function custodyOf(evs: any[]) {
  let holder: string | null = null, pending: string | null = null, lastKg: number | null = null, into: string | null = null
  const actors = new Set<string>()
  for (const e of evs) {
    actors.add(e.actor)
    if (e.type === 'process' && e.payload?.into) into = e.payload.into
    const kg = Number(e.payload?.weight_kg)
    if (Number.isFinite(kg) && kg > 0) lastKg = kg
    if (e.type === 'landing' || e.type === 'born' || (e.type === 'split' && e.payload?.from)) { holder = e.actor; pending = null }
    else if ((e.type === 'auction' || e.type === 'ship') && e.payload?.to?.id) pending = e.payload.to.id
    else if (e.type === 'receive') { holder = e.actor; pending = null }
  }
  return { holder, pending, lastKg, actors, into }
}

// 加工品の重さの合計は、元（親）の重さを超えられない（量は増やせない）。
// さらに、製品マスタの歩留まりの上限（例：柵は 65%）も超えられない。上限は、この親から作った加工品の製品のうち一番大きいもの
// 元の重さ：最後に分かっている重さ（受け取ったときに量った重さ）。なければ発行したときの重さ
// deno-lint-ignore no-explicit-any
async function checkYield(supa: any, parentId: string, parentEvs: any[], newKg: number, productId: string | null) {
  const { data: parent } = await supa.from('items').select('weight_kg').eq('id', parentId).maybeSingle()
  if (!parent) throw new Error(`親ID ${parentId} が見つかりません`)
  const baseKg = custodyOf(parentEvs).lastKg ?? Number(parent.weight_kg)
  const { data: kids } = await supa.from('items').select('weight_kg, product_id').eq('parent_id', parentId)
  const total = (kids ?? []).reduce((n: number, k: { weight_kg: number }) => n + Number(k.weight_kg), 0) + newKg
  if (total > baseKg + 0.005) throw new Error(`加工品の重さの合計（${total.toFixed(2)}kg）が、元の重さ（${baseKg}kg）を超えます`)
  const ids = [...new Set([productId, ...(kids ?? []).map((k: { product_id: string | null }) => k.product_id)].filter(Boolean))]
  if (!ids.length) return
  const { data: prods } = await supa.from('products').select('yield_max').in('id', ids)
  const caps = (prods ?? []).map((p: { yield_max: number | null }) => p.yield_max).filter((v: number | null) => v != null).map(Number)
  if (!caps.length) return
  const cap = Math.max(...caps)
  if (total > baseKg * cap + 0.005) throw new Error(`歩留まり ${Math.round((total / baseKg) * 100)}% が上限 ${Math.round(cap * 100)}% を超えます（元 ${baseKg}kg → 加工品の合計は ${(baseKg * cap).toFixed(1)}kg まで）`)
}

// ==== はかり ====
// 署名する文（web/src/lib/scale.js と同じ形）
const scaleMessage = (id: string, kg: number, at: string) => `GYOSEKI-SCALE|${id}|${kg}|${at}`
const scaleRegisterMessage = (address: string) => `GYOSEKI-SCALE-REGISTER|${address.toLowerCase()}`
const SCALE_MAX_AGE = 30 * 60 * 1000

// はかりの値を確かめ、記録に入れる形にして返す（送られていなければ null）。kg＝記録する重さ、tol＝許す差
// deno-lint-ignore no-explicit-any
async function verifyScale(supa: any, actor: string, r: any, kg: number, tol = 0.005) {
  if (!r) return null
  const { id, at, a, s } = r
  const skg = Number(r.kg)
  if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id) || !(skg > 0) || typeof at !== 'string' || typeof s !== 'string') throw new Error('はかりの値の形が正しくありません')
  let addr = ''
  try { addr = ethers.verifyMessage(scaleMessage(id, skg, at), s).toLowerCase() } catch { throw new Error('はかりの署名が正しくありません') }
  if (addr !== String(a).toLowerCase()) throw new Error('はかりの署名が正しくありません')
  const { data: sc } = await supa.from('scales').select('name, business_id').eq('address', addr).maybeSingle()
  if (!sc) throw new Error('登録されていないはかりです')
  if (sc.business_id !== actor) throw new Error('ほかの事業者のはかりの値は使えません')
  const t = Date.parse(at)
  if (!(Date.now() - t <= SCALE_MAX_AGE && t - Date.now() < 60 * 1000)) throw new Error('はかりで量ってから30分を過ぎています。量り直してください')
  if (!(Math.abs(skg - kg) <= tol)) throw new Error(`はかりの重さ（${skg}kg）と、記録する重さ（${kg}kg）が違います`)
  const { data: used } = await supa.from('events').select('id').eq('payload->scale->>id', id).limit(1)
  if (used?.length) throw new Error('このはかりの値は、もう使われています。量り直してください')
  return { id, name: sc.name, address: addr, kg: skg, at, sig: s }
}

// はかりを登録する（ログインした事業者のはかりとして。ほかの事業者が登録済みなら断る）
// deno-lint-ignore no-explicit-any
async function registerScale(supa: any, actor: string, r: any) {
  const address = String(r?.address ?? '').toLowerCase()
  const name = String(r?.name ?? '').trim().slice(0, 40)
  if (!/^0x[0-9a-f]{40}$/.test(address) || !name) throw new Error('はかりのアドレスと名前を入れてください')
  let signer = ''
  try { signer = ethers.verifyMessage(scaleRegisterMessage(address), String(r.sig)).toLowerCase() } catch { /* 下で断る */ }
  if (signer !== address) throw new Error('はかりの鍵の署名が正しくありません')
  const { data: cur } = await supa.from('scales').select('business_id').eq('address', address).maybeSingle()
  if (cur && cur.business_id !== actor) throw new Error('このはかりは、ほかの事業者が登録しています')
  const { error } = cur
    ? await supa.from('scales').update({ name }).eq('address', address)
    : await supa.from('scales').insert({ address, name, business_id: actor })
  if (error) throw error
  return { ok: true, address, name }
}

// deno-lint-ignore no-explicit-any
const bizName = async (supa: any, id: string | null) => (id ? (await supa.from('businesses').select('name').eq('id', id).maybeSingle()).data?.name ?? id : '不明')

const HOLDER_ONLY = ['process', 'auction', 'ship', 'storage', 'sell']

// 販売開始で QR を有効にする（すでに有効なものはそのまま）
// deno-lint-ignore no-explicit-any
async function activateOnSale(supa: any, ids: string[]) {
  const { error } = await supa.from('items').update({ qr_status: 'active' }).in('id', ids).eq('qr_status', 'issued')
  if (error) throw error
}

// 2点間の距離（m）
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = Math.PI / 180, R = 6371000
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// 記録した場所。数値として正しいものだけ受け取り、事業者の登録住所の座標（その時点の写し）と距離を添える
// deno-lint-ignore no-explicit-any
async function locate(supa: any, actor: string, loc: { lat?: unknown; lng?: unknown; accuracy?: unknown } | null) {
  const lat = Number(loc?.lat), lng = Number(loc?.lng)
  if (!loc || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const acc = Number(loc.accuracy)
  // 記録は誰でも読めるので、座標は約100m単位（小数3桁）に丸めて残す。登録住所との距離は丸める前の座標で計算する
  const out: Record<string, unknown> = {
    lat: Math.round(lat * 1e3) / 1e3, lng: Math.round(lng * 1e3) / 1e3,
    accuracy_m: Number.isFinite(acc) && acc > 0 ? Math.round(acc) : null,
  }
  const { data: biz } = await supa.from('businesses').select('lat, lng').eq('id', actor).maybeSingle()
  if (biz?.lat != null && biz?.lng != null) {
    out.registered = { lat: biz.lat, lng: biz.lng }
    out.distance_m = Math.round(distanceM(lat, lng, biz.lat, biz.lng))
  }
  return out
}

// 登録した瞬間の値（マスタの値を含む）を写し取る
// deno-lint-ignore no-explicit-any
async function snapshot(supa: any, row: Record<string, unknown>, parentId: string | null) {
  if (row.kind === 'individual' || row.kind === 'catch_lot') {
    const { data: ship } = row.ship_id
      ? await supa.from('ships').select('name, reg_no, permit_no, gear').eq('id', row.ship_id).single()
      : { data: null }
    return {
      kind: row.kind, species: row.species, name: row.name, weight_kg: row.weight_kg,
      ...(row.kind === 'catch_lot' ? { quantity: row.quantity } : {}),
      catch_area: row.catch_area, landed_at: row.landed_at, landing_port: row.landing_port, ship,
      ...(parentId ? { parent_id: parentId } : {}),
    }
  }
  const { data: product } = row.product_id
    ? await supa.from('products').select('name, storage, shelf_days').eq('id', row.product_id).single()
    : { data: null }
  return { kind: 'product', species: row.species, name: row.name, weight_kg: row.weight_kg, quantity: row.quantity, unit_kg: row.unit_kg, parent_id: parentId, product }
}

// ==== まとめて記録する（加工・引き渡し・受け取り） ====
const BATCH_TYPES = ['born', 'ship', 'auction', 'receive', 'sell']
const BATCH_MAX = 200
const STRIP = ['item', 'photo', 'location', 'to', 'from', 'weight_check', 'toId', 'into', 'inputs', 'scale', 'scale_reading', 'declaration', 'declarationId']
const clean = (p: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(p).filter(([k]) => !STRIP.includes(k)))

// deno-lint-ignore no-explicit-any
async function handleBatch(supa: any, actor: string, body: any) {
  const list = body.batch as Array<{ itemId: string; type: string; payload?: Record<string, unknown>; parentId?: string | null; newItem?: Record<string, unknown> | null }>
  if (!Array.isArray(list) || list.length === 0) throw new Error('まとめて記録する内容がありません')
  if (list.length > BATCH_MAX) throw new Error(`一度にまとめて記録できるのは ${BATCH_MAX} 件までです`)
  const type = list[0].type
  if (!BATCH_TYPES.includes(type) || list.some((b) => b.type !== type)) throw new Error('まとめて記録できるのは、同じ種類の加工・引き渡し・受け取り・販売開始だけです')
  const ids = list.map((b) => b.itemId)
  if (new Set(ids).size !== ids.length) throw new Error('同じIDが2回含まれています')
  await checkRole(supa, actor, type)

  // 対象の記録をまとめて読む（加工なら親、それ以外は対象のID）
  const parentId = type === 'born' ? (list[0].parentId ?? null) : null
  if (type === 'born' && (!parentId || list.some((b) => b.parentId !== parentId))) throw new Error('まとめて発行できるのは、同じ親から作る加工品だけです')
  const readIds = type === 'born' ? [parentId] : ids
  const { data: evs, error: re } = await supa.from('events').select('id, item_id, type, actor, payload, hash').in('item_id', readIds).order('id')
  if (re) throw re
  // deno-lint-ignore no-explicit-any
  const byItem: Record<string, any[]> = {}
  for (const e of evs ?? []) (byItem[e.item_id] ??= []).push(e)

  // 受け渡しの鎖の確認（1件ずつのときと同じ決まり）
  // deno-lint-ignore no-explicit-any
  const extras: Record<string, any> = {}
  let parentSpecies: string | null = null
  if (type === 'born') {
    const c = custodyOf(byItem[parentId!] ?? [])
    if (c.holder && c.holder !== actor) throw new Error(`この魚を今持っているのは ${await bizName(supa, c.holder)} です。加工できるのは持ち主だけです`)
    if (c.pending) throw new Error(`この魚は ${await bizName(supa, c.pending)} へ引き渡し中です。受け取られるまで加工できません`)
    if (c.into) throw new Error(`この魚は加工ロット ${c.into} に入れました。加工品は加工ロットから発行してください`)
    const { data: lots } = await supa.from('items').select('id').eq('parent_id', parentId).eq('kind', 'catch_lot').limit(1)
    if (lots?.length) throw new Error('この水揚げロットは入札の単位に分けました。加工品は分けたものから発行してください')
    const { data: parent } = await supa.from('items').select('species').eq('id', parentId).maybeSingle()
    if (!parent) throw new Error(`親ID ${parentId} が見つかりません`)
    parentSpecies = parent.species
  } else {
    // deno-lint-ignore no-explicit-any
    let to: any = null
    if (type === 'ship' || type === 'auction') {
      const toId = list[0].payload?.toId
      if (!toId || list.some((b) => b.payload?.toId !== toId)) throw new Error('まとめて引き渡すときは、同じ相手を指定してください')
      if (toId === actor) throw new Error('自分自身には引き渡せません')
      const { data } = await supa.from('businesses').select('id, name').eq('id', toId).maybeSingle()
      if (!data) throw new Error('渡す相手の事業者が見つかりません')
      to = { id: data.id, name: data.name }
    }
    if (type === 'ship' || type === 'auction' || type === 'sell') {
      // 加工済み（子IDがある）のものは丸ごとは渡せない・売れない
      const { data: kids } = await supa.from('items').select('parent_id, kind').in('parent_id', ids).limit(1)
      if (kids?.length) throw new Error(kids[0].kind === 'catch_lot' ? `${kids[0].parent_id} は入札の単位に分けました。分けたものごとに記録してください` : `${kids[0].parent_id} は加工済みです。加工品ごとに記録してください`)
    }
    const holderNames: Record<string, string> = {}
    for (const b of list) {
      const c = custodyOf(byItem[b.itemId] ?? [])
      if (!byItem[b.itemId]) throw new Error(`${b.itemId} が見つかりません`)
      if (c.into) throw new Error(`${b.itemId} は加工ロット ${c.into} に入れました`)
      if (type === 'receive') {
        if (c.pending !== actor) throw new Error(`${b.itemId} の受け取り先はあなたではありません`)
        holderNames[c.holder!] ??= await bizName(supa, c.holder)
        const e: Record<string, unknown> = { from: { id: c.holder, name: holderNames[c.holder!] } }
        const kg = Number(b.payload?.weight_kg)
        if (Number.isFinite(kg) && kg > 0 && c.lastKg) e.weight_check = { prev_kg: c.lastKg, kg, diff_kg: Math.round((kg - c.lastKg) * 100) / 100 }
        extras[b.itemId] = e
      } else {
        if (c.holder && c.holder !== actor) throw new Error(`${b.itemId} を今持っているのは ${await bizName(supa, c.holder)} です。記録できるのは持ち主だけです`)
        if (type === 'sell' && c.pending) throw new Error(`${b.itemId} は引き渡し中です。受け取られるまで販売できません`)
        extras[b.itemId] = type === 'sell' ? {} : { to }
      }
    }
  }

  // はかりの署名つきの合計の重さ（まとめて受け取るときだけ。各ロットの重さは合計を割り振ったもの）
  let scale = null
  if (body.scale_reading) {
    if (type !== 'receive') throw new Error('はかりの値を使えるのは、水揚げと受け取りだけです')
    const sum = list.reduce((n, b) => n + Number(b.payload?.weight_kg ?? 0), 0)
    scale = await verifyScale(supa, actor, body.scale_reading, Math.round(sum * 100) / 100, Math.max(0.005, 0.006 * list.length))
  }

  // 写真（加工品に添えるときは1枚を全員で共有）と場所（受け取りのとき）
  const photo = body.photo ? await savePhoto(supa, ids[0], body.photo) : null
  const where = await locate(supa, actor, body.location ?? null)

  // 加工品をまとめて作る
  // deno-lint-ignore no-explicit-any
  let snaps: Record<string, any> = {}
  if (type === 'born') {
    const rows = list.map((b) => ({ ...pickNewItem(b.newItem ?? {}, 'born', parentId), species: parentSpecies }))
    await checkYield(supa, parentId!, byItem[parentId!] ?? [], rows.reduce((n, r) => n + Number(r.weight_kg), 0), (rows[0].product_id as string | null) ?? null)
    const { error } = await supa.from('items').insert(rows.map((r, i) => ({ ...r, id: ids[i], parent_id: parentId, created_by: actor })))
    if (error) throw error
    const product = rows[0].product_id ? (await supa.from('products').select('name, storage, shelf_days').eq('id', rows[0].product_id).single()).data : null
    snaps = Object.fromEntries(rows.map((r, i) => [ids[i], { kind: 'product', species: r.species, name: r.name, weight_kg: r.weight_kg, quantity: r.quantity, unit_kg: r.unit_kg, parent_id: parentId, product }]))
  }

  // 記録をまとめて作る（指紋は1件ずつ、直前の記録の指紋を含めて計算）
  const t0 = Date.now()
  const events = []
  for (const [i, b] of list.entries()) {
    let p: Record<string, unknown> = { ...clean(b.payload), ...(extras[b.itemId] ?? {}) }
    if (photo) p = { ...p, photo }
    if (where) p = { ...p, location: where }
    if (scale) p = { ...p, scale: { ...scale, total: true } }
    if (snaps[b.itemId]) p = { ...p, item: snaps[b.itemId] }
    const prevHash = byItem[b.itemId]?.at(-1)?.hash ?? null
    const createdAt = new Date(t0 + i).toISOString()
    const hash = await sha256Hex(canonical({ itemId: b.itemId, type, actor, payload: p, prevHash, createdAt }))
    events.push({ item_id: b.itemId, type, actor, payload: p, prev_hash: prevHash, hash, created_at: createdAt })
  }
  const { data: saved, error: ie } = await supa.from('events').insert(events).select('id, item_id, hash')
  if (ie) throw ie
  if (type === 'sell') await activateOnSale(supa, ids)

  // チェーンに記録（未設定ならDBだけ）。失敗しても DB の記録は残っているので ok で返す
  const registry = Deno.env.get('REGISTRY_ADDRESS')
  if (!registry) return { ok: true, count: saved.length, txHash: null }
  try {
    const keys = JSON.parse(Deno.env.get('ISSUER_KEYS') ?? '{}')
    if (!keys[actor]) throw new Error(`事業者 ${actor} の署名鍵が ISSUER_KEYS にありません`)
    const wallet = new ethers.Wallet(keys[actor], new ethers.JsonRpcProvider(Deno.env.get('CHAIN_RPC_URL') ?? Deno.env.get('AMOY_RPC_URL')))
    const reg = new ethers.Contract(registry, ABI, wallet)
    let nonce = await wallet.getNonce('pending')
    const byId = Object.fromEntries(saved.map((s: { item_id: string; id: number; hash: string }) => [s.item_id, s]))
    let lastTx: string | null = null
    if (type === 'born') {
      // 発行は1件ずつの取引（コントラクトの都合）。確認を待たずに、通し番号を手元で数えて続けて送る
      const parentKey = await itemKey(parentId!)
      const sent: Array<{ id: number; tx: string }> = []
      for (const id of ids) {
        const tx = await reg.issue(await itemKey(id), parentKey, KIND.born, byId[id].hash, { nonce: nonce++, gasLimit: 250000 })
        sent.push({ id: byId[id].id, tx: tx.hash })
        lastTx = tx.hash
      }
      // 取引の番号の書き込みは最後にまとめて（送るたびに待たない）
      await Promise.all(sent.map((s) => supa.from('events').update({ tx_hash: s.tx }).eq('id', s.id)))
    } else {
      // 引き渡し・受け取りは recordBatch の1回の取引にまとめる
      const k = await Promise.all(ids.map((id) => itemKey(id)))
      const tx = await reg.recordBatch(k, KIND[type], ids.map((id) => byId[id].hash), { nonce: nonce++, gasLimit: 80000 + 45000 * ids.length })
      await supa.from('events').update({ tx_hash: tx.hash }).in('id', saved.map((s: { id: number }) => s.id))
      lastTx = tx.hash
    }
    return { ok: true, count: saved.length, txHash: lastTx }
  } catch (e) {
    const reason = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e)
    return { ok: true, count: saved.length, txHash: null, chainError: reason }
  }
}

// ==== 漁獲の申告（漁船が水揚げの前に） ====
// deno-lint-ignore no-explicit-any
async function handleDeclare(supa: any, actor: string, body: any) {
  await checkRole(supa, actor, 'catch')
  const { data: me } = await supa.from('businesses').select('ship_id').eq('id', actor).maybeSingle()
  if (!me?.ship_id) throw new Error('この漁船の事業者に、船がひも付いていません')
  const d = body.declare ?? {}
  const day = /^\d{4}-\d{2}-\d{2}$/
  if (typeof d.species !== 'string' || !d.species || typeof d.catchArea !== 'string' || !d.catchArea) throw new Error('魚種と海域を入れてください')
  if (!day.test(String(d.catchFrom)) || !day.test(String(d.catchTo)) || d.catchFrom > d.catchTo) throw new Error('漁獲期間を正しく入れてください')
  const { data: ship } = await supa.from('ships').select('id, name, reg_no, permit_no, gear').eq('id', me.ship_id).single()
  const ymd6 = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).replaceAll('-', '').slice(2)
  const id = `DCL-${ymd6}-${crypto.getRandomValues(new Uint8Array(2)).reduce((a, b) => a + b.toString(16).padStart(2, '0'), '').toUpperCase()}`
  const num = (v: unknown) => (Number(v) > 0 ? Number(v) : null)
  let p: Record<string, unknown> = {
    detail: `漁獲の申告・${d.species}・${d.catchArea}`, species: d.species, catch_area: d.catchArea, catch_from: d.catchFrom, catch_to: d.catchTo,
    est_kg: num(d.estKg), est_count: num(d.estCount), ship,
  }
  const where = await locate(supa, actor, body.location ?? null)
  if (where) p = { ...p, location: where }
  if (body.photo) p = { ...p, photo: await savePhoto(supa, id, body.photo) }
  const createdAt = new Date().toISOString()
  const hash = await sha256Hex(canonical({ itemId: id, type: 'catch', actor, payload: p, prevHash: null, createdAt }))
  const { error } = await supa.from('declarations').insert({
    id, ship_id: ship.id, declared_by: actor, species: d.species, catch_area: d.catchArea, catch_from: d.catchFrom, catch_to: d.catchTo,
    payload: p, hash, created_at: createdAt,
  })
  if (error) throw error

  const registry = Deno.env.get('REGISTRY_ADDRESS')
  if (!registry) return { ok: true, id, hash, txHash: null }
  try {
    const keys = JSON.parse(Deno.env.get('ISSUER_KEYS') ?? '{}')
    if (!keys[actor]) throw new Error(`事業者 ${actor} の署名鍵が ISSUER_KEYS にありません`)
    const wallet = new ethers.Wallet(keys[actor], new ethers.JsonRpcProvider(Deno.env.get('CHAIN_RPC_URL') ?? Deno.env.get('AMOY_RPC_URL')))
    const reg = new ethers.Contract(registry, ABI, wallet)
    const key = await itemKey(id)
    const tx = await sendWithRetry(wallet, (nonce) => reg.issue(key, ethers.ZeroHash, KIND.catch, hash, { nonce }))
    await supa.from('declarations').update({ tx_hash: tx.hash }).eq('id', id)
    return { ok: true, id, hash, txHash: tx.hash }
  } catch (e) {
    const reason = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e)
    return { ok: true, id, hash, txHash: null, chainError: reason }
  }
}

// ==== 加工ロット（何尾かをまとめて1回の加工に入れる） ====
const MIX_MAX = 100
// deno-lint-ignore no-explicit-any
async function handleMix(supa: any, actor: string, body: any) {
  const { itemId, name, inputs, detail } = body.mix ?? {}
  await checkRole(supa, actor, 'process')
  if (typeof itemId !== 'string' || !/^KSN-[A-Z]+-\d{6}-M\d{3}$/.test(itemId)) throw new Error('加工ロットのIDが正しくありません')
  if (!Array.isArray(inputs) || inputs.length < 1) throw new Error('入れる魚を選んでください')
  if (inputs.length > MIX_MAX) throw new Error(`一度に入れられるのは ${MIX_MAX} 件までです`)
  if (new Set(inputs).size !== inputs.length) throw new Error('同じ魚が2回選ばれています')
  const { data: exists } = await supa.from('items').select('id').eq('id', itemId).maybeSingle()
  if (exists) throw new Error(`ID ${itemId} はすでに使われています`)

  // 入れる魚：水揚げの単位（1尾・水揚げロット）で、自分が持っていて、まだ加工していないもの。魚種はそろえる
  const { data: rows, error: e1 } = await supa.from('items').select('id, kind, species, weight_kg').in('id', inputs)
  if (e1) throw e1
  const byId = Object.fromEntries((rows ?? []).map((r: { id: string }) => [r.id, r]))
  const { data: evs, error: e2 } = await supa.from('events').select('id, item_id, type, actor, payload, hash').in('item_id', inputs).order('id')
  if (e2) throw e2
  // deno-lint-ignore no-explicit-any
  const evOf: Record<string, any[]> = {}
  for (const e of evs ?? []) (evOf[e.item_id] ??= []).push(e)
  const { data: kids } = await supa.from('items').select('parent_id').in('parent_id', inputs).limit(1)
  if (kids?.length) throw new Error(`${kids[0].parent_id} はもう加工品を発行しています`)
  const used: Array<{ id: string; kg: number }> = []
  for (const id of inputs) {
    const r = byId[id]
    if (!r) throw new Error(`${id} が見つかりません`)
    if (r.kind !== 'individual' && r.kind !== 'catch_lot') throw new Error(`${id} は水揚げの単位ではありません（加工ロットに入れられるのは、1尾か水揚げロットだけです）`)
    const c = custodyOf(evOf[id] ?? [])
    if (c.holder !== actor) throw new Error(`${id} を今持っているのは ${await bizName(supa, c.holder)} です`)
    if (c.pending) throw new Error(`${id} は ${await bizName(supa, c.pending)} へ引き渡し中です`)
    if (c.into) throw new Error(`${id} はもう加工ロット ${c.into} に入れました`)
    used.push({ id, kg: Number(c.lastKg ?? r.weight_kg) })
  }
  const species = byId[inputs[0]].species
  if (inputs.some((id: string) => byId[id].species !== species)) throw new Error('魚種の違う魚は、同じ加工ロットに入れられません')
  const total = Math.round(used.reduce((n, u) => n + u.kg, 0) * 100) / 100

  const photo = body.photo ? await savePhoto(supa, itemId, body.photo) : null
  const where = await locate(supa, actor, body.location ?? null)
  const lotName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : `${species} 加工ロット`
  const { error: e3 } = await supa.from('items').insert({ id: itemId, kind: 'process_lot', species, name: lotName, weight_kg: total, quantity: 1, inputs, created_by: actor })
  if (e3) throw e3

  // 記録：加工ロットに born（入れた魚と重さの一覧を指紋に含める）、入れた魚それぞれに process
  const t0 = Date.now()
  const at = (i: number) => new Date(t0 + i).toISOString()
  let p: Record<string, unknown> = {
    detail: typeof detail === 'string' && detail ? detail.slice(0, 200) : `${inputs.length}件をまとめて加工ロットに（${total}kg）`,
    weight_kg: total, inputs: used, item: { kind: 'process_lot', species, name: lotName, weight_kg: total, inputs },
  }
  if (photo) p = { ...p, photo }
  if (where) p = { ...p, location: where }
  const lotHash = await sha256Hex(canonical({ itemId, type: 'born', actor, payload: p, prevHash: null, createdAt: at(0) }))
  const events = [{ item_id: itemId, type: 'born', actor, payload: p, prev_hash: null, hash: lotHash, created_at: at(0) }]
  for (const [i, u] of used.entries()) {
    const q = { detail: `加工ロット ${itemId} に投入`, into: itemId, weight_kg: u.kg }
    const prevHash = evOf[u.id]?.at(-1)?.hash ?? null
    const hash = await sha256Hex(canonical({ itemId: u.id, type: 'process', actor, payload: q, prevHash, createdAt: at(i + 1) }))
    events.push({ item_id: u.id, type: 'process', actor, payload: q, prev_hash: prevHash, hash, created_at: at(i + 1) })
  }
  const { data: saved, error: e4 } = await supa.from('events').insert(events).select('id, item_id, hash')
  if (e4) throw e4

  // チェーン：加工ロットを発行（親なし。入れた魚の一覧は指紋で守る）し、入れた魚への追記を1回の取引にまとめる
  const registry = Deno.env.get('REGISTRY_ADDRESS')
  if (!registry) return { ok: true, count: saved.length, txHash: null }
  try {
    const keys = JSON.parse(Deno.env.get('ISSUER_KEYS') ?? '{}')
    if (!keys[actor]) throw new Error(`事業者 ${actor} の署名鍵が ISSUER_KEYS にありません`)
    const wallet = new ethers.Wallet(keys[actor], new ethers.JsonRpcProvider(Deno.env.get('CHAIN_RPC_URL') ?? Deno.env.get('AMOY_RPC_URL')))
    const reg = new ethers.Contract(registry, ABI, wallet)
    let nonce = await wallet.getNonce('pending')
    const s = Object.fromEntries(saved.map((x: { item_id: string; id: number; hash: string }) => [x.item_id, x]))
    const ids = used.map((u) => u.id)
    const inputKeys = await Promise.all(ids.map((id) => itemKey(id)))
    const tx1 = await reg.issueMix(await itemKey(itemId), inputKeys, lotHash, { nonce: nonce++, gasLimit: 150000 + 30000 * ids.length })
    const tx2 = await reg.recordBatch(inputKeys, KIND.process, ids.map((id) => s[id].hash), { nonce: nonce++, gasLimit: 80000 + 45000 * ids.length })
    await supa.from('events').update({ tx_hash: tx1.hash }).eq('id', s[itemId].id)
    await supa.from('events').update({ tx_hash: tx2.hash }).in('id', ids.map((id) => s[id].id))
    return { ok: true, count: saved.length, txHash: tx2.hash }
  } catch (e) {
    const reason = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e)
    return { ok: true, count: saved.length, txHash: null, chainError: reason }
  }
}

// ==== 入札の単位に分ける（仕分け） ====
const SPLIT_MAX = 50
// deno-lint-ignore no-explicit-any
async function handleSplit(supa: any, actor: string, body: any) {
  const { parentId, lots } = body.split ?? {}
  if (typeof parentId !== 'string' || !parentId) throw new Error('分ける水揚げロットを指定してください')
  if (!Array.isArray(lots) || lots.length < 1) throw new Error('分ける内容を入れてください')
  if (lots.length > SPLIT_MAX) throw new Error(`一度に分けられるのは ${SPLIT_MAX} 件までです`)
  await checkRole(supa, actor, 'split')

  const { data: parent } = await supa.from('items').select('*').eq('id', parentId).maybeSingle()
  if (!parent) throw new Error(`${parentId} が見つかりません`)
  if (parent.kind !== 'catch_lot' || parent.parent_id) throw new Error('分けられるのは水揚げロットだけです（分けたものをさらに分けることはできません）')
  const { data: pevs, error: pe } = await supa.from('events').select('id, type, actor, payload, hash').eq('item_id', parentId).order('id')
  if (pe) throw pe
  const c = custodyOf(pevs ?? [])
  if (c.holder !== actor) throw new Error(`この水揚げロットを今持っているのは ${await bizName(supa, c.holder)} です。分けられるのは持ち主だけです`)
  if (c.pending) throw new Error(`この水揚げロットは ${await bizName(supa, c.pending)} へ引き渡し中です`)
  if (c.into) throw new Error(`この水揚げロットは加工ロット ${c.into} に入れました`)
  const { data: kids } = await supa.from('items').select('id, kind, weight_kg').eq('parent_id', parentId)
  if ((kids ?? []).some((k: { kind: string }) => k.kind !== 'catch_lot')) throw new Error('この水揚げロットは、もう加工品を発行しています')

  // 1件ずつの中身を確かめる（ID は 親ID-01 の形、重さ・尾数は正の数）
  if (!/^[A-Z0-9-]+$/.test(parentId)) throw new Error('水揚げロットのIDが正しくありません')
  const idRe = new RegExp('^' + parentId + '-\\d{2}$')
  const rows = lots.map((l: Record<string, unknown>) => {
    const id = String(l.itemId ?? '')
    if (!idRe.test(id)) throw new Error(`ID ${id} は「${parentId}-01」の形にしてください`)
    const kg = Math.round(Number(l.weightKg) * 100) / 100
    const count = Math.trunc(Number(l.count))
    if (!(kg > 0)) throw new Error(`${id} の重さを正しく入れてください`)
    if (!(count >= 1 && count <= 1000000)) throw new Error(`${id} の尾数を正しく入れてください`)
    const grade = typeof l.grade === 'string' && l.grade.trim() ? l.grade.trim().slice(0, 20) : null
    const len = Math.round(Number(l.lengthCm))
    return { id, kg, count, grade, lengthCm: len > 0 && len < 1000 ? len : null }
  })
  const ids = rows.map((r: { id: string }) => r.id)
  if (new Set(ids).size !== ids.length) throw new Error('同じIDが2回含まれています')
  const { data: exists } = await supa.from('items').select('id').in('id', ids).limit(1)
  if (exists?.length) throw new Error(`ID ${exists[0].id} はすでに使われています`)

  // 分けた重さの合計は、元の重さ（最後に量った重さ）を超えられない
  const baseKg = c.lastKg ?? Number(parent.weight_kg)
  const before = (kids ?? []).reduce((n: number, k: { weight_kg: number }) => n + Number(k.weight_kg), 0)
  const sum = rows.reduce((n: number, r: { kg: number }) => n + r.kg, 0)
  if (before + sum > baseKg + 0.005) throw new Error(`分けた重さの合計（${(before + sum).toFixed(2)}kg）が、水揚げの重さ（${baseKg}kg）を超えます`)

  const photo = body.photo ? await savePhoto(supa, parentId, body.photo) : null
  const where = await locate(supa, actor, body.location ?? null)

  // 子の水揚げロットを作る（船・海域・水揚げ日・港は元から写す）
  const items = rows.map((r: { id: string; kg: number; count: number }) => ({
    id: r.id, kind: 'catch_lot', species: parent.species, name: parent.name, weight_kg: r.kg, quantity: r.count,
    ship_id: parent.ship_id, catch_area: parent.catch_area, landed_at: parent.landed_at, landing_port: parent.landing_port,
    parent_id: parentId, created_by: actor,
  }))
  const { error: e1 } = await supa.from('items').insert(items)
  if (e1) throw e1

  // 記録：子それぞれに split（元と重さ）、元に split（分けた一覧）
  const t0 = Date.now()
  const events = []
  for (const [i, r] of rows.entries()) {
    const snap = await snapshot(supa, items[i], parentId)
    let p: Record<string, unknown> = {
      detail: `入札の単位：${r.grade ? `${r.grade}・` : ''}約${r.count}尾・${r.kg}kg（${parentId} から）`,
      from: { id: parentId, kg: baseKg }, weight_kg: r.kg, quantity: r.count, item: snap,
      ...(r.grade ? { grade: r.grade } : {}), ...(r.lengthCm ? { length_cm: r.lengthCm } : {}),
    }
    if (photo) p = { ...p, photo }
    if (where) p = { ...p, location: where }
    const createdAt = new Date(t0 + i).toISOString()
    const hash = await sha256Hex(canonical({ itemId: r.id, type: 'split', actor, payload: p, prevHash: null, createdAt }))
    events.push({ item_id: r.id, type: 'split', actor, payload: p, prev_hash: null, hash, created_at: createdAt })
  }
  {
    let p: Record<string, unknown> = {
      detail: `入札の単位に分けた：${rows.length}件・${Math.round(sum * 100) / 100}kg`,
      lots: rows.map((r: { id: string; kg: number; count: number; grade: string | null }) => ({ id: r.id, kg: r.kg, count: r.count, grade: r.grade })),
    }
    if (photo) p = { ...p, photo }
    if (where) p = { ...p, location: where }
    const prevHash = pevs?.at(-1)?.hash ?? null
    const createdAt = new Date(t0 + rows.length).toISOString()
    const hash = await sha256Hex(canonical({ itemId: parentId, type: 'split', actor, payload: p, prevHash, createdAt }))
    events.push({ item_id: parentId, type: 'split', actor, payload: p, prev_hash: prevHash, hash, created_at: createdAt })
  }
  const { data: saved, error: e2 } = await supa.from('events').insert(events).select('id, item_id, hash')
  if (e2) throw e2

  // チェーン：子を元の子として発行し（水揚げと同じ種類）、元に追記する。失敗しても DB の記録は残っているので ok で返す
  const registry = Deno.env.get('REGISTRY_ADDRESS')
  if (!registry) return { ok: true, count: saved.length, ids, txHash: null }
  try {
    const keys = JSON.parse(Deno.env.get('ISSUER_KEYS') ?? '{}')
    if (!keys[actor]) throw new Error(`事業者 ${actor} の署名鍵が ISSUER_KEYS にありません`)
    const wallet = new ethers.Wallet(keys[actor], new ethers.JsonRpcProvider(Deno.env.get('CHAIN_RPC_URL') ?? Deno.env.get('AMOY_RPC_URL')))
    const reg = new ethers.Contract(registry, ABI, wallet)
    let nonce = await wallet.getNonce('pending')
    const byId = Object.fromEntries(saved.map((x: { item_id: string; id: number; hash: string }) => [x.item_id, x]))
    const parentKey = await itemKey(parentId)
    let lastTx: string | null = null
    for (const id of ids) {
      const tx = await reg.issue(await itemKey(id), parentKey, KIND.split, byId[id].hash, { nonce: nonce++, gasLimit: 250000 })
      await supa.from('events').update({ tx_hash: tx.hash }).eq('id', byId[id].id)
    }
    const tx = await reg.record(parentKey, KIND.split, byId[parentId].hash, { nonce: nonce++, gasLimit: 150000 })
    await supa.from('events').update({ tx_hash: tx.hash }).eq('id', byId[parentId].id)
    lastTx = tx.hash
    return { ok: true, count: saved.length, ids, txHash: lastTx }
  } catch (e) {
    const reason = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e)
    return { ok: true, count: saved.length, ids, txHash: null, chainError: reason }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const reqBody = await req.json()
    const { itemId, type, payload = {}, parentId = null, newItem = null, photo = null, location = null } = reqBody
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 呼び出した人の事業者を特定
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user } } = await supa.auth.getUser(token)
    if (!user) return json({ ok: false, error: 'ログインしてください' }, 401)
    const { data: member } = await supa.from('members').select('business_id').eq('user_id', user.id).maybeSingle()
    if (!member) return json({ ok: false, error: 'このユーザーはどの事業者にも所属していません' }, 403)
    const actor = member.business_id as string

    // まとめて送られてきたとき
    if (Array.isArray(reqBody.batch)) return json(await handleBatch(supa, actor, reqBody))
    // 加工ロットを作るとき
    if (reqBody.mix) return json(await handleMix(supa, actor, reqBody))
    // はかりを登録するとき
    if (reqBody.registerScale) return json(await registerScale(supa, actor, reqBody.registerScale))

    // 漁獲の申告（漁船だけ）
    if (reqBody.declare) return json(await handleDeclare(supa, actor, reqBody))

    // 入札の単位に分けるとき
    if (reqBody.split) return json(await handleSplit(supa, actor, reqBody))
    if (type === 'split') throw new Error('入札の単位に分けるときは split の形で送ってください')

    // 記録の種類ごとに、書ける役割か（水揚げは市場だけ、など。チェーンと同じ決まり）
    if (type !== 'activate') await checkRole(supa, actor, type)

    // 受け渡しの鎖の確認（持ち主以外・指定外の相手は拒否）
    const extra: Record<string, unknown> = {}
    if (type === 'born') {
      const c = await custody(supa, parentId)
      if (c.holder && c.holder !== actor) throw new Error(`この魚を今持っているのは ${await bizName(supa, c.holder)} です。加工できるのは持ち主だけです`)
      if (c.pending) throw new Error(`この魚は ${await bizName(supa, c.pending)} へ引き渡し中です。受け取られるまで加工できません`)
      if (c.into) throw new Error(`この魚は加工ロット ${c.into} に入れました。加工品は加工ロットから発行してください`)
      const { data: lots } = await supa.from('items').select('id').eq('parent_id', parentId).eq('kind', 'catch_lot').limit(1)
      if (lots?.length) throw new Error('この水揚げロットは入札の単位に分けました。加工品は分けたものから発行してください')
    } else if (type !== 'landing') {
      const c = await custody(supa, itemId)
      if (c.into && type !== 'fix') throw new Error(`この魚は加工ロット ${c.into} に入れました。記録は加工ロットに足してください`)
      if (type === 'receive') {
        if (!c.pending) throw new Error('この魚は引き渡し中ではありません（先に、渡す側がせり・出荷で相手を指定します）')
        if (c.pending !== actor) throw new Error(`この魚の受け取り先は ${await bizName(supa, c.pending)} です。ほかの事業者は受け取れません`)
        extra.from = { id: c.holder, name: await bizName(supa, c.holder) }
        // 重さ：前回わかっている重さとの差（増えた・減りすぎは画面で判定する）
        const kg = Number(payload.weight_kg)
        if (Number.isFinite(kg) && kg > 0 && c.lastKg) extra.weight_check = { prev_kg: c.lastKg, kg, diff_kg: Math.round((kg - c.lastKg) * 100) / 100 }
      } else if (HOLDER_ONLY.includes(type)) {
        if (c.holder && c.holder !== actor) throw new Error(`この魚を今持っているのは ${await bizName(supa, c.holder)} です。記録できるのは持ち主だけです`)
        // 加工済み（子IDがある）の親は、切り分けたあとなので丸ごとは渡せない・売れない。加工品ごとに記録する
        if (type === 'auction' || type === 'ship' || type === 'sell') {
          const { data: kids } = await supa.from('items').select('id, kind').eq('parent_id', itemId).limit(1)
          if (kids?.length) throw new Error(kids[0].kind === 'catch_lot' ? 'この水揚げロットは入札の単位に分けました。せり・出荷は分けたものごとに記録してください' : 'この魚は加工済みです。引き渡し・販売は加工品ごとに記録してください')
        }
        if (c.pending && type !== 'auction' && type !== 'ship') throw new Error(`この魚は ${await bizName(supa, c.pending)} へ引き渡し中です。受け取られるまで記録できません`)
        if ((type === 'auction' || type === 'ship') && payload.toId) {
          if (payload.toId === actor) throw new Error('自分自身には引き渡せません')
          const { data: to } = await supa.from('businesses').select('id, name').eq('id', payload.toId).maybeSingle()
          if (!to) throw new Error('渡す相手の事業者が見つかりません')
          extra.to = { id: to.id, name: to.name }
        }
      } else if (type === 'fix') {
        if (!c.actors.has(actor)) throw new Error('訂正できるのは、この魚を記録したことのある事業者だけです')
      }
    }

    // QR は販売開始で自動で有効になる（手での有効化は受け付けない）
    if (type === 'activate') throw new Error('QRは販売開始を記録すると自動で有効になります')

    // 写し（item）・写真の指紋（photo）・場所（location）はサーバーが作ったものだけ。画面から payload で送られてきたものは捨てる
    const { item: _item, photo: _photo, location: _location, to: _to, from: _from, weight_check: _wc, toId: _toId, into: _into, inputs: _inputs, scale: _scale, scale_reading: scaleReading, declaration: _decl, ...rest } = payload
    let body: Record<string, unknown> = { ...rest, ...extra }

    // 発行する項目を先に確かめ、写真を保存してから items を作る（途中で失敗しても items だけが残らないように）
    const row = newItem ? pickNewItem(newItem, type, parentId) : null
    // 漁船の申告から水揚げするとき：魚種・船・海域・漁獲期間は申告の値（市場は書き換えられない）
    let declKey: string | null = null
    if (type === 'landing' && payload.declarationId) {
      const { data: d } = await supa.from('declarations').select('*').eq('id', payload.declarationId).maybeSingle()
      if (!d) throw new Error(`申告 ${payload.declarationId} が見つかりません`)
      const { data: used } = await supa.from('events').select('item_id').eq('type', 'landing').eq('payload->declaration->>id', d.id).limit(1)
      if (used?.length) throw new Error(`申告 ${d.id} は、もう ${used[0].item_id} の水揚げに使われています`)
      Object.assign(row!, { ship_id: d.ship_id, species: d.species, name: d.species, catch_area: d.catch_area })
      const { data: by } = await supa.from('businesses').select('name').eq('id', d.declared_by).maybeSingle()
      body = {
        ...body, period: `${d.catch_from}〜${d.catch_to}`, catch_from: d.catch_from, catch_to: d.catch_to,
        declaration: { id: d.id, hash: d.hash, tx_hash: d.tx_hash, by: { id: d.declared_by, name: by?.name ?? null }, at: d.created_at,
          species: d.species, catch_area: d.catch_area, catch_from: d.catch_from, catch_to: d.catch_to, location: d.payload?.location ?? null },
      }
      delete body.declarationId
      declKey = await itemKey(d.id)
    }
    // はかりの署名つきの重さ（水揚げ・受け取りだけ）
    if (scaleReading) {
      if (type !== 'landing' && type !== 'receive') throw new Error('はかりの値を使えるのは、水揚げと受け取りだけです')
      body = { ...body, scale: await verifyScale(supa, actor, scaleReading, Number(type === 'landing' ? row?.weight_kg : payload.weight_kg)) }
    }
    if (row?.kind === 'product') {
      // 加工品の魚種は親から引き継ぐ（画面から送られた魚種は使わない）
      const { data: parent } = await supa.from('items').select('species').eq('id', parentId).maybeSingle()
      if (!parent) throw new Error(`親ID ${parentId} が見つかりません`)
      row.species = parent.species
      const { data: pevs } = await supa.from('events').select('type, actor, payload').eq('item_id', parentId).order('id')
      await checkYield(supa, parentId, pevs ?? [], Number(row.weight_kg), (row.product_id as string | null) ?? null)
    }
    if (photo) body = { ...body, photo: await savePhoto(supa, itemId, photo) }
    const where = await locate(supa, actor, location)
    if (where) body = { ...body, location: where }

    // 新しいID（個体 or 加工品）の作成。写しは指紋に含める
    if (row) {
      const { error } = await supa.from('items').insert({ ...row, id: itemId, parent_id: parentId, created_by: actor })
      if (error) throw error
      body = { ...body, item: await snapshot(supa, row, parentId) }
    }

    // 直前の記録のハッシュ
    const { data: last } = await supa.from('events').select('hash').eq('item_id', itemId).order('id', { ascending: false }).limit(1).maybeSingle()
    const prevHash = last?.hash ?? null
    const createdAt = new Date().toISOString()
    const hash = await sha256Hex(canonical({ itemId, type, actor, payload: body, prevHash, createdAt }))

    const { data: ev, error: e2 } = await supa.from('events')
      .insert({ item_id: itemId, type, actor, payload: body, prev_hash: prevHash, hash, created_at: createdAt })
      .select('id').single()
    if (e2) throw e2
    // 販売開始で QR を有効にする（ここから消費者が読めるようになる）
    if (type === 'sell') await activateOnSale(supa, [itemId])

    // チェーンに記録（未設定ならDBだけで終わる）
    const registry = Deno.env.get('REGISTRY_ADDRESS')
    if (!registry) return json({ ok: true, eventId: ev.id, hash, txHash: null })

    try {
      const keys = JSON.parse(Deno.env.get('ISSUER_KEYS') ?? '{}')
      if (!keys[actor]) throw new Error(`事業者 ${actor} の署名鍵が ISSUER_KEYS にありません`)
      const rpc = Deno.env.get('CHAIN_RPC_URL') ?? Deno.env.get('AMOY_RPC_URL')
      const wallet = new ethers.Wallet(keys[actor], new ethers.JsonRpcProvider(rpc))
      const reg = new ethers.Contract(registry, ABI, wallet)
      const key = await itemKey(itemId)
      // 申告から水揚げしたものは、チェーンでも申告を親にする（漁船の鍵の記録 → 市場の鍵の記録）
      const parentKey = parentId ? await itemKey(parentId) : declKey ?? ethers.ZeroHash
      const tx = await sendWithRetry(wallet, (nonce) => (row
        ? reg.issue(key, parentKey, KIND[type], hash, { nonce })
        : reg.record(key, KIND[type], hash, { nonce })))
      await supa.from('events').update({ tx_hash: tx.hash }).eq('id', ev.id)
      return json({ ok: true, eventId: ev.id, hash, txHash: tx.hash })
    } catch (e) {
      // 例：チェーンにつなぐ前に作った個体（チェーン上に存在しない）への追記
      const reason = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e)
      return json({ ok: true, eventId: ev.id, hash, txHash: null, chainError: reason })
    }
  } catch (e) {
    return json({ ok: false, error: String(e?.message ?? e) }, 400)
  }
})
