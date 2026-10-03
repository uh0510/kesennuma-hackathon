// Supabase Edge Function：追記を受け取り、ハッシュを計算してDBに保存し、チェーンに記録する
// 呼び出し：POST /functions/v1/record-event
//   { itemId, type, payload, parentId?, newItem? }   ※ Authorization ヘッダにログイン中のユーザーのトークン
// 秘密情報（Supabase の secrets に登録）：
//   AMOY_RPC_URL, REGISTRY_ADDRESS, ISSUER_KEYS = {"<business_id>":"0x<private key>", ...}
//   REGISTRY_ADDRESS が未設定のあいだはチェーン記録を飛ばす（DBだけで動かす。tx_hash は空のまま）
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
    const { itemId, type, payload = {}, parentId = null, newItem = null } = await req.json()
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

    // 新しいID（個体 or 加工品）の作成。写しは指紋に含める
    // 写し（item）はサーバーが作ったものだけ。画面から送られてきたものは捨てる
    const { item: _ignored, ...rest } = payload
    let body: Record<string, unknown> = rest
    if (newItem) {
      const row = pickNewItem(newItem, type, parentId)
      const { error } = await supa.from('items').insert({ ...row, id: itemId, parent_id: parentId, created_by: actor })
      if (error) throw error
      body = { ...rest, item: await snapshot(supa, row, parentId) }
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

    const keys = JSON.parse(Deno.env.get('ISSUER_KEYS') ?? '{}')
    if (!keys[actor]) throw new Error(`事業者 ${actor} の署名鍵が ISSUER_KEYS にありません`)
    const wallet = new ethers.Wallet(keys[actor], new ethers.JsonRpcProvider(Deno.env.get('AMOY_RPC_URL')))
    const reg = new ethers.Contract(registry, ABI, wallet)
    const tx = newItem
      ? await reg.issue(await itemKey(itemId), parentId ? await itemKey(parentId) : ethers.ZeroHash, hash)
      : await reg.record(await itemKey(itemId), hash)
    await supa.from('events').update({ tx_hash: tx.hash }).eq('id', ev.id)

    return json({ ok: true, eventId: ev.id, hash, txHash: tx.hash })
  } catch (e) {
    return json({ ok: false, error: String(e?.message ?? e) }, 400)
  }
})
