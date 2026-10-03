// 記録のハッシュ計算（ブラウザ・Edge Function 共通）
// 同じ内容なら誰が計算しても同じ値になるよう、キーを並べ替えたJSON（正規化JSON）にしてから SHA-256 をとる

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return '0x' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 写真などのバイト列の SHA-256（Edge Function と同じ 0x 付きの16進数）
export async function sha256HexBytes(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return '0x' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 1件の記録のハッシュ：前の記録のハッシュも含めるので、途中の1件を書き換えると以降がすべて合わなくなる
export async function eventHash({ itemId, type, actor, payload, prevHash, createdAt }) {
  return sha256Hex(canonical({ itemId, type, actor, payload, prevHash: prevHash ?? null, createdAt }))
}

// チェーン上の itemId（bytes32）：ID文字列の SHA-256
export async function itemKey(itemId) {
  return sha256Hex('item:' + itemId)
}

// 改ざん検証：DBの記録を順に計算し直し、最後の値がチェーン上の latestHash と一致するか
// created_at は DB から "2026-10-03T05:20:21.986+00:00" の形で返るので、
// 保存時（toISOString の "…Z"）と同じ形に戻してから計算する
export async function verifyChain(events, onchainLatest) {
  let prev = null
  for (const e of events) {
    const createdAt = new Date(e.created_at).toISOString()
    const h = await eventHash({ itemId: e.item_id, type: e.type, actor: e.actor, payload: e.payload, prevHash: prev, createdAt })
    if (h !== e.hash) return { ok: false, brokenAt: e.id }
    prev = h
  }
  return { ok: prev === onchainLatest, brokenAt: null }
}
