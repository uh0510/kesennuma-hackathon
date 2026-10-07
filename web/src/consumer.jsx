// 消費者・バイヤーが見る画面（QRを読むと開く）
// 黒い背景に大きな文字、旅の地図、スクロールに合わせて現れる道のり、という Apple の製品ページ風の構成
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Select, Anchor } from '@mantine/core'
import { motion, useInView, useScroll, useSpring, animate, AnimatePresence, useReducedMotion, MotionConfig } from 'motion/react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './story.css'
import { IconLink } from '@tabler/icons-react'
import { ymd, mdhm, shortHash, addDays, ancestors, useVerifyAll, useVesselActivity, useVesselActivities } from './model.js'
import { explorerAddress, explorerTx } from './api.js'
import { checkAis } from './lib/ais.js'
import { STR, EV_LABEL, term, useLang } from './i18n.jsx'
import { BRAND } from './brand.js'
import { ProofLab } from './proof.jsx'
import { useLook, cssVar } from './theme.js'
import { FishMark } from './logo.jsx'

// 地図に置く地点。海域は正確な漁獲地点ではなく、海域の代表地点（画面にもそう書く）
const AREA_POINTS = {
  '北西太平洋（FAO 61）': [150.5, 37.6],
  '三陸沖': [143.4, 39.0],
  '中東部大西洋（FAO 34）': [-21.0, 22.0],
  '中西部太平洋（FAO 71）': [160.0, 5.0],
  '南西太平洋（FAO 81）': [175.0, -32.0],
  'インド洋東部（FAO 57）': [100.0, -15.0],
}
const KESENNUMA_PORT = [141.5785, 38.9035]
// 水揚げ港（遠洋の船は海外で水揚げすることがある）
const PORT_POINTS = {
  '気仙沼港': KESENNUMA_PORT,
  'ラス・パルマス港（スペイン）': [-15.4167, 28.1419],
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'

const EV = EV_LABEL

const ease = [0.25, 0.1, 0.25, 1]
const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
  transition: { duration: 0.7, ease },
}

// 2点間の距離（km）
function km([lng1, lat1], [lng2, lat2]) {
  const r = Math.PI / 180, R = 6371
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// 2点を弧でつなぐ点列（まっすぐより「旅」に見える）
function arc(a, b, n = 64) {
  const [x1, y1] = a, [x2, y2] = b
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const dx = x2 - x1, dy = y2 - y1
  const cx = mx - dy * 0.25, cy = my + dx * 0.25
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t
    return [u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2]
  })
}

// 数字が数え上がる表示
function CountUp({ value, decimals = 0, suffix = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true })
  const [shown, setShown] = useState(0)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!inView) return
    // 端末が「動きを減らす」設定なら、数え上げずに最後の値を出す
    if (reduce) { setShown(value); return }
    const c = animate(0, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: setShown })
    return () => c.stop()
  }, [inView, value])
  return <span ref={ref}>{shown.toLocaleString('ja-JP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>
}

// 改ざん検証の結果。sea：朱のはんこ「検」が押される（合わないときは灰色の欠けた印）／classic：チェックマークが描かれる
function Seal({ verify, t }) {
  const [look] = useLook()
  const state = verify === null ? 'wait' : verify.ok ? 'ok' : 'ng'
  const color = { wait: '#636366', ok: '#30d158', ng: '#ff453a' }[state]
  const reduce = useReducedMotion()
  if (look === 'sea') return (
    <motion.div className="seal seal-sea glass-dark" data-state={state} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease, delay: 0.35 }}>
      <motion.div key={state} className="hanko" data-state={state} aria-hidden
        initial={state === 'wait' || reduce ? false : { scale: 1.9, opacity: 0, rotate: -20 }}
        animate={{ scale: 1, opacity: 1, rotate: state === 'ng' ? 4 : -8 }}
        transition={{ type: 'spring', stiffness: 520, damping: 18, delay: 0.75 }}>
        {state === 'ng' ? '!' : state === 'ok' ? '検' : ''}
      </motion.div>
      <div>
        <div className="seal-title">{state === 'wait' ? t.sealWait : state === 'ok' ? t.sealOk : t.sealNg}</div>
        <div className="seal-sub">
          {state === 'ok' && t.sealOkSub(verify.count)}
          {state === 'ng' && t.sealNgSub}
          {state === 'wait' && t.sealWaitSub}
        </div>
      </div>
    </motion.div>
  )
  return (
    <motion.div className="seal glass-dark" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease, delay: 0.35 }}>
      <div className="seal-ring" style={{ '--c': color }}>
        <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden>
          {state === 'ok' && <motion.path d="M15 27 L23 35 L38 18" fill="none" stroke="white" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 0.8, ease }} />}
          {state === 'ng' && <path d="M26 15 V30 M26 37 V38" stroke="white" strokeWidth="4.5" strokeLinecap="round" />}
        </svg>
      </div>
      <div>
        <div className="seal-title">{state === 'wait' ? t.sealWait : state === 'ok' ? t.sealOk : t.sealNg}</div>
        <div className="seal-sub">
          {state === 'ok' && t.sealOkSub(verify.count)}
          {state === 'ng' && t.sealNgSub}
          {state === 'wait' && t.sealWaitSub}
        </div>
      </div>
    </motion.div>
  )
}

// 表紙の写真（元の1尾）。写真の指紋が記録と一致したら印を出す
function HeroPhoto({ main, sub, root, it, verify, t, lang }) {
  const isRootPhoto = root.photos[0] === main
  return (
    <motion.figure className="hero-photo" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, ease, delay: 0.15 }}>
      <img src={main.url} alt={t.photoAlt(term(lang, root.species))} />
      <figcaption>
        <span>{isRootPhoto ? (root.unit === 'lot' ? t.photoRootLot : t.photoRoot) : term(lang, it.name)} · {ymd(main.at)}</span>
        {verify?.ok && verify.photoCount > 0 && <span className="photo-ok">{t.photoOk}</span>}
      </figcaption>
      {sub && (
        <motion.div className="hero-photo-sub" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.6, ease }}>
          <img src={sub.url} alt={t.photoAltOwn(term(lang, it.name))} />
          <span>{t.photoProcessed}</span>
        </motion.div>
      )}
    </motion.figure>
  )
}

