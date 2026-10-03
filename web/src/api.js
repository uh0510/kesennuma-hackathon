// Supabase と Edge Functions の呼び出しをまとめる
// 読み取りは公開キーで直接、書き込みはすべて record-event（Edge Function）を通す
import { createClient } from '@supabase/supabase-js'
import { ethers } from 'ethers'
import { verifyChain, itemKey, sha256HexBytes } from './lib/hash.js'

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

const REGISTRY = import.meta.env.VITE_REGISTRY_ADDRESS
const RPC = import.meta.env.VITE_AMOY_RPC_URL
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
  const { data, error } = await supabase.functions.invoke('record-event', { body })
  if (error) {
    // Edge Function が返したエラー文を取り出す
    const msg = await error.context?.json?.().then((j) => j.error).catch(() => null)
    throw new Error(msg ?? error.message)
  }
  if (!data?.ok) throw new Error(data?.error ?? '記録に失敗しました')
  return data
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
export async function processItem({ parent, childIds, productId, name, weights, photo }) {
  await recordEvent({ itemId: parent.id, type: 'process', payload: { detail: `子ID ${childIds.length}件を発行（${name}）`, children: childIds } })
  for (const [i, id] of childIds.entries()) {
    await recordEvent({
      itemId: id, parentId: parent.id, type: 'born', ...photoBody(photo),
      newItem: { kind: 'product', species: parent.species, name, weight_kg: weights[i], product_id: productId ?? null },
      payload: { detail: `親ID ${parent.id} から発行`, weight_kg: weights[i] },
    })
  }
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
export async function verifyItem(events) {
  if (events.length === 0) return { ok: false, onchain: false, reason: '記録がありません' }
  if (!chainEnabled) {
    const r = await verifyChain(events, events.at(-1).hash)
    return { ...r, onchain: false }
  }
  const reg = new ethers.Contract(REGISTRY, REGISTRY_ABI, new ethers.JsonRpcProvider(RPC))
  const latest = await reg.latestHash(await itemKey(events[0].item_id))
  const r = await verifyChain(events, latest)
  return { ...r, onchain: true }
}
