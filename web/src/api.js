// Supabase と Edge Functions の呼び出しをまとめる
// 読み取り：ログインした事業者は見える範囲（自分が記録した・受け取る魚とその上流）を直接、
//           消費者は QR の ID 1件分を public_trace で（販売開始で有効になったものだけ）
// 書き込みはすべて record-event（Edge Function）を通す
import { createClient } from '@supabase/supabase-js'
import { ethers } from 'ethers'
import { verifyChain, itemKey, sha256HexBytes } from './lib/hash.js'
import { currentPosition, positionError } from './lib/geo.js'

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

const REGISTRY = import.meta.env.VITE_REGISTRY_ADDRESS
const RPC = import.meta.env.VITE_CHAIN_RPC_URL ?? import.meta.env.VITE_AMOY_RPC_URL
// 記録を確認するサイト（エクスプローラー）。テストネットを変えたらここも変える
const EXPLORER = import.meta.env.VITE_EXPLORER_URL ?? 'https://sepolia.basescan.org'
export const explorerTx = (tx) => `${EXPLORER}/tx/${tx}`
export const explorerAddress = (a) => `${EXPLORER}/address/${a}`
export const chainEnabled = Boolean(REGISTRY && /^0x[0-9a-fA-F]{40}$/.test(REGISTRY) && RPC)

// ---- ログイン ----
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error('ログインできませんでした：' + error.message)
}
export const signOut = () => supabase.auth.signOut()

// ログイン中のユーザーが所属する事業者（未ログインなら null）
export async function fetchMe() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const { data } = await supabase.from('members').select('display_name, business:businesses(id, name, role)').eq('user_id', session.user.id).maybeSingle()
  return data ? { email: session.user.email, displayName: data.display_name, business: data.business } : { email: session.user.email, business: null }
}

// ---- 読み取り ----
// 船マスタは公開してよい列だけ読む（AIS の番号・GFW の船のIDは公開しない。照合は vessel-activity がサーバーで行う）
const SHIP_COLUMNS = 'id, name, reg_no, permit_no, gear, created_at'
// ログインした事業者：見える範囲を全部読んで画面側で組み立てる（範囲は DB の RLS が絞る）
export async function fetchAll() {
  const [items, events, ships, products, businesses, declarations] = await Promise.all([
    supabase.from('items').select('*').order('created_at'),
    supabase.from('events').select('*').order('id'),
    supabase.from('ships').select(SHIP_COLUMNS).order('name'),
    supabase.from('products').select('*').order('name'),
    supabase.from('businesses').select('*'),
    supabase.from('declarations').select('*').order('created_at', { ascending: false }),
  ])
  for (const r of [items, events, ships, products, businesses, declarations]) if (r.error) throw r.error
  return { items: items.data, events: events.data, ships: ships.data, products: products.data, businesses: businesses.data, declarations: declarations.data }
}

// 消費者：QR の ID 1件分。status は 'ok' / 'inactive'（まだ販売前）/ 'missing'（ID がない）
export async function fetchTrace(id) {
  const [trace, ships, products, businesses] = await Promise.all([
    supabase.rpc('public_trace', { p_item: id }),
    supabase.from('ships').select(SHIP_COLUMNS).order('name'),
    supabase.from('products').select('*').order('name'),
    supabase.from('businesses').select('*'),
  ])
  for (const r of [trace, ships, products, businesses]) if (r.error) throw r.error
  const t = trace.data
  if (!t) {
    // DB にないのにチェーンに発行の記録が残っている＝記録が消された疑い（書き換えだけでなく、消したことも見つける）
    const issuer = await issuerOnChain(id).catch(() => null)
    if (!issuer) return { status: 'missing' }
    const biz = businesses.data.find((b) => b.wallet?.toLowerCase() === issuer.toLowerCase())
    return { status: 'erased', erased: { id, issuer, issuerName: biz?.name ?? null } }
  }
  if (t.status !== 'ok') return { status: 'inactive' }
  return { status: 'ok', db: { items: t.items, events: t.events, ships: ships.data, products: products.data, businesses: businesses.data } }
}

