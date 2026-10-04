// Supabase Edge Function：追記を受け取り、ハッシュを計算してDBに保存し、チェーンに記録する
// 呼び出し：POST /functions/v1/record-event
//   { itemId, type, payload, parentId?, newItem?, photo? }   ※ Authorization ヘッダにログイン中のユーザーのトークン
//   photo = { base64, mediaType }。Storage（photos バケット）に保存し、写真の指紋を payload.photo に入れて記録の指紋に含める
//   location = { lat, lng, accuracy }（記録した場所）。その時点の事業者の登録住所の座標と距離を添えて payload.location に入れる
// 加工品（born）の魚種は、画面から送られた値ではなく親の魚種を使う（途中で魚種を書き換えられないように）
// 秘密情報（Supabase の secrets に登録）：
//   CHAIN_RPC_URL（旧 AMOY_RPC_URL）, REGISTRY_ADDRESS, ISSUER_KEYS = {"<business_id>":"0x<private key>", ...}
//   REGISTRY_ADDRESS が未設定のあいだはチェーン記録を飛ばす（DBだけで動かす。tx_hash は空のまま）
//   チェーンへの送信に失敗しても DB の記録は残っているので ok:true で返し、chainError に理由を入れる
// type='activate' はQRの有効化。activate_qr で1回だけ有効にしてから記録を残す
// 個体・加工品の発行（landing / born）では、そのときの値とマスタの値を payload.item に写し取り、指紋に含める。
//   → あとでマスタを直しても、この記録の内容と指紋は変わらない。items の値が写しと食い違えば検証で分かる
// 現場の人にウォレット操作をさせないため、事業者ごとの鍵をサーバーで預かって署名する（プロトタイプの割り切り）
import { createClient } from 'npm:@supabase/supabase-js@2'
import { ethers } from 'npm:ethers@6'

const ABI = [
  'function issue(bytes32 itemId, bytes32 parentId, bytes32 dataHash)',
  'function record(bytes32 itemId, bytes32 dataHash)',
]

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
  if (type === 'landing' && newItem.kind === 'individual' && !parentId) {
    return {
      kind: 'individual', species: newItem.species, name: newItem.name, weight_kg: Number(newItem.weight_kg),
      ship_id: n(newItem.ship_id), catch_area: n(newItem.catch_area), landed_at: n(newItem.landed_at), landing_port: (n(newItem.landing_port) ?? '気仙沼港'),
    }
  }
  if (type === 'born' && newItem.kind === 'product' && parentId) {
    return { kind: 'product', species: newItem.species, name: newItem.name, weight_kg: Number(newItem.weight_kg), product_id: n(newItem.product_id) }
  }
  throw new Error('個体は landing、加工品は born（親IDつき）で発行してください')
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
  if (row.kind === 'individual') {
    const { data: ship } = row.ship_id
      ? await supa.from('ships').select('name, reg_no, permit_no, gear').eq('id', row.ship_id).single()
      : { data: null }
    return {
      kind: 'individual', species: row.species, name: row.name, weight_kg: row.weight_kg,
      catch_area: row.catch_area, landed_at: row.landed_at, landing_port: row.landing_port, ship,
    }
  }
  const { data: product } = row.product_id
    ? await supa.from('products').select('name, storage, shelf_days').eq('id', row.product_id).single()
    : { data: null }
  return { kind: 'product', species: row.species, name: row.name, weight_kg: row.weight_kg, parent_id: parentId, product }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { itemId, type, payload = {}, parentId = null, newItem = null, photo = null, location = null } = await req.json()
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 呼び出した人の事業者を特定
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user } } = await supa.auth.getUser(token)
    if (!user) return json({ ok: false, error: 'ログインしてください' }, 401)
    const { data: member } = await supa.from('members').select('business_id').eq('user_id', user.id).maybeSingle()
    if (!member) return json({ ok: false, error: 'このユーザーはどの事業者にも所属していません' }, 403)
    const actor = member.business_id as string

    // QRの有効化（2回目はここでエラーになり、記録も残らない）
    if (type === 'activate') {
      const { error } = await supa.rpc('activate_qr', { p_item: itemId })
      if (error) throw error
    }

    // 写し（item）・写真の指紋（photo）・場所（location）はサーバーが作ったものだけ。画面から payload で送られてきたものは捨てる
    const { item: _item, photo: _photo, location: _location, ...rest } = payload
    let body: Record<string, unknown> = rest

    // 発行する項目を先に確かめ、写真を保存してから items を作る（途中で失敗しても items だけが残らないように）
    const row = newItem ? pickNewItem(newItem, type, parentId) : null
    if (row?.kind === 'product') {
      // 加工品の魚種は親から引き継ぐ（画面から送られた魚種は使わない）
      const { data: parent } = await supa.from('items').select('species').eq('id', parentId).maybeSingle()
      if (!parent) throw new Error(`親ID ${parentId} が見つかりません`)
      row.species = parent.species
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
      const parentKey = parentId ? await itemKey(parentId) : ethers.ZeroHash
      const tx = await sendWithRetry(wallet, (nonce) => (row
        ? reg.issue(key, parentKey, hash, { nonce })
        : reg.record(key, hash, { nonce })))
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
