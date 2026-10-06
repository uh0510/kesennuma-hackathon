// 画面で使うデータの組み立てと、改ざん検証のフック（管理画面・消費者画面で共通）
import { useState, useEffect } from 'react'
import { verifyItem, verifyPhotos, photoUrl, fetchVesselActivity } from './api.js'

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
    // 発行したときの写し（あれば、マスタの今の値ではなくこちらを表示する）
    const snap = evs.find((e) => e.payload?.item)?.payload.item ?? null
    let attrs
    const lot = r.kind === 'catch_lot'
    const mix = r.kind === 'process_lot'
    const grade = landing?.payload?.grade ?? null
    if (r.kind === 'individual' || lot) {
      const s = snap?.ship ?? ship[r.ship_id] ?? {}
      attrs = [['魚種', r.species], ...(lot ? [['銘柄（サイズ）', grade ?? '—'], ['尾数', `約 ${r.quantity} 尾`]] : []),
        ['漁船', s.name ?? '—'], ['漁船登録番号', s.reg_no ?? '—'], ['漁業許可番号', s.permit_no ?? '—'], ['漁法', s.gear ?? '—'],
        ['漁獲海域', r.catch_area ?? '—'], ['漁獲期間', landing?.payload?.period || '—'], ['水揚げ港', r.landing_port ?? '—'],
        ['水揚げ日', r.landed_at ? ymd(r.landed_at) : '—'], [lot ? '重量（水揚げ時の合計）' : '重量（水揚げ時）', `${r.weight_kg} kg`]]
    } else if (mix) {
      attrs = [['魚種', r.species], ['入れた魚', `${r.inputs?.length ?? 0}件`], ['加工者', biz[r.created_by]?.name ?? '—'], ['作成日', ymd(r.created_at)], ['重量（入れた魚の合計）', `${r.weight_kg} kg`]]
    } else {
      const p = snap?.product ?? prod[r.product_id]
      const made = ymd(r.created_at)
      attrs = [['製品名', r.name], ['加工者', biz[r.created_by]?.name ?? '—'], ['加工日', made], ['重量', `${r.weight_kg} kg`]]
      if (r.quantity > 1) attrs.push(['数量', `${r.quantity}パック（1パック ${Number(r.unit_kg) * 1000 >= 1000 ? `${Number(r.unit_kg)}kg` : `${Math.round(Number(r.unit_kg) * 1000)}g`}）`])
      if (p?.storage) attrs.push(['保存方法', p.storage])
      if (p?.shelf_days != null) attrs.push([p.shelf_days > 5 ? '賞味期限' : '消費期限', addDays(r.created_at, p.shelf_days)])
    }
    // kind：'ind'＝元になる単位、'prod'＝加工品。元は unit で分ける（'fish'＝1尾、'lot'＝水揚げロット、'mix'＝加工ロット：何尾かをまとめて加工に入れたもの）
    out[r.id] = {
      id: r.id, parent: r.parent_id, kind: r.kind === 'product' ? 'prod' : 'ind', unit: lot ? 'lot' : mix ? 'mix' : r.kind === 'individual' ? 'fish' : null,
      grade, count: lot ? r.quantity : r.kind === 'individual' ? 1 : mix ? r.inputs?.length ?? 0 : null, name: r.name, kg: Number(r.weight_kg),
      species: r.species, productId: r.product_id, qr: r.qr_status, attrs, children: [], rawEvents: evs, row: r, snap,
      qty: r.quantity ?? 1, unitKg: r.unit_kg != null ? Number(r.unit_kg) : null,
      photos: evs.filter((e) => e.payload?.photo?.path).map((e) => ({ id: e.id, url: photoUrl(e.payload.photo.path), type: e.type, at: e.created_at })),
      info: {
        createdAt: r.created_at, landedAt: r.landed_at, port: r.landing_port, catchArea: r.catch_area, period: landing?.payload?.period || null,
        catchFrom: landing?.payload?.catch_from ?? null, catchTo: landing?.payload?.catch_to ?? null,
        shipId: r.ship_id ?? null, shipName: (snap?.ship ?? ship[r.ship_id])?.name ?? null, gear: (snap?.ship ?? ship[r.ship_id])?.gear ?? null, maker: biz[r.created_by]?.name ?? null,
        storage: (snap?.product ?? prod[r.product_id])?.storage ?? null, shelfDays: (snap?.product ?? prod[r.product_id])?.shelf_days ?? null,
        // 漁船の申告（あれば）と、水揚げの重さがはかりの署名つきか
        declaration: landing?.payload?.declaration ?? null, landingScale: landing?.payload?.scale ?? null,
        inputs: r.inputs ?? [], inputKg: Object.fromEntries((evs.find((e) => e.type === 'born')?.payload?.inputs ?? []).map((x) => [x.id, x.kg])),
      },
      // 加工ロットに入れた魚：入れた先の加工ロットのID（入れたあとは、ここに記録を足さない）
      into: evs.findLast((e) => e.type === 'process' && e.payload?.into)?.payload.into ?? null,
      events: evs.map((e) => ({
        id: e.id, t: mdhm(e.created_at), type: e.type, who: biz[e.actor]?.name ?? '—', detail: e.payload?.detail ?? '', hash: e.hash, tx: e.tx_hash,
        loc: e.payload?.location ?? null, home: biz[e.actor]?.lat != null ? [biz[e.actor].lng, biz[e.actor].lat] : null, to: e.payload?.to ?? null, from: e.payload?.from ?? null, wc: e.payload?.weight_check ?? null, checks: e.payload?.checks ?? null, decl: e.payload?.declaration ?? null, scale: e.payload?.scale ?? null, kg: e.payload?.weight_kg ?? null,
      })),
      custody: custodyOf(evs, biz, Number(r.weight_kg)),
      sold: evs.some((e) => e.type === 'sell'),
    }
  }
  for (const it of Object.values(out)) if (it.parent && out[it.parent]) out[it.parent].children.push(it.id)
  // まとめて発行した加工品は同じ時刻で登録されるので、ID の順に並べる
  for (const it of Object.values(out)) it.children.sort()
  return out
}