// チェーン上でそのIDを発行した事業者のアドレス（発行されていなければ null）
async function issuerOnChain(id) {
  if (!chainEnabled) return null
  const reg = new ethers.Contract(REGISTRY, ['function issuerOf(bytes32) view returns (address)'], new ethers.JsonRpcProvider(RPC))
  const a = await reg.issuerOf(await itemKey(id))
  return a === ethers.ZeroAddress ? null : a
}

// 漁船が実際に漁をした場所と入港した港（Global Fishing Watch の公開データ。vessel-activity が船マスタから船を引いて問い合わせる）
// 船に AIS の番号がひも付いていなければ { linked: false }
// catchFrom / catchTo（申告した漁獲期間）があれば、漁の地点はその期間だけになる
export async function fetchVesselActivity(shipId, landedAt, catchFrom, catchTo) {
  const { data, error } = await supabase.functions.invoke('vessel-activity', { body: { shipId, landedAt, catchFrom, catchTo } })
  if (error) {
    const msg = await error.context?.json?.().then((j) => j.error).catch(() => null)
    throw new Error(msg ?? error.message)
  }
  if (!data?.ok) throw new Error(data?.error ?? '位置の記録を読めませんでした')
  return data
}

// 写真の公開URL（photos バケットは公開読み取り）
export const photoUrl = (path) => `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/photos/${path}`
// compressImage の結果から、送る分だけを取り出す
const photoBody = (photo) => (photo ? { photo: { base64: photo.base64, mediaType: photo.mediaType } } : {})

// ---- 書き込み（record-event） ----
async function recordEvent(body) {
  // 記録した場所：受け取り・販売開始のときだけ取る（取れなければ付けない。Edge Function が登録住所との距離を添える）
  const needLocation = body.type === 'receive' || body.type === 'sell' || body.batch?.[0]?.type === 'receive' || body.batch?.[0]?.type === 'sell' || Boolean(body.declare)
  const location = needLocation ? await currentPosition() : null
  const { data, error } = await supabase.functions.invoke('record-event', { body: location ? { ...body, location } : body })
  if (error) {
    // Edge Function が返したエラー文を取り出す
    const msg = await error.context?.json?.().then((j) => j.error).catch(() => null)
    throw new Error(msg ?? error.message)
  }
  if (!data?.ok) throw new Error(data?.error ?? '記録に失敗しました')
  return { ...data, locationError: needLocation && !location ? positionError() : null }
}

// 水揚げのID（個体・水揚げロット）：prefix（KSN-魚種-日付-）に続く空いている連番。DB にあるIDに加えて、チェーンにすでにあるIDも飛ばす
// （デモ前に DB を消しても、チェーンの記録は残る。同じIDを使うとチェーンの指紋と合わず「改ざんの疑い」になるため）
export async function nextLandingId(prefix, knownIds) {
  const candidates = []
  for (let seq = 1; candidates.length < 20; seq++) {
    const id = prefix + String(seq).padStart(3, '0')
    if (!knownIds.includes(id)) candidates.push(id)
  }
  if (!chainEnabled) return candidates[0]
  const used = await Promise.all(candidates.map(async (id) => Boolean(await issuerOnChain(id))))
  return candidates.find((_, i) => !used[i]) ?? candidates.at(-1)
}

