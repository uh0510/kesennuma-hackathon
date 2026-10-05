// Supabase と Edge Functions の呼び出しをまとめる
// 読み取りは公開キーで直接、書き込みはすべて record-event（Edge Function）を通す
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
// プロトタイプの規模なら全件読んで画面側で組み立てる方が単純
export async function fetchAll() {
  const [items, events, ships, products, businesses] = await Promise.all([
    supabase.from('items').select('*').order('created_at'),
    supabase.from('events').select('*').order('id'),
    supabase.from('ships').select('*').order('name'),
    supabase.from('products').select('*').order('name'),
    supabase.from('businesses').select('*'),
  ])
  for (const r of [items, events, ships, products, businesses]) if (r.error) throw r.error
  return { items: items.data, events: events.data, ships: ships.data, products: products.data, businesses: businesses.data }
}

// 写真の公開URL（photos バケットは公開読み取り）
export const photoUrl = (path) => `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/photos/${path}`
// compressImage の結果から、送る分だけを取り出す
const photoBody = (photo) => (photo ? { photo: { base64: photo.base64, mediaType: photo.mediaType } } : {})

// ---- 書き込み（record-event） ----
async function recordEvent(body) {
  // 記録した場所：受け取り・販売開始のときだけ取る（取れなければ付けない。Edge Function が登録住所との距離を添える）
  const needLocation = body.type === 'receive' || body.type === 'sell' || body.batch?.[0]?.type === 'receive' || body.batch?.[0]?.type === 'sell'
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

// 水揚げした個体を登録（個体IDを発行し、landing を記録）
export function registerIndividual({ itemId, species, weightKg, shipId, catchArea, period, landedAt, photo }) {
  return recordEvent({
    itemId, type: 'landing', ...photoBody(photo),
    newItem: { kind: 'individual', species, name: species, weight_kg: weightKg, ship_id: shipId, catch_area: catchArea, landed_at: landedAt },
    payload: { detail: `個体タグ取付・重量 ${weightKg}kg`, period, weight_kg: weightKg },
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

// まとめて記録する（同じ種類の加工・引き渡し・受け取りだけ）。100件ずつに分けて送る
async function sendBatch(entries, photo) {
  let last = null
  for (let i = 0; i < entries.length; i += 100) {
    last = await recordEvent({ batch: entries.slice(i, i + 100), ...(i === 0 ? photoBody(photo) : {}) })
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

// 加工品をまとめて受け取る：rows = [{ id, kg }]
export function receiveMany({ rows, detail }) {
  return sendBatch(rows.map((r) => ({ itemId: r.id, type: 'receive', payload: { detail: detail || '受け取り', weight_kg: r.kg } })))
}

// 引き渡す（せり結果・出荷）：渡す相手の事業者を指定する。相手が受け取ると持ち主が移る
export function handover({ itemId, kind, toId, detail, weightKg }) {
  const payload = { detail, toId }
  if (weightKg) payload.weight_kg = weightKg
  return recordEvent({ itemId, type: kind, payload })
}

// 受け取る：指定された相手だけができる。重さと場所を記録する
export function receiveItem({ itemId, weightKg, detail }) {
  const payload = { detail: detail || '受け取り' }
  if (weightKg) payload.weight_kg = weightKg
  return recordEvent({ itemId, type: 'receive', payload })
}

// 販売を始める：売場での表示名と場所を記録する
export function startSale({ itemId, displayName, detail }) {
  return recordEvent({ itemId, type: 'sell', payload: { detail: detail || `売場の表示：${displayName}`, display_name: displayName } })
}

// ラベルを貼ってQRを有効化（2回目はエラー）
export function activateQr(itemId) {
  return recordEvent({ itemId, type: 'activate', payload: { detail: 'ラベルを貼ってQRを有効化' } })
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