// items の値が、発行したときの写し（指紋に含まれている）と食い違っていないか
// 写しのない古い記録は比べない
const SNAP_FIELDS = ['species', 'name', 'weight_kg', 'catch_area', 'landing_port', 'landed_at', 'parent_id', 'inputs']
export function snapshotDiff(it) {
  const snap = it.snap
  if (!snap) return []
  const same = (k, a, b) => {
    if (a == null && b == null) return true
    if (k === 'weight_kg') return Number(a) === Number(b)
    if (k === 'landed_at') return new Date(a).getTime() === new Date(b).getTime()
    if (k === 'inputs') return JSON.stringify(a) === JSON.stringify(b)
    return a === b
  }
  return SNAP_FIELDS.filter((k) => k in snap && !same(k, snap[k], it.row[k]))
}

// 指紋の鎖の検証 ＋ 写しとの照合
export async function verifyFull(it) {
  const [r, photos] = await Promise.all([verifyItem(it.rawEvents), verifyPhotos(it.rawEvents)])
  const diff = snapshotDiff(it)
  return { ...r, ok: r.ok && diff.length === 0 && photos.ok, diff, photos }
}

// 今の持ち主と、引き渡し中の相手（サーバーの確認と同じ決まりで記録の並びから割り出す）
export function custodyOf(evs, biz, itemKg) {
  let holder = null, pending = null, lastKg = itemKg
  for (const e of evs) {
    const kg = Number(e.payload?.weight_kg)
    if (Number.isFinite(kg) && kg > 0) lastKg = kg
    if (e.type === 'landing' || e.type === 'born') { holder = e.actor; pending = null }
    else if ((e.type === 'auction' || e.type === 'ship') && e.payload?.to?.id) pending = e.payload.to.id
    else if (e.type === 'receive') { holder = e.actor; pending = null }
  }
  return { holder, holderName: biz[holder]?.name ?? null, pending, pendingName: biz[pending]?.name ?? null, lastKg }
}

export const ancestors = (items, id) => { const a = []; let c = items[id]; while (c?.parent) { c = items[c.parent]; a.unshift(c) } return a }
export const rootOf = (items, id) => ancestors(items, id)[0] ?? items[id]
// 元の魚：ふつうは元の1尾（水揚げロット）。加工ロットなら、入れた魚すべて
export const originsOf = (items, id) => {
  const root = rootOf(items, id)
  return root.unit === 'mix' ? root.info.inputs.map((x) => items[x]).filter(Boolean) : [root]
}

// 1件の改ざん検証（記録が増えたら計算し直す）
export function useVerify(item) {
  const [res, setRes] = useState(null)
  const key = item ? `${item.id}:${item.rawEvents.length}` : ''
  useEffect(() => {
    if (!item) return
    let alive = true
    setRes(null)
    verifyFull(item).then((r) => alive && setRes(r)).catch((e) => alive && setRes({ ok: false, error: e.message }))
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
    Promise.all(chain.map((c) => verifyFull(c)))
      .then((rs) => alive && setRes({
        ok: rs.every((r) => r.ok), onchain: rs.every((r) => r.onchain), count: chain.reduce((n, c) => n + c.rawEvents.length, 0),
        chains: rs.map((r) => r.chain),
        photoCount: rs.reduce((n, r) => n + (r.photos?.count ?? 0), 0),
      }))
      .catch(() => alive && setRes({ ok: false, onchain: false }))
    return () => { alive = false }
  }, [key])
  return res
}

// 船の位置の記録（AIS）。元の魚（1尾・水揚げロット）の船・水揚げ日・漁獲期間で問い合わせる
// 返す値（1件ごと）：undefined＝船にひも付いていない / null＝読み込み中 / { error }＝読めなかった / それ以外＝vessel-activity の結果
// 同じ問い合わせは画面を移っても1回だけ（Global Fishing Watch への問い合わせを減らす）
const aisCache = new Map()
const aisKey = (o) => (o?.info.shipId ? [o.info.shipId, o.info.landedAt ?? o.info.createdAt, o.info.catchFrom, o.info.catchTo].join('|') : '')
function loadAis(o, key) {
  if (!aisCache.has(key)) {
    const p = fetchVesselActivity(o.info.shipId, o.info.landedAt ?? o.info.createdAt, o.info.catchFrom, o.info.catchTo)
      .then((r) => (r.linked ? r : undefined))
      .catch((e) => { aisCache.delete(key); return { error: e.message } })
    aisCache.set(key, p)
  }
  return aisCache.get(key)
}
export function useVesselActivities(origins) {
  const keys = origins.map(aisKey)
  const k = keys.join('||')
  const blank = () => keys.map((x) => (x ? null : undefined))
  const [res, setRes] = useState(blank)
  useEffect(() => {
    let alive = true
    setRes(blank())
    keys.forEach((key, i) => {
      if (key) loadAis(origins[i], key).then((r) => alive && setRes((prev) => { const n = [...prev]; n[i] = r; return n }))
    })
    return () => { alive = false }
  }, [k])
  return res.length === keys.length ? res : blank()
}
export const useVesselActivity = (origin) => useVesselActivities(origin ? [origin] : [])[0]