// 水揚げを登録（IDを発行し、landing を記録）
// lot＝false：1尾ずつ（マグロ系）。lot＝true：船 × 水揚げ日 × 魚種 × 銘柄のまとまり（count は尾数のおおよそ）
// catchFrom / catchTo は漁獲期間（YYYY-MM-DD）。period は表示用の文字（前からの形）
// scale：はかりの署名つきの値（lib/scale.js の readingBody。なければ手入力）
// declarationId：漁船の申告から登録するとき（魚種・船・海域・漁獲期間はサーバーが申告の値にする）
export function registerLanding({ itemId, species, lot, grade, count, weightKg, shipId, catchArea, landingPort, catchFrom, catchTo, landedAt, photo, scale, declarationId }) {
  const period = `${catchFrom}〜${catchTo}`
  const sr = { ...(scale ? { scale_reading: scale } : {}), ...(declarationId ? { declarationId } : {}) }
  return recordEvent({
    itemId, type: 'landing', ...photoBody(photo),
    newItem: { kind: lot ? 'catch_lot' : 'individual', species, name: species, weight_kg: weightKg, quantity: lot ? count : 1, ship_id: shipId, catch_area: catchArea, landing_port: landingPort, landed_at: landedAt },
    payload: lot
      ? { detail: `水揚げロットを登録・${grade}・約${count}尾・${weightKg}kg`, grade, period, catch_from: catchFrom, catch_to: catchTo, weight_kg: weightKg, ...sr }
      : { detail: `個体タグ取付・重量 ${weightKg}kg`, period, catch_from: catchFrom, catch_to: catchTo, weight_kg: weightKg, ...sr },
  })
}

// 追記（せり・保管・出荷・訂正）
export function appendEvent(itemId, type, detail, photo) {
  return recordEvent({ itemId, type, payload: { detail }, ...photoBody(photo) })
}

// 加工して子IDを発行：親に process を記録し、子の数だけ born を記録する
// lots = [{ id, quantity, unitKg }]：ロットごとにパック数と1パックの重さ（総重量はサーバーが計算）
export async function processItem({ parent, childIds, productId, name, lots, photo }) {
  await recordEvent({ itemId: parent.id, type: 'process', payload: { detail: `子ID ${childIds.length}件を発行（${name}）`, children: childIds } })
  // 子IDの発行はまとめて送る（Edge Function への呼び出しは最大100件ごとに1回）
  const entries = childIds.map((id, i) => ({
    itemId: id, parentId: parent.id, type: 'born',
    newItem: { kind: 'product', species: parent.species, name, product_id: productId ?? null, quantity: lots[i].quantity, unit_kg: lots[i].unitKg },
    payload: { detail: lots[i].quantity > 1 ? `親ID ${parent.id} から発行（${lots[i].quantity}パック）` : `親ID ${parent.id} から発行`, weight_kg: Math.round(lots[i].quantity * lots[i].unitKg * 100) / 100 },
  }))
  return sendBatch(entries, photo)
}

// 加工ロットを作る：自分が持っている、まだ加工していない魚（inputs＝ID の一覧）をまとめて1つの加工ロットにする
// 入れた魚と重さの一覧はサーバーが記録に入れ、指紋に含める
export function makeProcessLot({ itemId, name, inputs, photo }) {
  return recordEvent({ mix: { itemId, name, inputs }, ...photoBody(photo) })
}

// 漁獲の申告（漁船）：水揚げの前に、魚種・海域・漁獲期間・見込みの量を自分の鍵で申告する。場所も記録する
export function declareCatch({ species, catchArea, catchFrom, catchTo, estKg, estCount, photo }) {
  return recordEvent({ declare: { species, catchArea, catchFrom, catchTo, estKg, estCount }, ...photoBody(photo) })
}

// はかり：登録（ログインした事業者のはかりとして）と、登録の一覧
export const registerScale = ({ address, name, sig }) => recordEvent({ registerScale: { address, name, sig } })
export async function fetchScale(address) {
  const { data, error } = await supabase.from('scales').select('address, name, business_id').eq('address', address.toLowerCase()).maybeSingle()
  if (error) throw error
  return data
}

// まとめて記録する（同じ種類の加工・引き渡し・受け取りだけ）。100件ずつに分けて送る
// extra：1回目に一緒に送るもの（はかりの値など。はかりの値は合計の重さなので、100件を超えるときは送らない）
async function sendBatch(entries, photo, extra = {}) {
  let last = null
  for (let i = 0; i < entries.length; i += 100) {
    last = await recordEvent({ batch: entries.slice(i, i + 100), ...(i === 0 ? photoBody(photo) : {}), ...(i === 0 && entries.length <= 100 ? extra : {}) })
  }
  return last
}

