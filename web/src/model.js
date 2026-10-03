// 画面で使うデータの組み立てと、改ざん検証のフック（管理画面・消費者画面で共通）
import { useState, useEffect } from 'react'
import { verifyItem } from './api.js'

// 日付は日本時間で表示する
export const ymd = (s) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(s))
export const mdhm = (s) => new Date(s).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
export const shortHash = (h) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : '')
export const addDays = (s, n) => ymd(new Date(new Date(s).getTime() + n * 86400000))

// DB の行を、画面で使う形（親子・表示用の項目・履歴）に組み立てる
export function buildItems({ items, events, ships, products, businesses }) {
  const ship = Object.fromEntries(ships.map((s) => [s.id, s]))
  const prod = Object.fromEntries(products.map((p) => [p.id, p]))
  const biz = Object.fromEntries(businesses.map((b) => [b.id, b]))
  const out = {}
  for (const r of items) {
    const evs = events.filter((e) => e.item_id === r.id)
    const landing = evs.find((e) => e.type === 'landing')
    let attrs
    if (r.kind === 'individual') {
      const s = ship[r.ship_id] ?? {}
      attrs = [['魚種', r.species], ['漁船', s.name ?? '—'], ['漁船登録番号', s.reg_no ?? '—'], ['漁業許可番号', s.permit_no ?? '—'], ['漁法', s.gear ?? '—'],
        ['漁獲海域', r.catch_area ?? '—'], ['漁獲期間', landing?.payload?.period || '—'], ['水揚げ港', r.landing_port ?? '—'],
        ['水揚げ日', r.landed_at ? ymd(r.landed_at) : '—'], ['重量（水揚げ時）', `${r.weight_kg} kg`]]
    } else {
      const p = prod[r.product_id]
      const made = ymd(r.created_at)
      attrs = [['製品名', r.name], ['加工者', biz[r.created_by]?.name ?? '—'], ['加工日', made], ['重量', `${r.weight_kg} kg`]]
      if (p?.storage) attrs.push(['保存方法', p.storage])
      if (p?.shelf_days != null) attrs.push([p.shelf_days > 5 ? '賞味期限' : '消費期限', addDays(r.created_at, p.shelf_days)])
    }
    out[r.id] = {
      id: r.id, parent: r.parent_id, kind: r.kind === 'individual' ? 'ind' : 'prod', name: r.name, kg: Number(r.weight_kg),
      species: r.species, productId: r.product_id, qr: r.qr_status, attrs, children: [], rawEvents: evs,
      info: {
        createdAt: r.created_at, landedAt: r.landed_at, port: r.landing_port, catchArea: r.catch_area, period: landing?.payload?.period || null,
        shipName: ship[r.ship_id]?.name ?? null, gear: ship[r.ship_id]?.gear ?? null, maker: biz[r.created_by]?.name ?? null,
        storage: prod[r.product_id]?.storage ?? null, shelfDays: prod[r.product_id]?.shelf_days ?? null,
      },
      events: evs.map((e) => ({ id: e.id, t: mdhm(e.created_at), type: e.type, who: biz[e.actor]?.name ?? '—', detail: e.payload?.detail ?? '', hash: e.hash, tx: e.tx_hash })),
    }
  }
  for (const it of Object.values(out)) if (it.parent && out[it.parent]) out[it.parent].children.push(it.id)
  return out
}

export const ancestors = (items, id) => { const a = []; let c = items[id]; while (c?.parent) { c = items[c.parent]; a.unshift(c) } return a }
export const rootOf = (items, id) => ancestors(items, id)[0] ?? items[id]

// 1件の改ざん検証（記録が増えたら計算し直す）
export function useVerify(item) {
  const [res, setRes] = useState(null)
  const key = item ? `${item.id}:${item.rawEvents.length}` : ''
  useEffect(() => {
    if (!item) return
    let alive = true
    setRes(null)
    verifyItem(item.rawEvents).then((r) => alive && setRes(r)).catch((e) => alive && setRes({ ok: false, error: e.message }))
    return () => { alive = false }
  }, [key])
  return res
}

// 元の1尾から今の商品まで、すべての記録を照合する
export function useVerifyAll(chain) {
  const [res, setRes] = useState(null)
  const key = chain.map((c) => `${c.id}:${c.rawEvents.length}`).join('|')
  useEffect(() => {
    if (!chain.length) return
    let alive = true
    setRes(null)
    Promise.all(chain.map((c) => verifyItem(c.rawEvents)))
      .then((rs) => alive && setRes({ ok: rs.every((r) => r.ok), onchain: rs.every((r) => r.onchain), count: chain.reduce((n, c) => n + c.rawEvents.length, 0) }))
      .catch(() => alive && setRes({ ok: false, onchain: false }))
    return () => { alive = false }
  }, [key])
  return res
}
