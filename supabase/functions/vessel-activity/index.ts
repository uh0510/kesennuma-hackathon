// Supabase Edge Function：漁船が実際に漁をした場所と、入港した港を返す（Global Fishing Watch の公開データ）
// 呼び出し：POST /functions/v1/vessel-activity  { shipId, landedAt }   ※ログイン不要（消費者の画面から呼ぶ）
//   shipId   ：ships.id。GFW の船のIDは DB の船マスタから引く（画面から任意の船を問い合わせる中継にはしない）
//   landedAt ：水揚げの日時。その前 150 日〜後 3 日を調べる
// 返す値：{ ok, linked, sample, from, to, fishing: [{ start, end, lat, lon, fao, eez, highSeas }], ports: [{ start, end, name, flag, lat, lon }] }
//   sample＝true：表示例（ships.ais_sample）。画面に「見本」と出す
//   gfw_vessel_id が 'sample:' で始まる船は、実在の船に結び付かない作りものの見本データを返す（申告違いの例を見せるため）
//   fishing の fao は FAO の大海区（例 "61"）。漁をしたと見られる時間と場所で、船の細かい航跡ではない
// 秘密情報（Supabase の secrets に登録）：GFW_TOKEN
// 利用条件：営利目的でないこと（CC BY-NC 4.0）。画面に「Powered by Global Fishing Watch」を出す
// データは約 96 時間遅れ。同じ問い合わせは 1 時間ためておく（1日 5 万回の上限に配慮）
import { createClient } from 'npm:@supabase/supabase-js@2'

const GFW = 'https://gateway.api.globalfishingwatch.org/v3'
const DAY = 86400000
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS })
const cache = new Map<string, { at: number; body: unknown }>()

async function gfwEvents(dataset: string, vessel: string, from: string, to: string) {
  const url = `${GFW}/events?vessels[0]=${encodeURIComponent(vessel)}&datasets[0]=${dataset}&start-date=${from}&end-date=${to}&limit=500&offset=0`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${Deno.env.get('GFW_TOKEN')}` } })
  if (!r.ok) throw new Error(`Global Fishing Watch から読めませんでした（${r.status}）`)
  // deno-lint-ignore no-explicit-any
  return ((await r.json()).entries ?? []) as any[]
}

// 作りものの見本：水揚げの 120〜30 日前に南西太平洋（FAO 81）で漁をし、ヌメア経由で気仙沼に戻った、という航海
// 実在の船のデータではない（申告と違う海域の例を見せるためだけに使う）
function syntheticVoyage(landed: Date) {
  const t = landed.getTime()
  const fishing = Array.from({ length: 48 }, (_, i) => {
    const day = t - (120 - i * 1.9) * DAY
    const lat = -28 - 6 * Math.sin(i * 0.7) - (i % 5)
    const lon = 172 + 9 * Math.cos(i * 0.45) + (i % 3) * 1.5
    return { start: new Date(day).toISOString(), end: new Date(day + 0.2 * DAY).toISOString(), lat, lon: lon > 180 ? lon - 360 : lon, fao: '81', eez: [], highSeas: true }
  })
  const ports = [
    { start: new Date(t - 25 * DAY).toISOString(), end: new Date(t - 22 * DAY).toISOString(), name: 'NOUMEA', flag: 'NCL', lat: -22.27, lon: 166.44 },
    { start: new Date(t - 1 * DAY).toISOString(), end: new Date(t + 1 * DAY).toISOString(), name: 'KESENNUMA', flag: 'JPN', lat: 38.9035, lon: 141.5785 },
  ]
  return { fishing, ports }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    if (!Deno.env.get('GFW_TOKEN')) return json({ ok: false, error: 'GFW_TOKEN が設定されていません' }, 500)
    const { shipId, landedAt } = await req.json()
    const landed = new Date(landedAt)
    if (!shipId || Number.isNaN(landed.getTime())) return json({ ok: false, error: '船と水揚げの日時を指定してください' }, 400)
    const from = new Date(landed.getTime() - 150 * DAY).toISOString().slice(0, 10)
    const to = new Date(Math.min(landed.getTime() + 3 * DAY, Date.now())).toISOString().slice(0, 10)

    const key = `${shipId}:${from}:${to}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < 3600000) return json(hit.body)

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: ship } = await supa.from('ships').select('gfw_vessel_id, ais_sample').eq('id', shipId).maybeSingle()
    if (!ship?.gfw_vessel_id) return json({ ok: true, linked: false })
    if (ship.gfw_vessel_id.startsWith('sample:')) return json({ ok: true, linked: true, sample: true, from, to, ...syntheticVoyage(landed) })

    const [fishing, ports] = await Promise.all([
      gfwEvents('public-global-fishing-events:latest', ship.gfw_vessel_id, from, to),
      gfwEvents('public-global-port-visits-events:latest', ship.gfw_vessel_id, from, to),
    ])
    const body = {
      ok: true, linked: true, sample: Boolean(ship.ais_sample), from, to,
      fishing: fishing.map((e) => ({
        start: e.start, end: e.end, lat: e.position?.lat, lon: e.position?.lon,
        fao: e.regions?.majorFao?.[0] ?? null, eez: e.regions?.eez ?? [], highSeas: (e.regions?.highSeas ?? []).length > 0,
      })),
      ports: ports.map((e) => {
        const a = e.port_visit?.intermediateAnchorage ?? e.port_visit?.startAnchorage ?? {}
        return { start: e.start, end: e.end, name: a.name ?? null, flag: a.flag ?? null, lat: e.position?.lat, lon: e.position?.lon }
      }),
    }
    cache.set(key, { at: Date.now(), body })
    return json(body)
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 502)
  }
})