// 加工品をまとめて引き渡す：rows = [{ id, kg }]
export function handoverMany({ rows, toId, detail }) {
  return sendBatch(rows.map((r) => ({ itemId: r.id, type: 'ship', payload: { detail, toId, weight_kg: r.kg } })))
}

// 加工品をまとめて販売を始める：ids と売場での表示名
export function sellMany({ ids, displayName }) {
  return sendBatch(ids.map((id) => ({ itemId: id, type: 'sell', payload: { detail: `売場の表示：${displayName}`, display_name: displayName } })))
}

// 加工品をまとめて受け取る：rows = [{ id, kg }]。checks は受け取る前に確かめた結果（{ ok, notes }。指紋に含まれる）
export function receiveMany({ rows, detail, checks, scale }) {
  return sendBatch(rows.map((r) => ({ itemId: r.id, type: 'receive', payload: { detail: detail || '受け取り', weight_kg: r.kg, ...(checks ? { checks } : {}) } })), null, scale ? { scale_reading: scale } : {})
}

// 引き渡す（せり結果・出荷）：渡す相手の事業者を指定する。相手が受け取ると持ち主が移る
export function handover({ itemId, kind, toId, detail, weightKg }) {
  const payload = { detail, toId }
  if (weightKg) payload.weight_kg = weightKg
  return recordEvent({ itemId, type: kind, payload })
}

// 受け取る：指定された相手だけができる。重さと場所、受け取る前に確かめた結果（checks）を記録する
export function receiveItem({ itemId, weightKg, detail, checks, scale }) {
  const payload = { detail: detail || '受け取り' }
  if (weightKg) payload.weight_kg = weightKg
  if (checks) payload.checks = checks
  if (scale) payload.scale_reading = scale
  return recordEvent({ itemId, type: 'receive', payload })
}

// 販売を始める：売場での表示名と場所を記録する。QR はここで有効になる（消費者が読めるようになる）
export function startSale({ itemId, displayName, detail }) {
  return recordEvent({ itemId, type: 'sell', payload: { detail: detail || `売場の表示：${displayName}`, display_name: displayName } })
}

// ---- 改ざん検証 ----
// 写真を取得して指紋を計算し直し、記録に入っている写真の指紋と一致するか
export async function verifyPhotos(events) {
  const list = events.filter((e) => e.payload?.photo?.path)
  const results = await Promise.all(list.map(async (e) => {
    try {
      const res = await fetch(photoUrl(e.payload.photo.path))
      if (!res.ok) return false
      return (await sha256HexBytes(await res.arrayBuffer())) === e.payload.photo.sha256
    } catch { return false }
  }))
  return { ok: results.every(Boolean), count: list.length }
}

// DBの記録からハッシュを計算し直す。チェーンにつながっていれば latestHash とも照合する
const REGISTRY_ABI = ['function latestHash(bytes32) view returns (bytes32)']
// chain：'match'＝チェーンと一致 / 'none'＝チェーン未記録（つなぐ前の記録） / 'pending'＝最新の記録がまだチェーンに届いていない
//        'mismatch'＝チェーンの指紋がどの記録とも合わない（改ざんの疑い） / 'off'＝チェーン未接続
export async function verifyItem(events) {
  if (events.length === 0) return { ok: false, onchain: false, chain: 'off', reason: '記録がありません' }
  const db = await verifyChain(events, events.at(-1).hash) // DB の中で指紋の鎖がつながっているか
  if (!chainEnabled) return { ...db, onchain: false, chain: 'off' }
  const reg = new ethers.Contract(REGISTRY, REGISTRY_ABI, new ethers.JsonRpcProvider(RPC))
  const latest = (await reg.latestHash(await itemKey(events[0].item_id))).toLowerCase()
  if (latest === ethers.ZeroHash) return { ...db, onchain: false, chain: 'none' }
  if (latest === events.at(-1).hash.toLowerCase()) return { ...db, onchain: true, chain: 'match' }
  if (events.some((e) => e.hash.toLowerCase() === latest)) return { ...db, onchain: false, chain: 'pending' }
  return { ...db, ok: false, onchain: false, chain: 'mismatch' }
}