// 経度を前の点から 180 度以内にそろえる（太平洋をまたぐ線が地球の反対側を回らないように）
function unwrap(points) {
  const out = []
  for (const [x, y] of points) {
    let lon = x
    const prev = out.at(-1)?.[0]
    if (prev != null) while (lon - prev > 180) lon -= 360
    if (prev != null) while (prev - lon > 180) lon += 360
    out.push([lon, y])
  }
  return out
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// 0 → 1 を ms かけて進める（毎フレーム onUpdate。stop() が true を返したらやめる）
const smooth = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
// paused() が true のあいだは時間を進めない
function tween(ms, onUpdate, { ease = smooth, stop = () => false, paused = () => false } = {}) {
  return new Promise((resolve) => {
    let last = performance.now(), elapsed = 0
    // 画面の描き替えを待たずにタイマーで進める（1秒に約30回。地図は setData のたびに描き直す）
    const step = () => {
      if (stop()) return resolve()
      const now = performance.now()
      if (!paused()) elapsed += now - last
      last = now
      const x = Math.min(1, elapsed / ms)
      onUpdate(ease(x))
      if (x < 1) setTimeout(step, 33)
      else resolve()
    }
    setTimeout(step, 33)
  })
}
const day = (s) => new Date(s).toISOString().slice(0, 10)

// 旅の地図（映像）：地球儀 → 漁をした海で、船の位置の記録が日付の順に灯る → 寄った港をたどる航海 → 水揚げ港・加工場・店へ飛ぶ → 全体
// 画面に入ったら1回再生し、終わったら「もう一度見る」。船の位置の記録がない船は、海域の代表地点から始める
function JourneyMap({ stops, t, ais }) {
  const [look] = useLook()
  const box = useRef(null)
  const mapRef = useRef(null)
  const inView = useInView(box, { once: true, margin: '-120px' })
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(null)
  const [cap, setCap] = useState(null) // 映像の字幕 { phase, main, sub }
  const [playing, setPlaying] = useState(false)
  const [run, setRun] = useState(0) // 再生の回数（もう一度見る）
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const skipRef = useRef(null) // 再生中だけ入る：押すと最後の全体表示へ飛ぶ
  const reduce = useReducedMotion()
  const togglePause = () => {
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
    if (pausedRef.current) mapRef.current?.stop()
  }

  useEffect(() => {
    // WebGL が使えないブラウザでは地図を作れない。画面全体を落とさず、代わりの図を出す
    let map
    try {
      map = new maplibregl.Map({
        container: box.current, style: MAP_STYLE, interactive: false, attributionControl: { compact: true },
        // 地球儀の大きさ：スマホでは小さめに（字幕と重ならないように）
        center: stops[0].at, zoom: box.current.clientWidth < 600 ? 0.2 : 0.8,
        // 軽くする：高精細の画面でも描く細かさは 1.5 倍まで。文字のふわっと出る動きはなし
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), fadeDuration: 0,
      })
    } catch (e) {
      console.error('地図を作れませんでした', e)
      setFailed(String(e?.message ?? e))
      return
    }
    map.on('error', (e) => console.error('地図のエラー', e?.error ?? e))
    mapRef.current = map
    map.on('style.load', () => {
      // 地球儀で見せる（世界地図が横に何枚も並ばない）
      try { map.setProjection({ type: 'globe' }) } catch { /* 古い仕組みでは平らな地図のまま */ }
    })
    map.on('load', () => {
      const empty = { type: 'FeatureCollection', features: [] }
      const accent = cssVar(box.current, '--accent', '#64d2ff'), strong = cssVar(box.current, '--accent-strong', '#0a84ff')
      // sea：海と陸の色を夜の湾の藍に寄せる（地図の元の色は黒っぽい灰色）
      if (look === 'sea') {
        for (const l of map.getStyle().layers) {
          try {
            if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#0a2230')
            else if (l.type === 'fill' && /water|ocean|sea/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#04131d')
            // 氷河・公園・建物などは元の黒のままだと藍の陸の上で黒く抜けるので、陸より少し明るい藍に
            else if (l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#0e2a3a')
          } catch { /* 色を変えられない層はそのまま */ }
        }
      }
      map.addSource('ais-fishing', { type: 'geojson', data: empty })
      map.addLayer({ id: 'ais-glow', type: 'circle', source: 'ais-fishing', filter: ['<=', ['get', 't'], 0],
        paint: { 'circle-radius': 9, 'circle-color': '#ff9f0a', 'circle-opacity': 0.18, 'circle-blur': 1 } })
      map.addLayer({ id: 'ais-fishing', type: 'circle', source: 'ais-fishing', filter: ['<=', ['get', 't'], 0],
        paint: { 'circle-radius': 3.2, 'circle-color': '#ff9f0a', 'circle-opacity': 0.9 } })
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } })
      map.addLayer({ id: 'route-glow', type: 'line', source: 'route', paint: { 'line-color': strong, 'line-width': 10, 'line-blur': 8, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round' } })
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': accent, 'line-width': 3 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      map.addSource('head', { type: 'geojson', data: empty })
      map.addLayer({ id: 'head', type: 'circle', source: 'head', paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': accent, 'circle-stroke-width': 3 } })
      const wide = box.current.clientWidth > 700
      // ラベルの出し方：右・左・左下（スマホでは横に並べると重なるので左下）。点の中心が地点に重なるよう基準をずらす
      const PLACE = { right: ['left', [-7, 0]], left: ['right', [7, 0]], 'below-left': ['top-right', [7, -7]], below: ['top', [0, -7]] }
      stops.forEach((s, i) => {
        const side = s.side === 'left' ? (wide ? 'left' : 'below-left') : i >= 2 && i % 2 === 0 ? (wide ? 'left' : 'below') : 'right'
        const el = document.createElement('div')
        el.className = `map-pin ${side}`
        const lines = s.lines ?? [{ label: s.label, sub: s.sub }]
        el.innerHTML = `<span class="dot">${i + 1}</span><span class="tag">${lines.map((l) => `<b>${esc(l.label)}</b>${l.sub ? `<small>${esc(l.sub)}</small>` : ''}`).join('')}</span>`
        // 名札は再生中の地点だけ。ほかは番号の丸だけで、押すと開く（もう一度押すと閉じる。ほかの地点は閉じる）
        el.addEventListener('click', () => {
          const open = !el.classList.contains('open')
          box.current?.querySelectorAll('.map-pin.open').forEach((p) => p.classList.remove('open'))
          if (open) el.classList.add('open')
        })
        // 地球儀の裏側に回った地点は出さない
        new maplibregl.Marker({ element: el, anchor: PLACE[side][0], offset: PLACE[side][1], opacityWhenCovered: '0' }).setLngLat(s.at).addTo(map)
      })
      setReady(true)
    })
    return () => {
      mapRef.current = null
      setReady(false)
      try { map.remove() } catch { /* 片付け中のエラーは無視してよい */ }
    }
  }, [stops.map((s) => `${s.at.join()}:${s.label}:${s.sub}`).join('|'), look])

  // 再生：画面に入ったら1回。船の位置の記録が届くのを少しだけ待つ（届かなければ、ないものとして始める）
  useEffect(() => {
    if (!ready || !inView) return
    if (ais === null && run === 0) return // 読み込み中
    const map = mapRef.current
    if (!map?.style) return
    let alive = true, skipped = false
    pausedRef.current = false; setPaused(false)
    const live = () => alive && mapRef.current === map && map.style
    const ok = () => live() && !skipped
    const isPaused = () => pausedRef.current
    // 一時停止のあいだは待つ
    const hold = async () => { while (isPaused() && ok()) await sleep(120) }
    const nap = async (ms) => { await hold(); await tween(ms, () => {}, { stop: () => !ok(), paused: isPaused }) }
    // カメラを動かして、止まるまで待つ。動かなかった・失敗したときも、決めた時間で先へ進む
    const move = async (fn, ...args) => { await hold(); return new Promise((r) => {
      if (!ok()) return r()
      const ms = (args.at(-1)?.duration ?? 0) + 800
      const done = () => { clearTimeout(timer); map.off('moveend', done); r() }
      const timer = setTimeout(done, ms)
      map.on('moveend', done)
      try { map[fn](...args) } catch (e) { console.error('地図のカメラ', e); done() }
    }) }
    const pins = [...box.current.querySelectorAll('.map-pin')]
    const setRoute = (coords) => map.getSource('route')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } })
    const setHead = (p) => map.getSource('head')?.setData(p ? { type: 'Feature', geometry: { type: 'Point', coordinates: p } } : { type: 'FeatureCollection', features: [] })
    const showUpTo = (ms) => ['ais-fishing', 'ais-glow'].forEach((id) => map.getLayer(id) && map.setFilter(id, ['<=', ['get', 't'], ms]))
    // 線を少しずつ伸ばす（先頭に白い点、カメラは先頭を追う）
    const draw = (base, path, ms, follow) => tween(ms, (v) => {
      const n = Math.max(2, Math.round(v * path.length))
      setRoute([...base, ...path.slice(0, n)])
      setHead(path[n - 1])
      if (follow) map.jumpTo({ center: path[n - 1] })
    }, { stop: () => !ok(), paused: isPaused })
    const current = (i) => pins.forEach((p, k) => p.classList.toggle('cur', k === i))

    // 道すじは先に全部決めておく（スキップしたときに最後の形をすぐ出せるように）
    const fishing = (ais?.linked ? ais.fishing : []).filter((p) => p.lat != null && p.lon != null)
      .map((p) => ({ ...p, ms: new Date(p.start).getTime() })).sort((a, b) => a.ms - b.ms)
    const area = stops[0].at
    const pts = unwrap([area, ...fishing.map((p) => [p.lon, p.lat])]).slice(1)
    const land = stops[1]
    const lastFish = pts.at(-1) ?? area
    const ports = (ais?.linked ? ais.ports : []).filter((p) => p.lat != null && p.lon != null && (!fishing.length || new Date(p.start).getTime() >= fishing.at(-1).ms))
    const seq = []
    for (const p of ports) if (seq.at(-1)?.name !== p.name) seq.push(p)
    const via = unwrap([lastFish, ...seq.map((p) => [p.lon, p.lat]), land?.at ?? lastFish])
    const voyage = land ? via.slice(1).flatMap((p, i) => arc(via[i], p, 40).slice(i ? 1 : 0)) : []
    // 水揚げ港から先の区間：前の線の最後の点から（経度のそろえ方を線全体で同じにする）
    const legs = []
    for (let i = 2, tail = voyage.at(-1); i < stops.length; i++) {
      const leg = unwrap([tail ?? stops[i - 1].at, stops[i].at])
      legs[i] = arc(leg[0], leg[1], 40)
      tail = legs[i].at(-1)
    }

    // 最後の全体表示（スキップ・動きを減らす設定のときは、ここへすぐ飛ぶ）
    const finish = (animate) => {
      if (!live()) return
      const base = [...voyage, ...legs.filter(Boolean).flat()]
      setHead(null); setCap(null); current(-1)
      setRoute(base); showUpTo(Infinity)
      // 地球の半分以上をまたぐ旅（大西洋 → パナマ → 日本）は地球儀だと裏側に隠れるので、全体は平らな地図で、太平洋をまたいで続けて見せる
      try { map.setProjection({ type: 'mercator' }) } catch { /* そのまま */ }
      const all = new maplibregl.LngLatBounds()
      ;[...pts, ...base].forEach((p) => all.extend(p))
      if (!base.length) stops.forEach((s) => all.extend(s.at))
      const wide = box.current.clientWidth > 700
      try {
        map.fitBounds(all, { padding: wide ? { top: 120, bottom: 90, left: 120, right: 120 } : { top: 120, bottom: 70, left: 40, right: 40 }, pitch: 0, bearing: 0, maxZoom: 7, duration: animate ? 2600 : 0 })
      } catch (e) { console.error('地図のカメラ', e) }
      pins.forEach((p) => p.classList.add('on'))
    }
    skipRef.current = () => { skipped = true; pausedRef.current = false; setPaused(false); map.stop(); finish(false); setPlaying(false) }

    ;(async () => {
      setPlaying(true)
      pins.forEach((p) => p.classList.remove('on'))
      // 端末が「動きを減らす」設定のときは、最初から全体を出す
      if (reduce) { finish(false); return }
      try { map.setProjection({ type: 'globe' }) } catch { /* 平らな地図のまま */ }
      setRoute([]); setHead(null); showUpTo(0)
      map.getSource('ais-fishing')?.setData({ type: 'FeatureCollection', features: fishing.map((p, i) => ({ type: 'Feature', properties: { t: p.ms }, geometry: { type: 'Point', coordinates: pts[i] } })) })

      // 1. 地球儀から、漁をした海へ
      setCap({ phase: t.replayFishing, main: stops[0].sub ?? stops[0].label })
      await move('jumpTo', { center: area, zoom: box.current.clientWidth < 600 ? 0.2 : 0.8, pitch: 0, bearing: 0 })
      await nap(600)
      if (!ok()) return
      const fb = new maplibregl.LngLatBounds(area, area)
      pts.forEach((p) => fb.extend(p))
      await move('fitBounds', fb, { padding: 90, maxZoom: 5, pitch: 25, duration: 2600 })
      if (!ok()) return
      pins[0]?.classList.add('on'); current(0)

      // 2. 船の位置の記録が、日付の順に灯る
      if (fishing.length) {
        const t0 = fishing[0].ms, t1 = fishing.at(-1).ms
        await tween(Math.min(6000, 2000 + fishing.length * 25), (x) => {
          const v = t0 + (t1 + 1 - t0) * x
          showUpTo(v)
          setCap({ phase: t.replayFishing, main: day(v), sub: t.replayFishCount(fishing.filter((p) => p.ms <= v).length) })
        }, { ease: (x) => x, stop: () => !ok(), paused: isPaused })
        await nap(700)
        if (!ok()) return
      }

      // 3. 航海：漁の最後の地点から、寄った港をたどって水揚げ港へ
      if (land && voyage.length > 1) {
        setCap({ phase: t.replayVoyage, main: seq.length ? seq.map((p) => p.name).join(' → ') : land.label })
        await move('easeTo', { center: voyage[0], zoom: 2.4, pitch: 30, duration: 1200 })
        if (!ok()) return
        await draw([], voyage, Math.min(9000, 3500 + seq.length * 900), true)
        if (!ok()) return
      }

      // 4. 水揚げ港・加工場・店：斜めから寄って、1か所ずつ
      let base = voyage
      for (let i = 1; i < stops.length; i++) {
        const s = stops[i]
        if (i > 1) {
          const path = legs[i]
          const mid = path[Math.floor(path.length / 2)]
          await move('flyTo', { center: mid, zoom: Math.max(4, Math.min(8, 10 - Math.log2(1 + km(path[0], path.at(-1)) / 20))), pitch: 35, bearing: -15 + i * 12, duration: 1600 })
          if (!ok()) return
          await draw(base, path, 1500, false)
          base = [...base, ...path]
        }
        if (!ok()) return
        setCap({ phase: i === 1 ? t.replayLanded : t.replayStop, main: s.label, sub: s.sub })
        pins[i]?.classList.add('on'); current(i)
        await move('flyTo', { center: s.at, zoom: 9.5, pitch: 40, bearing: -20 + i * 12, duration: 2000 })
        await nap(1300)
        if (!ok()) return
      }

      // 5. 全体を見渡す
      if (!ok()) return
      finish(true)
    })().finally(() => { if (alive) { skipRef.current = null; setPlaying(false) } })
    return () => { alive = false; skipRef.current = null }
  }, [ready, inView, ais === null, run])

  if (failed) return <MapFallback stops={stops} t={t} />
  return (
    <div className="journey-wrap">
      <div ref={box} className="journey-map" />
      <AnimatePresence>
        {cap && (
          <motion.div key="cap" className="replay-cap" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
            <span className="replay-phase">{cap.phase}</span>
            <b>{cap.main}</b>
            {cap.sub && <small>{cap.sub}</small>}
          </motion.div>
        )}
      </AnimatePresence>
      {ready && !playing && <button type="button" className="replay-btn" onClick={() => setRun((n) => n + 1)}>{t.replayAgain}</button>}
      {ready && playing && (
        <div className="replay-ctrl">
          <button type="button" className="replay-btn" onClick={togglePause} aria-pressed={paused}>{paused ? t.replayResume : t.replayPause}</button>
          <button type="button" className="replay-btn" onClick={() => skipRef.current?.()}>{t.replaySkip}</button>
        </div>
      )}
    </div>
  )
}

// 地図を表示できないときの代わりの図
function MapFallback({ stops, t }) {
  return (
    <div className="journey-map map-fallback">
      <div className="fb-route">
        {stops.map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && <div className="fb-line" />}
            <div className="fb-stop"><span className="dot" /><b>{s.label}</b><small>{s.sub}</small></div>
          </React.Fragment>
        ))}
      </div>
      <div className="fb-note">{t.mapFallback}</div>
    </div>
  )
}

