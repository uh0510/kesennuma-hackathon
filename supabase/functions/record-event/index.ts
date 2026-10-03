// Supabase Edge Function：追記を受け取り、ハッシュを計算してDBに保存し、チェーンに記録する
// 呼び出し：POST /functions/v1/record-event
//   { itemId, type, payload, parentId?, newItem? }   ※ Authorization ヘッダにログイン中のユーザーのトークン
// 秘密情報（Supabase の secrets に登録）：
//   AMOY_RPC_URL, REGISTRY_ADDRESS, ISSUER_KEYS = {"<business_id>":"0x<private key>", ...}
//   REGISTRY_ADDRESS が未設定のあいだはチェーン記録を飛ばす（DBだけで動かす。tx_hash は空のまま）
// type='activate' はQRの有効化。activate_qr で1回だけ有効にしてから記録を残す
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

    // 新しいID（個体 or 加工品）の作成
    if (newItem) {
      const { error } = await supa.from('items').insert({ ...newItem, id: itemId, parent_id: parentId, created_by: actor })
      if (error) throw error
    }

    // 直前の記録のハッシュ
    const { data: last } = await supa.from('events').select('hash').eq('item_id', itemId).order('id', { ascending: false }).limit(1).maybeSingle()
    const prevHash = last?.hash ?? null
    const createdAt = new Date().toISOString()
    const hash = await sha256Hex(canonical({ itemId, type, actor, payload, prevHash, createdAt }))

    const { data: ev, error: e2 } = await supa.from('events')
      .insert({ item_id: itemId, type, actor, payload, prev_hash: prevHash, hash, created_at: createdAt })
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
