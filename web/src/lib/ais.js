// 申告（漁獲海域・水揚げ港）と、漁船の位置の記録（AIS。Global Fishing Watch の公開データ）を照らし合わせる

// 水揚げ港の名前 → AIS の港の名前
const PORT_AIS = { '気仙沼港': 'KESENNUMA', 'ラス・パルマス港（スペイン）': 'LAS PALMAS' }
const DAY = 86400000

// 申告した海域の FAO 大海区（「…（FAO 61）」の数字。三陸沖は 61）
export const areaFao = (area) => area?.match(/FAO\s*(\d+)/)?.[1] ?? (area === '三陸沖' ? '61' : null)

// area：'ok'＝漁の半分以上が申告した海区 / 'partial'＝一部だけ / 'ng'＝申告した海区で漁をしていない / 'none'＝漁の記録がない
// port：'ok'＝水揚げの前後（10日前〜3日後）に申告した港へ入港している / 'ng'＝見つからない / null＝照らし合わせられない港
export function checkAis({ catchArea, landingPort, landedAt, ais }) {
  if (!ais?.linked) return null
  const fao = areaFao(catchArea)
  const counts = {}
  for (const f of ais.fishing) if (f.fao) counts[f.fao] = (counts[f.fao] ?? 0) + 1
  const total = ais.fishing.length
  const inArea = fao ? counts[fao] ?? 0 : 0
  const area = total === 0 ? 'none' : inArea / total >= 0.5 ? 'ok' : inArea > 0 ? 'partial' : 'ng'

  const t = new Date(landedAt).getTime()
  const want = PORT_AIS[landingPort]
  const visit = want
    ? ais.ports.find((p) => p.name?.toUpperCase().includes(want) && new Date(p.start).getTime() <= t + 3 * DAY && new Date(p.end ?? p.start).getTime() >= t - 10 * DAY)
    : null
  // 水揚げまでに寄った港（続けて同じ港は1つに）。多すぎると読めないので最後の 6 港
  const route = []
  for (const p of ais.ports.filter((x) => new Date(x.start).getTime() <= t + 3 * DAY)) {
    if (p.name && route.at(-1) !== p.name) route.push(p.name)
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return { fao, total, inArea, top, area, port: want ? (visit ? 'ok' : 'ng') : null, visit, route: route.slice(-6) }
}
