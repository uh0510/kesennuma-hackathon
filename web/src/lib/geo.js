// 今いる場所（記録した場所）を取る。取れない・許可されないときは null を返し、記録は止めない
// 加工で子IDを続けて発行するときなどに何度も聞かないよう、1分間は同じ値を使う
let cache = null
let lastReason = null // 取れなかった理由（画面に出す）

const REASONS = {
  1: '位置情報が許可されていません（ブラウザのサイトの設定で「許可」にしてください）',
  2: '位置を特定できませんでした（パソコンは Windows の「位置情報」をオンに）',
  3: '位置の取得が時間切れになりました',
}

export function currentPosition({ timeout = 8000, maxAge = 60000, fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.t < maxAge) return Promise.resolve(cache.v)
  if (!('geolocation' in navigator)) {
    lastReason = 'この端末・ブラウザは位置情報に対応していません'
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const v = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }
        cache = { t: Date.now(), v }
        lastReason = null
        resolve(v)
      },
      (e) => {
        lastReason = REASONS[e.code] ?? '位置を取得できませんでした'
        resolve(null)
      },
      { enableHighAccuracy: true, timeout, maximumAge: fresh ? 0 : maxAge },
    )
  })
}

// 直近で位置を取れなかった理由（取れていれば null）
export const positionError = () => lastReason

// 2点間の距離（km）
export function distanceKm([lng1, lat1], [lng2, lat2]) {
  const r = Math.PI / 180, R = 6371
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// 登録住所からこれ以上離れた場所での記録は注意を出す（屋内の位置のずれを見込んだ初期値）
export const OFFSITE_M = 2000