// 根拠の印：検印の下に、根拠の種類ごとに形を変えて並べる。押すと根拠が開く
//   third＝第三者が確かめられる（ブロックチェーン・船の位置データ）／ biz＝事業者の記録（計量）／ self＝自己申告（漁船の申告）
function Evidence({ verify, aisRes, ais, root, lot, allEvents, t, lang, when }) {
  const [open, setOpen] = useState(null)
  const tr = (x) => term(lang, x)
  const list = []
  // ブロックチェーン
  const lastTx = [...allEvents].reverse().find((e) => e.tx)?.tx
  list.push({
    key: 'chain', kind: 'third',
    level: verify === null ? 'wait' : verify.onchain && verify.ok ? 'ok' : !verify.ok ? 'ng' : 'na',
    label: verify === null ? t.evChainWait : verify.onchain && verify.ok ? t.evChain : !verify.ok ? t.evChainNg : t.evChainNone,
    lines: [verify?.ok ? t.evChainLine(verify.count) : verify ? t.sealNgSub : ''].filter(Boolean),
    link: lastTx ? explorerTx(lastTx) : null,
  })
  // 船の位置データ（加工ロットは魚ごとに下の節で見せる）
  if (!lot && aisRes) {
    list.push({
      key: 'ais', kind: 'third', level: { ok: 'ok', partial: 'warn', ng: 'ng', none: 'na' }[aisRes.area] ?? 'na',
      label: ({ ok: t.evAisOk, partial: t.evAisPartial, ng: t.evAisNg, none: t.evAisNone }[aisRes.area] ?? t.evAisNone) + (ais?.sample ? t.evSample : ''),
      lines: [
        t.aisDeclared(tr(root.info.catchArea) ?? '—', root.info.catchFrom ? `${root.info.catchFrom}〜${root.info.catchTo}` : null),
        aisRes.total ? t.aisSeen(aisRes.top.slice(0, 3).map(([f, n]) => `FAO ${f}：${n}`).join(' / '), aisRes.total) : null,
        aisRes.port === 'ok' ? `${t.aisPort} ${t.aisPortOk(tr(root.info.port), ymd(aisRes.visit.start))}` : aisRes.port === 'ng' ? t.aisPortNg(tr(root.info.port)) : null,
        ais?.sample ? t.aisSample : t.evAisSource,
      ].filter(Boolean),
    })
  }
  // 水揚げの計量（市場の記録）
  const landing = !lot && root.events.find((e) => e.type === 'landing')
  if (landing) {
    list.push({ key: 'weigh', kind: 'biz', level: 'ok', label: t.evWeigh, lines: [`${root.kg} kg · ${tr(landing.who)}`, when(root.rawEvents.find((e) => e.id === landing.id)?.created_at)] })
  }
  // 漁船の申告
  const decl = !lot && root.info.declaration
  if (decl) {
    list.push({ key: 'decl', kind: 'self', level: 'ok', label: t.evDecl, lines: [t.declaredBy(tr(root.info.shipName) ?? '', when(decl.at)), t.aisDeclared(tr(root.info.catchArea) ?? '—', root.info.catchFrom ? `${root.info.catchFrom}〜${root.info.catchTo}` : null)] })
  }
  const cur = list.find((x) => x.key === open)
  const mark = (x) => (x.kind === 'self' ? '✎' : x.kind === 'biz' ? '' : x.level === 'ok' ? '✓' : x.level === 'wait' ? '' : '!')
  return (
    <div className="evidence">
      <div className="ev-chips">
        {list.map((x) => (
          <button key={x.key} type="button" className="ev-chip" data-kind={x.kind} data-level={x.level} aria-expanded={open === x.key}
            onClick={() => setOpen((v) => (v === x.key ? null : x.key))}>
            <span className="ev-mark" aria-hidden>{mark(x)}</span>{x.label}
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {cur && (
          <motion.div key={cur.key} className="ev-detail" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="ev-kind" data-kind={cur.kind}>{t.evKinds[cur.kind]}</div>
            {cur.lines.map((l) => <div key={l} className="ev-line">{l}</div>)}
            {cur.link && <a className="hb-tx" href={cur.link} target="_blank" rel="noreferrer"><IconLink size={12} /> {t.viewOnChain}</a>}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="ev-legend">
        <span><i data-kind="third" />{t.evKinds.third}</span><span><i data-kind="biz" />{t.evKinds.biz}</span><span><i data-kind="self" />{t.evKinds.self}</span>
      </div>
    </div>
  )
}

// 船の位置の記録（AIS）との照らし合わせの結果（表紙の印と、下の節の両方で使う）
const aisResultOf = (root, ais) => (ais && !ais.error && ais.linked
  ? checkAis({ catchArea: root.info.catchArea, landingPort: root.info.port, landedAt: root.info.landedAt ?? root.info.createdAt, ais }) : null)

// 申告と、船の位置の記録（AIS）の照らし合わせ
function AisCheck({ root, ais, t, lang }) {
  // 船に AIS がひも付いていない・読めなかったときは何も出さない（消費者には関係のない失敗なので）
  if (ais === undefined || ais?.linked === false || ais?.error) return null
  const res = aisResultOf(root, ais)
  const tr = (x) => term(lang, x)
  const mark = (level) => ({ ok: ['ok', '✓'], partial: ['warn', '!'], ng: ['ng', '!'], none: ['warn', '?'] }[level] ?? ['warn', '?'])
  const Row = ({ level, title, main, sub }) => (
    <div className="ais-row" data-level={mark(level)[0]}>
      <span className="ais-mark" aria-hidden>{mark(level)[1]}</span>
      <div><div className="ais-row-title">{title}</div><div className="ais-row-main">{main}</div>{sub && <div className="ais-row-sub">{sub}</div>}</div>
    </div>
  )
  return (
    <section className="story-section">
      <motion.div {...reveal}>
        <div className="eyebrow-dark">AIS CHECK</div>
        {/* 見出しは結論の言葉で */}
        <h2 className="story-h2">{res ? ({ ok: t.aisTitleOk, partial: t.aisTitlePartial, ng: t.aisTitleNg }[res.area] ?? t.aisTitle) : t.aisTitle}</h2>
        <p className="story-lead">{t.aisLead}</p>
      </motion.div>
      <motion.div className="ais-card glass-dark" {...reveal} transition={{ ...reveal.transition, delay: 0.15 }}>
        {ais === null && <div className="ais-row-sub">{t.aisLoading}</div>}
        {ais?.sample && <div className="ais-sample">{t.aisSample}</div>}
        {res && <>
          <Row level={res.area} title={t.aisArea}
            main={{ ok: t.aisAreaOk, partial: t.aisAreaPartial, ng: t.aisAreaNg, none: ais.declared ? t.aisAreaNoneInPeriod : t.aisAreaNone }[res.area]}
            sub={<>{t.aisDeclared(tr(root.info.catchArea) ?? '—', ais.declared ? `${root.info.catchFrom}〜${root.info.catchTo}` : null)}<br />{res.total ? t.aisSeen(res.top.slice(0, 3).map(([f, n]) => `FAO ${f}：${n}`).join(' / '), res.total) : ''}</>} />
          {res.port && <Row level={res.port} title={t.aisPort}
            main={res.port === 'ok' ? t.aisPortOk(tr(root.info.port), ymd(res.visit.start)) : t.aisPortNg(tr(root.info.port))} />}
          {res.route.length > 0 && <div className="ais-route"><span>{t.aisRoute}</span>{res.route.join(' → ')}</div>}
        </>}
        <div className="ais-foot">
          <a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Powered by Global Fishing Watch</a>
          <span>{t.aisNote}</span>
        </div>
      </motion.div>
    </section>
  )
}

// 加工ロットから作った商品：入れた魚ごとに、船・海域・水揚げと、船の位置の記録との照らし合わせ
function MixSources({ origins, inputKg, t, lang }) {
  const list = useVesselActivities(origins)
  const tr = (x) => term(lang, x)
  const sample = list.some((a) => a?.sample)
  return (
    <section className="story-section">
      <motion.div {...reveal}>
        <div className="eyebrow-dark">INPUTS</div>
        <h2 className="story-h2">{t.mixTitle(origins.length)}</h2>
        <p className="story-lead">{t.mixLead}</p>
      </motion.div>
      <motion.div className="ais-card glass-dark" {...reveal} transition={{ ...reveal.transition, delay: 0.15 }}>
        {sample && <div className="ais-sample">{t.aisSample}</div>}
        {origins.map((o, i) => {
          const ais = list[i]
          const res = ais && !ais.error ? checkAis({ catchArea: o.info.catchArea, landingPort: o.info.port, landedAt: o.info.landedAt ?? o.info.createdAt, ais }) : null
          const level = !res ? 'warn' : res.area === 'ok' && res.port !== 'ng' ? 'ok' : res.area === 'ng' ? 'ng' : 'warn'
          const status = ais === null ? t.aisLoading : !res ? t.mixNoAis
            : res.area === 'ok' ? (res.port === 'ng' ? t.aisPortNg(tr(o.info.port)) : t.mixOk)
              : { partial: t.aisAreaPartial, ng: t.aisAreaNg, none: t.aisAreaNone }[res.area]
          const mark = { ok: '✓', ng: '!', warn: res ? '!' : '?' }[level]
          return (
            <div key={o.id} className="ais-row" data-level={level}>
              <span className="ais-mark" aria-hidden>{mark}</span>
              <div>
                <div className="ais-row-title">{tr(o.info.shipName) ?? '—'} · {tr(o.info.catchArea) ?? t.noArea}</div>
                <div className="ais-row-main">{status}</div>
                <div className="ais-row-sub">{t.mixLanded(o.info.landedAt ? ymd(o.info.landedAt) : '—', inputKg[o.id] ?? o.kg)}</div>
              </div>
            </div>
          )
        })}
        <div className="ais-foot">
          <a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Powered by Global Fishing Watch</a>
          <span>{t.aisNote}</span>
        </div>
      </motion.div>
    </section>
  )
}

// 地図で予期しないエラーが起きても、ページ全体を道連れにしない
class MapBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('地図のエラー', error) }
  render() { return this.state.error ? <MapFallback stops={this.props.stops} t={this.props.t} /> : this.props.children }
}

// 魚の形（横から見た姿・頭が左）。body＝切り分けて塗る部分、fins＝ひれ（塗らない）
// 魚種ごとに形を変える：マグロ・カツオ類／メカジキ（くちばし）／ヨシキリザメ
const FISH = {
  tuna: {
    vb: '0 0 400 160', x0: 18, x1: 396, eye: [44, 76],
    body: 'M18,80 C30,58 80,40 160,37 C240,35 300,52 338,70 L362,58 L396,22 L384,80 L396,138 L362,102 L338,90 C300,108 240,124 160,123 C80,121 30,102 18,80 Z',
    fins: ['M140,39 L172,6 L190,37 Z', 'M250,44 L268,24 L278,48 Z', 'M258,116 L274,140 L284,112 Z', 'M92,86 L152,100 L96,94 Z',
      'M292,52 L298,42 L302,54 Z', 'M306,58 L312,48 L316,60 Z', 'M320,64 L326,54 L330,66 Z', 'M292,108 L298,118 L302,106 Z', 'M306,102 L312,112 L316,100 Z'],
  },
  sword: {
    vb: '-64 0 464 160', x0: 18, x1: 396, eye: [40, 74],
    body: 'M18,80 C30,62 80,50 160,48 C240,46 300,58 338,70 L362,58 L396,18 L384,80 L396,142 L362,102 L338,90 C300,104 240,114 160,114 C80,112 30,98 18,80 Z',
    fins: ['M18,76 L-60,80 L18,84 Z', 'M80,54 L104,2 L136,50 Z', 'M96,94 L150,120 L102,102 Z', 'M270,100 L286,124 L294,98 Z'],
  },
  shark: {
    vb: '0 0 400 160', x0: 8, x1: 394, eye: [40, 80],
    body: 'M8,86 C26,68 90,54 170,54 C250,54 312,64 340,74 L394,16 L372,84 L390,112 L338,96 C300,108 240,118 170,118 C90,118 26,104 8,86 Z',
    fins: ['M150,56 L184,8 L206,56 Z', 'M106,104 L150,148 L152,108 Z', 'M282,62 L292,46 L300,64 Z', 'M276,110 L288,126 L296,108 Z'],
  },
}
const fishOf = (species) => (species === 'メカジキ' ? FISH.sword : species === 'ヨシキリザメ' ? FISH.shark : FISH.tuna)
let fishSeq = 0

// 魚の形を、重さの割合で頭から尾へ切り分けて塗る。segs＝[{ kg, fill, current? }]（rest＝端材は斜線）
function FishSvg({ shape, segs, label, packLabel }) {
  const id = useMemo(() => `fish${++fishSeq}`, [])
  const total = segs.reduce((n, s) => n + s.kg, 0) || 1
  const W = shape.x1 - shape.x0
  let x = shape.x0
  const parts = segs.map((s) => { const w = (W * s.kg) / total; const p = { ...s, x, w }; x += w; return p })
  // 1パックは魚全体のごく一部で、そのままだと見えない。見える最小の幅にして、続くロットの部分から差し引く
  const pi = parts.findIndex((p) => p.pack)
  if (pi >= 0 && parts[pi].w < 5) {
    const d = 5 - parts[pi].w
    parts[pi].w = 5
    if (parts[pi + 1]) { parts[pi + 1].x += d; parts[pi + 1].w = Math.max(0, parts[pi + 1].w - d) }
  }
  return (
    <svg viewBox={shape.vb} className="fish-svg" role="img" aria-label={label}>
      <defs>
        <clipPath id={`${id}-clip`}><path d={shape.body} /></clipPath>
        <linearGradient id={`${id}-cur`} x1="0" x2="1"><stop offset="0" style={{ stopColor: 'var(--accent-strong)' }} /><stop offset="1" style={{ stopColor: 'var(--accent)' }} /></linearGradient>
        <pattern id={`${id}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" style={{ fill: 'var(--surface)' }} /><rect width="4" height="8" style={{ fill: 'var(--surface-2)' }} />
        </pattern>
      </defs>
      {shape.fins.map((d) => <path key={d} d={d} style={{ fill: 'var(--surface-2)' }} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />)}
      <g clipPath={`url(#${id}-clip)`}>
        <rect x={shape.x0 - 20} y="0" width={W + 40} height="160" style={{ fill: 'var(--surface)' }} />
        {parts.map((p, i) => (
          <rect key={i} className="fish-seg" style={{ animationDelay: `${0.15 + i * 0.12}s` }} x={p.x} y="0" width={p.w + 0.5} height="160"
            style={{ fill: p.rest ? `url(#${id}-hatch)` : p.current ? `url(#${id}-cur)` : p.lot ? 'rgba(var(--accent-strong-rgb), 0.35)' : p.fill ?? 'var(--surface-3)' }} />
        ))}
        {parts.slice(1).map((p, i) => <line key={i} x1={p.x} x2={p.x} y1="0" y2="160" style={{ stroke: 'var(--bg)' }} strokeWidth="2.5" />)}
      </g>
      <path d={shape.body} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      <circle cx={shape.eye[0]} cy={shape.eye[1]} r="4.5" style={{ fill: 'var(--bg)' }} stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
      {pi >= 0 && packLabel && (
        <g className="fish-pack-mark">
          <path d={`M${parts[pi].x + parts[pi].w / 2 - 6},-2 L${parts[pi].x + parts[pi].w / 2 + 6},-2 L${parts[pi].x + parts[pi].w / 2},8 Z`} style={{ fill: 'var(--accent)' }} />
          <text x={parts[pi].x + parts[pi].w / 2} y="-8" textAnchor="middle" style={{ fill: 'var(--accent)' }} fontSize="13" fontWeight="700">{packLabel}</text>
        </g>
      )}
    </svg>
  )
}

const MIX_COLORS = ['#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a']

// 重さの内訳：元の魚（加工ロットなら入れた魚）を魚の形で描き、加工品ごとに切り分ける
// 加工品を見ているときは親を、元の魚を見ているときはその魚を描く（加工前なら1色で「未加工」）
function Family({ items, it, t, lang }) {
  const self = !it.parent
  const parent = self ? it : items[it.parent]
  if (!parent) return null
  const tr = (x) => term(lang, x)
  const kids = parent.children.map((id) => items[id])
  const used = kids.reduce((n, k) => n + k.kg, 0)
  const rest = Math.max(0, parent.kg - used)
  const others = kids.filter((k) => k.id !== it.id)
  const unprocessed = self && kids.length === 0
  // 消費者が手にしているのは1パック。ロットのうちの1パック分を明るく、残りのロットを薄い青に
  const packKg = !self && it.qty > 1 && it.unitKg ? it.unitKg : null
  // パックの帯はロットの真ん中に置く（魚の胴の太いところで見えるように）
  const half = packKg ? (it.kg - packKg) / 2 : 0
  const mine = self ? [] : packKg ? [{ kg: half, lot: true }, { kg: packKg, current: true, pack: true }, { kg: half, lot: true }] : [{ kg: it.kg, current: true }]
  const segs = unprocessed ? [{ kg: parent.kg, current: true }]
    : [...mine, ...others.map((k) => ({ kg: k.kg })), ...(rest > 0 ? [{ kg: rest, rest: true }] : [])]
  // 割合：1% 未満は小数1けた
  const pct = (kg) => { const v = (kg / parent.kg) * 100; return v > 0 && v < 1 ? v.toFixed(1) : Math.round(v) }
  const g = (kg) => (kg >= 1 ? `${kg} kg` : `${Math.round(kg * 1000)} g`)
  // 加工ロット：入れた魚（重さに比例した大きさ）と、その割合
  const inputs = parent.unit === 'mix' ? parent.info.inputs.map((id) => items[id]).filter(Boolean) : []
  const inKg = (o) => parent.info.inputKg[o.id] ?? o.kg
  const inTotal = inputs.reduce((n, o) => n + inKg(o), 0) || 1
  const maxIn = Math.max(...inputs.map(inKg), 1)
  return (
    <section className="story-section">
      <motion.div {...reveal}>
        <div className="eyebrow-dark">WEIGHT BALANCE</div>
        <h2 className="story-h2">{unprocessed
          ? <>{tr(parent.name)} <CountUp value={parent.kg} decimals={parent.kg % 1 ? 1 : 0} suffix=" kg" /><br />→ {t.notProcessed}</>
          : t.familyTitle(<CountUp value={parent.kg} decimals={parent.kg % 1 ? 1 : 0} suffix=" kg" />, tr(parent.name), kids.length)}</h2>
        <p className="story-lead">{parent.unit === 'lot' ? t.familyLeadLot : parent.unit === 'mix' ? t.familyLeadMix : t.familyLead}</p>
      </motion.div>
      {inputs.length > 0 && (
        <>
          <div className="mix-inputs">
            {inputs.map((o, i) => (
              <div key={o.id} className="mix-input" style={{ flexGrow: inKg(o), maxWidth: `${Math.max(28, (inKg(o) / maxIn) * 48)}%` }}>
                <FishSvg shape={fishOf(o.species)} segs={[{ kg: 1, fill: MIX_COLORS[i % MIX_COLORS.length] }]} label={tr(o.info.shipName)} />
                <b>{tr(o.info.shipName) ?? '—'}</b>
                <small>{inKg(o)} kg · {Math.round((inKg(o) / inTotal) * 100)}%</small>
              </div>
            ))}
          </div>
          <div className="mix-merge">↓ {t.mixShare} · {tr(parent.name)} {parent.kg} kg</div>
        </>
      )}
      <div className="fish-main">
        <FishSvg shape={fishOf(parent.species)} segs={segs} label={tr(parent.name)} packLabel={packKg ? t.thisPack : null} />
      </div>
      {!unprocessed && (
        <div className="weight-legend">
          {!self && packKg && <span><i className="sw cur" />{t.thisPack} {g(packKg)}（{pct(packKg)}%）</span>}
          {!self && packKg && <span><i className="sw lot" />{t.sameLot(it.qty)} · {it.kg} kg（{pct(it.kg)}%）</span>}
          {!self && !packKg && <span><i className="sw cur" />{t.thisProduct} {it.kg} kg（{pct(it.kg)}%）</span>}
          {others.length > 0 && <span><i className="sw sib" />{self ? t.products : t.otherProducts} {t.lots(others.length)} · {others.reduce((n, k) => n + k.kg, 0).toFixed(1)} kg（{pct(others.reduce((n, k) => n + k.kg, 0))}%）</span>}
          <span><i className="sw rest" />{t.trimmings} {rest.toFixed(1)} kg（{pct(rest)}%）</span>
        </div>
      )}
    </section>
  )
}

// スマホの上の帯（theme-color）を画面の背景の色に合わせる。離れるときは元に戻す
function useBarColor() {
  const [look] = useLook()
  useEffect(() => {
    const m = document.querySelector('meta[name="theme-color"]')
    if (!m) return
    const prev = m.content
    m.content = look === 'sea' ? '#04131d' : '#000000'
    return () => { m.content = prev }
  }, [look])
}

export function ConsumerView({ items, sel, setSel, demo }) {
  useBarColor()
  const [lang, setLang] = useLang()
  const all = Object.values(items)
  const leaves = all.filter((x) => x.children.length === 0)
  const cur = items[sel] ? sel : leaves.find((x) => x.kind === 'prod')?.id ?? leaves[0]?.id
  if (!cur) return <div className="story"><div className="story-empty">{STR[lang].empty}</div></div>
  // パックのラベルの QR には連番（?pack=）が付く
  const pack = Number(new URLSearchParams(location.search).get('pack')) || null
  // 端末が「動きを減らす」設定なら、フェードや移動の動きを止める
  return <MotionConfig reducedMotion="user"><Story key={cur} items={items} cur={cur} all={all} setSel={setSel} demo={demo} lang={lang} setLang={setLang} pack={pack} /></MotionConfig>
}

// QR を読んだが見せられないとき（販売前・ID がない・記録が消された疑い）
export function ConsumerNotice({ status, erased }) {
  useBarColor()
  const [lang, setLang] = useLang()
  const t = STR[lang]
  const [title, lead] = { inactive: [t.inactiveTitle, t.inactiveLead], erased: [t.erasedTitle, t.erasedLead] }[status] ?? [t.missingTitle, t.missingLead]
  return (
    <div className="story">
      <div className="story-notice">
        <div className="hero-toggles"><LookToggle lang={lang} /><LangToggle lang={lang} setLang={setLang} /></div>
        {status !== 'erased' && <div className="notice-fish"><FishMark width={120} color="var(--accent)" eye="var(--bg)" /></div>}
        <div className="eyebrow-dark">{BRAND.ja} {BRAND.en}</div>
        {status === 'erased' && <div className="notice-alert" aria-hidden>!</div>}
        <h1 className="story-h2">{title}</h1>
        <p className="story-lead">{lead}</p>
        {status === 'erased' && erased && (
          <div className="erased-card glass-dark">
            <div className="erased-row"><span>{t.erasedId}</span><b>{erased.id}</b></div>
            <div className="erased-row"><span>{t.erasedIssuer}</span><b>{erased.issuerName ?? shortHash(erased.issuer)}</b></div>
            <a className="hb-tx" href={explorerAddress(erased.issuer)} target="_blank" rel="noreferrer"><IconLink size={12} /> {t.viewOnChain}</a>
          </div>
        )}
      </div>
    </div>
  )
}

// 日本語と英語の切り替え
// 見た目の切り替え：海（気仙沼）／黒
function LookToggle({ lang }) {
  const [look, setLook] = useLook()
  const label = lang === 'en' ? { sea: 'Sea', classic: 'Black' } : { sea: '海', classic: '黒' }
  return (
    <div className="lang-toggle look-toggle" role="group" aria-label={lang === 'en' ? 'Color' : '色'}>
      {['sea', 'classic'].map((v) => (
        <button key={v} type="button" data-active={look === v || undefined} onClick={() => setLook(v)}><span className="look-sw" data-look={v} aria-hidden />{label[v]}</button>
      ))}
    </div>
  )
}

function LangToggle({ lang, setLang }) {
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button type="button" data-active={lang === 'ja' || undefined} onClick={() => setLang('ja')}>日本語</button>
      <button type="button" data-active={lang === 'en' || undefined} onClick={() => setLang('en')}>EN</button>
    </div>
  )
}

function Story({ items, cur, all, setSel, demo, lang, setLang, pack }) {
  const t = STR[lang]
  const tr = (x) => term(lang, x)
  const when = (d) => (lang === 'en' ? new Date(d).toLocaleString('en-US', { timeZone: 'Asia/Tokyo', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : mdhm(d))
  const it = items[cur]
  // main：元（1尾・水揚げロット・加工ロット）から今の商品まで
  // 加工ロットから作った商品は、入れた魚すべてが元の魚（origins）。root はその最初の1件（海域・写真・地図に使う）
  const main = useMemo(() => [...ancestors(items, cur), it], [items, cur])
  const lot = main[0].unit === 'mix' ? main[0] : null
  const origins = useMemo(() => (lot ? lot.info.inputs.map((id) => items[id]).filter(Boolean) : [main[0]]), [main])
  const chain = useMemo(() => (lot ? [...origins, ...main] : main), [main, origins])
  const root = origins[0] ?? main[0]
  const ships = [...new Set(origins.map((o) => o.info.shipName).filter(Boolean))]
  const verify = useVerifyAll(chain)
  const journeyRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: journeyRef, offset: ['start 70%', 'end 60%'] })
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 })

  // 地図の地点：漁獲した海域 → 通った場所を記録の順に。水揚げは水揚げ港、ほかは記録した場所（なければその事業者の登録住所）。
  // 3km 以内に続く地点は1つのピンにまとめ、事業者ごとに「やったこと」を並べる
  const stops = useMemo(() => {
    const s = [{ at: AREA_POINTS[root.info.catchArea] ?? AREA_POINTS['北西太平洋（FAO 61）'], label: t.pinCatch, sub: `${tr(root.info.catchArea) ?? t.unknownArea}${t.pinApprox}`, side: 'left' }]
    const evs = chain.flatMap((c) => c.events.map((e) => ({ e, c }))).filter(({ e }) => t.pinDid[e.type]).sort((a, b) => a.e.id - b.e.id)
    for (const { e, c } of evs) {
      const landing = e.type === 'landing'
      const port = c.info.port ?? '気仙沼港'
      const at = landing ? (PORT_POINTS[port] ?? KESENNUMA_PORT) : e.loc ? [e.loc.lng, e.loc.lat] : e.home
      if (!at) continue
      const name = landing ? tr(port) : tr(e.who)
      const did = t.pinDid[e.type]
      const last = s.length > 1 ? s.at(-1) : null
      const stop = last && km(last.at, at) <= 3 ? last : (s.push({ at, lines: [] }), s.at(-1))
      const line = stop.lines.find((l) => l.label === name) ?? (stop.lines.push({ label: name, dids: [] }), stop.lines.at(-1))
      if (!line.dids.includes(did)) line.dids.push(did)
    }
    // 場所の分かる記録がないときは、これまでどおり気仙沼港を置く
    if (s.length === 1) s.push({ at: KESENNUMA_PORT, lines: [{ label: tr('気仙沼港'), dids: [chain.length > 1 ? t.pinLandedProcessed : t.pinLanded] }] })
    return s.map((p) => {
      if (!p.lines) return p
      const lines = p.lines.map((l) => ({ label: l.label, sub: l.dids.join(' · ') }))
      return { at: p.at, lines, label: lines.map((l) => l.label).join(' / '), sub: lines.map((l) => l.sub).join(' / ') }
    })
  }, [chain, lang])
  const distance = Math.round(stops.slice(1).reduce((n, s, i) => n + km(stops[i].at, s.at), 0) / 10) * 10

  // 船の位置の記録（AIS）：undefined＝船にひも付いていない（何も出さない）/ null＝読み込み中 / { error }＝読めなかった
  const ais = useVesselActivity(root)

  // 道のり：漁獲（船の情報）＋ 各記録を時間順に
  const chapters = useMemo(() => {
    const list = [lot ? {
      key: 'catch', en: 'CAUGHT', ja: '漁獲', title: [...new Set(origins.map((o) => tr(o.info.catchArea) ?? t.noArea))].join(' / '),
      lines: [ships.map(tr).join(' · '), t.mixChapter(origins.length)].filter(Boolean),
    } : {
      key: 'catch', en: 'CAUGHT', ja: '漁獲', title: tr(root.info.catchArea) ?? t.noArea,
      lines: [root.info.shipName && `${tr(root.info.shipName)} · ${tr(root.info.gear) ?? ''}`, root.info.period && t.period(root.info.period),
        root.info.declaration && t.declaredBy(tr(root.info.shipName) ?? '', when(root.info.declaration.at))].filter(Boolean),
    }]
    const evs = main.flatMap((c) => c.rawEvents.map((e) => ({ e, c }))).filter(({ e }) => EV[e.type]).sort((a, b) => a.e.id - b.e.id)
    for (const { e, c } of evs) {
      const ev = c.events.find((x) => x.id === e.id)
      if (e.type === 'landing') list.push({ key: e.id, ...EV.landing, title: tr(c.info.port ?? '気仙沼港'), big: c.kg, unit: 'kg', lines: [t.landedOn(ymd(e.created_at)), tr(ev.who)], at: e.created_at })
      else if (e.type === 'born') list.push({ key: e.id, ...EV.born, title: tr(c.name), big: c.kg, unit: 'kg', lines: [tr(ev.who), t.processedOn(ymd(e.created_at)), c.info.storage && t.storage(tr(c.info.storage))].filter(Boolean), at: e.created_at })
      else if (e.type === 'receive') list.push({ key: e.id, ...EV.receive, title: tr(ev.who), lines: [ev.from && t.receivedFrom(tr(ev.from.name)), ev.wc && `${ev.wc.prev_kg} → ${ev.wc.kg} kg`, when(e.created_at)].filter(Boolean), at: e.created_at })
      else if (e.type === 'sell') list.push({ key: e.id, ...EV.sell, title: tr(ev.who), lines: [e.payload?.display_name && t.displayedAs(e.payload.display_name), when(e.created_at)].filter(Boolean), at: e.created_at })
      else if (ev.to) list.push({ key: e.id, ...EV[e.type], title: t.handedTo(tr(ev.to.name)), lines: [tr(ev.who), when(e.created_at)], at: e.created_at })
      else list.push({ key: e.id, ...EV[e.type], title: ev.detail || (lang === 'en' ? EV[e.type].en : EV[e.type].ja), lines: [tr(ev.who), when(e.created_at)], at: e.created_at })
    }
    if (it.kind === 'prod' && it.info.shelfDays != null) {
      list.push({ key: 'table', en: 'SHELF LIFE', ja: '期限', title: `${it.info.shelfDays > 5 ? t.bestBefore : t.useBy} ${addDays(it.info.createdAt, it.info.shelfDays)}`, lines: [it.info.storage && t.keepAt(tr(it.info.storage))].filter(Boolean) })
    }
    return list
  }, [chain, lang])

  // 写真：元の1尾の写真を主役に。加工品に自分の写真があれば小さく重ねる
  const heroPhoto = root.photos[0] ?? it.photos.at(-1) ?? null
  const ownPhoto = it !== root && it.photos.length && it.photos.at(-1) !== heroPhoto ? it.photos.at(-1) : null
  const days = Math.max(0, Math.round((Date.now() - new Date(root.info.landedAt ?? root.info.createdAt)) / 86400000))
  const allEvents = chain.flatMap((c) => c.events.map((e) => ({ ...e, item: c }))).sort((a, b) => a.id - b.id)

  return (
    <div className="story">
      {/* ---- 表紙 ---- */}
      <section className="story-hero">
        <div className="hero-glow" aria-hidden />
        <div className="hero-top">
          {demo && (
            <div className="demo-picker">
              <Select size="sm" radius="xl" value={cur} onChange={setSel} allowDeselect={false} searchable aria-label={t.demoPicker} comboboxProps={{ withinPortal: true }}
                data={all.map((p) => ({ value: p.id, label: `${tr(p.name)}（${p.id}）` }))} />
            </div>
          )}
          <LookToggle lang={lang} />
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <div className={heroPhoto ? 'hero-grid' : undefined}>
        {heroPhoto && <HeroPhoto main={heroPhoto} sub={ownPhoto} root={root} it={it} verify={verify} t={t} lang={lang} />}
        <div className="hero-text">
        <motion.div className="eyebrow-dark" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>{lot ? t.eyebrowMix : root.unit === 'lot' ? t.eyebrowLot : t.eyebrow}</motion.div>
        <motion.h1 className="story-h1" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.1 }}>{tr(it.name)}</motion.h1>
        <motion.p className="story-meta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.25 }}>
          {it.qty > 1 && it.unitKg
            ? <>{pack && pack <= it.qty ? t.packNo(pack, it.qty) : t.lotPack(it.unitKg >= 1 ? `${it.unitKg}kg` : `${Math.round(it.unitKg * 1000)}g`, it.qty)}<br />{t.meta(it.kg, ships.map(tr).join('・'), tr(root.species), true).replace(/^[^・·]*[・·]\s*/, '')}</>
            : t.meta(it.kg, ships.map(tr).join('・'), tr(root.species), it.kind === 'prod')}
          {/* 水揚げロット：1尾ではなく「どの船が、いつ、どのくらい揚げたまとまりか」を出す */}
          {!lot && root.unit === 'lot' && <><br />{t.fromLot(root.info.landedAt ? new Date(root.info.landedAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'ja-JP', { timeZone: 'Asia/Tokyo', month: lang === 'en' ? 'short' : 'numeric', day: 'numeric' }) : '', tr(root.info.shipName), tr(root.species), tr(root.grade), root.count, root.kg)}</>}
        </motion.p>
        <Seal verify={verify} t={t} />
        <Evidence verify={verify} aisRes={lot ? null : aisResultOf(root, ais)} ais={ais} root={root} lot={lot} allEvents={allEvents} t={t} lang={lang} when={when} />
        <div className="hero-stats">
          <div><b><CountUp value={distance} suffix=" km" /></b><span className="stat-label">{t.statKm}</span></div>
          <div><b><CountUp value={days} suffix={t.daysUnit(days)} /></b><span className="stat-label">{t.statDays}</span></div>
          <div><b><CountUp value={allEvents.length} suffix={t.recordsUnit} /></b><span className="stat-label">{t.statRecords}</span></div>
        </div>
        </div>
        </div>
      </section>

      {/* ---- 旅の地図 ---- */}
      <section className="map-section">
        <motion.div className="map-caption" {...reveal}>
          <div className="eyebrow-dark">ROUTE</div>
          <h2 className="story-h2">{t.mapTitle}</h2>
        </motion.div>
        <MapBoundary stops={stops} t={t}><JourneyMap stops={stops} t={t} ais={ais} /></MapBoundary>
        <div className="map-note"><span className="only-mobile">{t.mapTapHint} ・ </span>{t.mapNote}{ais?.linked ? ` ・ ${t.aisMapNote}` : ''}</div>
      </section>
      {/* 地図の番号の一覧（地図の上には番号の丸だけを置き、名前はここで読む） */}
      <ol className="map-legend">
        {stops.map((s, i) => (
          <li key={i}><span className="map-legend-no">{i + 1}</span>
            <div>{(s.lines ?? [s]).map((l) => <p key={l.label}><b>{l.label}</b>{l.sub && <small>{l.sub}</small>}</p>)}</div>
          </li>
        ))}
      </ol>

      {/* ---- 船の位置の記録との照らし合わせ ---- */}
      {lot ? <MixSources origins={origins} inputKg={lot.info.inputKg} t={t} lang={lang} /> : <AisCheck root={root} ais={ais} t={t} lang={lang} />}

      {/* ---- 道のり ---- */}
      <section className="story-section" ref={journeyRef}>
        <motion.div {...reveal}>
          <div className="eyebrow-dark">RECORD LOG</div>
          <h2 className="story-h2">{t.journeyTitle}</h2>
        </motion.div>
        <div className="chapters">
          <div className="chapter-rail"><motion.div className="chapter-rail-fill" style={{ scaleY: progress }} /></div>
          {chapters.map((c, i) => (
            <motion.article key={c.key} className="chapter" {...reveal}>
              <div className="chapter-no">{String(i + 1).padStart(2, '0')}</div>
              <div className="chapter-body">
                <div className="chapter-en">{c.en}{lang === 'ja' && <span> · {c.ja}</span>}</div>
                <h3 className="chapter-title">{c.title}</h3>
                {c.big != null && <div className="chapter-big"><CountUp value={c.big} decimals={c.big % 1 ? 1 : 0} /><small>{c.unit}</small></div>}
                {c.lines.map((l) => <p key={l} className="chapter-line">{l}</p>)}
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      {/* ---- 1尾から生まれた加工品 ---- */}
      <Family items={items} it={it} t={t} lang={lang} />

      {/* ---- 記録の証明：その場で計算し直し、書き換えも試せる ---- */}
      <section className="story-section proof-section">
        <motion.div {...reveal}>
          <div className="eyebrow-dark">PROOF</div>
          <h2 className="story-h2">{t.proofTitle}</h2>
          <p className="story-lead">
            {t.proofLead}{lang === 'en' ? ' ' : ''}
            {verify?.onchain ? t.proofOnchain
              : verify?.chains?.includes('pending') ? t.proofPending
                : verify?.chains?.includes('none') ? t.proofNone
                  : verify?.chains?.includes('off') ? t.proofOff : ''}
          </p>
        </motion.div>
        <ProofLab chain={chain} t={t} lang={lang} when={when} />
      </section>

      <footer className="story-footer">
        <div>{BRAND.ja} · {BRAND.en} — {t.tagline}</div>
        {!demo && <Anchor href={location.pathname} c="dimmed" size="xs">{t.forBusiness}</Anchor>}
      </footer>
    </div>
  )
}
