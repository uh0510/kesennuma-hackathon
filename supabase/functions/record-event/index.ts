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
import { createClient } from 'npm:@supabase/supabase-js@2'
import { ethers } from 'npm:ethers@6'

const ABI = [
  'function issue(bytes32 itemId, bytes32 parentId, bytes32 dataHash)',
  'function record(bytes32 itemId, bytes32 dataHash)',
  'function recordBatch(bytes32[] itemIds, bytes32[] dataHashes)',
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
  let holder: string | null = null, pending: string | null = null, lastKg: number | null = null
  const actors = new Set<string>()
  for (const e of evs) {
    actors.add(e.actor)
    const kg = Number(e.payload?.weight_kg)
    if (Number.isFinite(kg) && kg > 0) lastKg = kg
    if (e.type === 'landing' || e.type === 'born') { holder = e.actor; pending = null }
    else if ((e.type === 'auction' || e.type === 'ship') && e.payload?.to?.id) pending = e.payload.to.id
    else if (e.type === 'receive') { holder = e.actor; pending = null }
  }
  return { holder, pending, lastKg, actors }
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
const STRIP = ['item', 'photo', 'location', 'to', 'from', 'weight_check', 'toId']
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
      const { data: kids } = await supa.from('items').select('parent_id').in('parent_id', ids).limit(1)
      if (kids?.length) throw new Error(`${kids[0].parent_id} は加工済みです。加工品ごとに記録してください`)
    }
    const holderNames: Record<string, string> = {}
    for (const b of list) {
      const c = custodyOf(byItem[b.itemId] ?? [])
      if (!byItem[b.itemId]) throw new Error(`${b.itemId} が見つかりません`)
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

  // 写真（加工品に添えるときは1枚を全員で共有）と場所（受け取りのとき）
  const photo = body.photo ? await savePhoto(supa, ids[0], body.photo) : null
  const where = await locate(supa, actor, body.location ?? null)

  // 加工品をまとめて作る
  // deno-lint-ignore no-explicit-any
  let snaps: Record<string, any> = {}
  if (type === 'born') {
    const rows = list.map((b) => ({ ...pickNewItem(b.newItem ?? {}, 'born', parentId), species: parentSpecies }))
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
        const tx = await reg.issue(await itemKey(id), parentKey, byId[id].hash, { nonce: nonce++, gasLimit: 250000 })
        sent.push({ id: byId[id].id, tx: tx.hash })
        lastTx = tx.hash
      }
      // 取引の番号の書き込みは最後にまとめて（送るたびに待たない）
      await Promise.all(sent.map((s) => supa.from('events').update({ tx_hash: s.tx }).eq('id', s.id)))
    } else {
      // 引き渡し・受け取りは recordBatch の1回の取引にまとめる
      const k = await Promise.all(ids.map((id) => itemKey(id)))
      const tx = await reg.recordBatch(k, ids.map((id) => byId[id].hash), { nonce: nonce++, gasLimit: 80000 + 45000 * ids.length })
      await supa.from('events').update({ tx_hash: tx.hash }).in('id', saved.map((s: { id: number }) => s.id))
      lastTx = tx.hash
    }
    return { ok: true, count: saved.length, txHash: lastTx }
  } catch (e) {
    const reason = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e)
    return { ok: true, count: saved.length, txHash: null, chainError: reason }
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

    // 水揚げ（個体IDの発行）は市場だけ
    if (type === 'landing') {
      const { data: me } = await supa.from('businesses').select('role').eq('id', actor).maybeSingle()
      if (me?.role !== 'market') throw new Error('水揚げの登録（個体IDの発行）は市場だけができます')
    }

    // 受け渡しの鎖の確認（持ち主以外・指定外の相手は拒否）
    const extra: Record<string, unknown> = {}
    if (type === 'born') {
      const c = await custody(supa, parentId)
      if (c.holder && c.holder !== actor) throw new Error(`この魚を今持っているのは ${await bizName(supa, c.holder)} です。加工できるのは持ち主だけです`)
      if (c.pending) throw new Error(`この魚は ${await bizName(supa, c.pending)} へ引き渡し中です。受け取られるまで加工できません`)
    } else if (type !== 'landing') {
      const c = await custody(supa, itemId)
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
          const { data: kids } = await supa.from('items').select('id').eq('parent_id', itemId).limit(1)
          if (kids?.length) throw new Error('この魚は加工済みです。引き渡し・販売は加工品ごとに記録してください')
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
    const { item: _item, photo: _photo, location: _location, to: _to, from: _from, weight_check: _wc, toId: _toId, ...rest } = payload
    let body: Record<string, unknown> = { ...rest, ...extra }

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
