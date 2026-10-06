// 消費者・バイヤーが見る画面（QRを読むと開く）
// 黒い背景に大きな文字、旅の地図、スクロールに合わせて現れる道のり、という Apple の製品ページ風の構成
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Select, Anchor } from '@mantine/core'
import { motion, useInView, useScroll, useSpring, animate, AnimatePresence } from 'motion/react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './story.css'
import { IconLink } from '@tabler/icons-react'
import { ymd, mdhm, shortHash, addDays, ancestors, useVerifyAll } from './model.js'
import { explorerTx, explorerAddress, fetchVesselActivity } from './api.js'
import { checkAis } from './lib/ais.js'
import { STR, EV_LABEL, term, useLang } from './i18n.jsx'
import { BRAND } from './brand.js'

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
  useEffect(() => {
    if (!inView) return
    const c = animate(0, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: setShown })
    return () => c.stop()
  }, [inView, value])
  return <span ref={ref}>{shown.toLocaleString('ja-JP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>
}

// 改ざん検証の結果（チェックマークが描かれて出る）
function Seal({ verify, t }) {
  const state = verify === null ? 'wait' : verify.ok ? 'ok' : 'ng'
  const color = { wait: '#636366', ok: '#30d158', ng: '#ff453a' }[state]
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

// 旅の地図：海域 → 気仙沼港 → 加工場。画面に入ったら線が伸びていく
function JourneyMap({ stops, t, ais }) {
  const box = useRef(null)
  const mapRef = useRef(null)
  const inView = useInView(box, { once: true, margin: '-120px' })
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(null)

  useEffect(() => {
    // WebGL が使えないブラウザでは地図を作れない。画面全体を落とさず、代わりの図を出す
    let map
    try {
      map = new maplibregl.Map({
        container: box.current, style: MAP_STYLE, interactive: false, attributionControl: { compact: true },
        bounds: new maplibregl.LngLatBounds(stops[0].at, stops[0].at).extend(stops.at(-1).at), fitBoundsOptions: { padding: 90 },
      })
    } catch (e) {
      console.error('地図を作れませんでした', e)
      setFailed(String(e?.message ?? e))
      return
    }
    map.on('error', (e) => console.error('地図のエラー', e?.error ?? e))
    mapRef.current = map
    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } })
      map.addLayer({ id: 'route-glow', type: 'line', source: 'route', paint: { 'line-color': '#0a84ff', 'line-width': 10, 'line-blur': 8, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round' } })
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#64d2ff', 'line-width': 3 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      const b = new maplibregl.LngLatBounds()
      stops.forEach((s) => b.extend(s.at))
      const wide = box.current.clientWidth > 700
      map.fitBounds(b, { padding: wide ? { top: 160, bottom: 160, left: 260, right: 260 } : { top: 150, bottom: 150, left: 60, right: 60 }, duration: 0, maxZoom: 7 })
      // ラベルの出し方：右・左・左下（スマホでは横に並べると重なるので左下）。点の中心が地点に重なるよう基準をずらす
      const PLACE = { right: ['left', [-7, 0]], left: ['right', [7, 0]], 'below-left': ['top-right', [7, -7]], below: ['top', [0, -7]] }
      stops.forEach((s, i) => {
        // 漁獲の海域は左（スマホは左下）。3つ目以降の地点は前の地点とラベルが重ならないよう、交互に左（スマホは下）へ
        const side = s.side === 'left' ? (wide ? 'left' : 'below-left') : i >= 2 && i % 2 === 0 ? (wide ? 'left' : 'below') : 'right'
        const el = document.createElement('div')
        el.className = `map-pin ${side}`
        // 近い場所でいくつもの事業者を通ったときは、1つのピンに「事業者：やったこと」を並べる
        const lines = s.lines ?? [{ label: s.label, sub: s.sub }]
        el.innerHTML = `<span class="dot"></span><span class="tag">${lines.map((l) => `<b>${esc(l.label)}</b>${l.sub ? `<small>${esc(l.sub)}</small>` : ''}`).join('')}</span>`
        new maplibregl.Marker({ element: el, anchor: PLACE[side][0], offset: PLACE[side][1] }).setLngLat(s.at).addTo(map)
      })
      setReady(true)
    })
    return () => {
      mapRef.current = null
      setReady(false)
      try { map.remove() } catch { /* 片付け中のエラーは無視してよい */ }
    }
  }, [stops.map((s) => `${s.at.join()}:${s.label}:${s.sub}`).join('|')])

  useEffect(() => {
    if (!ready || !inView || !box.current) return
    const path = stops.slice(1).flatMap((s, i) => arc(stops[i].at, s.at).slice(i ? 1 : 0))
    const pins = [...box.current.querySelectorAll('.map-pin')]
    pins[0]?.classList.add('on')
    const c = animate(0, 1, {
      duration: 2.6, ease: [0.45, 0, 0.2, 1], delay: 0.3,
      onUpdate: (t) => {
        const n = Math.max(2, Math.round(t * path.length))
        const map = mapRef.current
        if (!map?.style) return // 画面を切り替えて地図が片付けられたあと
        map.getSource('route')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: path.slice(0, n) } })
        // 線が届いた地点を光らせる
        const seg = Math.floor(t * (stops.length - 1) + 0.02)
        pins.forEach((p, i) => i <= seg && p.classList.add('on'))
      },
    })
    return () => c.stop()
  }, [ready, inView])

  // 船の位置の記録（AIS）：漁をしたと見られる地点（橙）と入港した港（白）を、届いたら重ねる
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !ais?.linked || !map?.style) return
    // 日付変更線をまたぐ海域（南太平洋など）は、経度を同じ側にそろえる（地図が地球一周に広がらないように）
    const lon = (x) => (stops[0].at[0] > 90 && x < -90 ? x + 360 : x)
    const fc = (pts) => ({ type: 'FeatureCollection', features: pts.filter((p) => p.lat != null && p.lon != null).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon(p.lon), p.lat] } })) })
    const add = (id, data, paint) => {
      if (map.getSource(id)) return map.getSource(id).setData(data)
      map.addSource(id, { type: 'geojson', data })
      map.addLayer({ id, type: 'circle', source: id, paint }, 'route-glow')
    }
    add('ais-fishing', fc(ais.fishing), { 'circle-radius': 3.5, 'circle-color': '#ff9f0a', 'circle-opacity': 0.75, 'circle-blur': 0.3 })
    add('ais-ports', fc(ais.ports), { 'circle-radius': 4, 'circle-color': '#f5f5f7', 'circle-stroke-color': '#000', 'circle-stroke-width': 1 })
    const b = new maplibregl.LngLatBounds()
    stops.forEach((s) => b.extend(s.at))
    ais.fishing.forEach((p) => p.lat != null && b.extend([lon(p.lon), p.lat]))
    const wide = box.current.clientWidth > 700
    map.fitBounds(b, { padding: wide ? { top: 160, bottom: 160, left: 260, right: 260 } : { top: 150, bottom: 150, left: 60, right: 60 }, duration: 1200, maxZoom: 7 })
  }, [ready, ais])

  if (failed) return <MapFallback stops={stops} t={t} />
  return <div ref={box} className="journey-map" />
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

// 申告と、船の位置の記録（AIS）の照らし合わせ
function AisCheck({ root, ais, t, lang }) {
  // 船に AIS がひも付いていない・読めなかったときは何も出さない（消費者には関係のない失敗なので）
  if (ais === undefined || ais?.linked === false || ais?.error) return null
  const res = ais && !ais.error ? checkAis({ catchArea: root.info.catchArea, landingPort: root.info.port, landedAt: root.info.landedAt ?? root.info.createdAt, ais }) : null
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
        <div className="eyebrow-dark">CHECKED AGAINST VESSEL TRACKING</div>
        <h2 className="story-h2">{t.aisTitle}</h2>
        <p className="story-lead">{t.aisLead}</p>
      </motion.div>
      <motion.div className="ais-card glass-dark" {...reveal} transition={{ ...reveal.transition, delay: 0.15 }}>
        {ais === null && <div className="ais-row-sub">{t.aisLoading}</div>}
        {ais?.sample && <div className="ais-sample">{t.aisSample}</div>}
        {res && <>
          <Row level={res.area} title={t.aisArea}
            main={{ ok: t.aisAreaOk, partial: t.aisAreaPartial, ng: t.aisAreaNg, none: t.aisAreaNone }[res.area]}
            sub={<>{t.aisDeclared(tr(root.info.catchArea) ?? '—')}<br />{res.total ? t.aisSeen(res.top.slice(0, 3).map(([f, n]) => `FAO ${f}：${n}`).join(' / '), res.total) : ''}</>} />
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

// 地図で予期しないエラーが起きても、ページ全体を道連れにしない
class MapBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('地図のエラー', error) }
  render() { return this.state.error ? <MapFallback stops={this.props.stops} t={this.props.t} /> : this.props.children }
}

// 1尾から生まれた加工品（重さの内訳）
function Family({ items, it, t, lang }) {
  const parent = items[it.parent]
  if (!parent) return null
  const kids = parent.children.map((id) => items[id])
  const used = kids.reduce((n, k) => n + k.kg, 0)
  return (
    <section className="story-section">
      <motion.div {...reveal}>
        <div className="eyebrow-dark">{parent.unit === 'lot' ? 'ONE CATCH, MANY TABLES' : 'ONE FISH, MANY TABLES'}</div>
        <h2 className="story-h2">{t.familyTitle(<CountUp value={parent.kg} decimals={parent.kg % 1 ? 1 : 0} suffix=" kg" />, term(lang, parent.name), kids.length)}</h2>
        <p className="story-lead">{parent.unit === 'lot' ? t.familyLeadLot : t.familyLead}</p>
      </motion.div>
      <motion.div className="weight-bar" {...reveal} transition={{ ...reveal.transition, delay: 0.15 }}>
        {kids.map((k, i) => (
          <motion.div key={k.id} className="weight-seg" data-current={k.id === it.id || undefined}
            initial={{ flexGrow: 0 }} whileInView={{ flexGrow: k.kg }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.3 + i * 0.08, ease }}
            title={`${term(lang, k.name)} ${k.kg} kg`} />
        ))}
        <motion.div className="weight-seg rest" initial={{ flexGrow: 0 }} whileInView={{ flexGrow: Math.max(0, parent.kg - used) }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.5, ease }} />
      </motion.div>
      <div className="weight-legend">
        <span><i className="sw cur" />{t.thisProduct} {it.kg} kg</span>
        <span><i className="sw sib" />{t.otherProducts}</span>
        <span><i className="sw rest" />{t.trimmings} {Math.max(0, parent.kg - used).toFixed(1)} kg</span>
      </div>
    </section>
  )
}

export function ConsumerView({ items, sel, setSel, demo }) {
  const [lang, setLang] = useLang()
  const all = Object.values(items)
  const leaves = all.filter((x) => x.children.length === 0)
  const cur = items[sel] ? sel : leaves.find((x) => x.kind === 'prod')?.id ?? leaves[0]?.id
  if (!cur) return <div className="story"><div className="story-empty">{STR[lang].empty}</div></div>
  // パックのラベルの QR には連番（?pack=）が付く
  const pack = Number(new URLSearchParams(location.search).get('pack')) || null
  return <Story key={cur} items={items} cur={cur} all={all} setSel={setSel} demo={demo} lang={lang} setLang={setLang} pack={pack} />
}

// QR を読んだが見せられないとき（販売前・ID がない・記録が消された疑い）
export function ConsumerNotice({ status, erased }) {
  const [lang, setLang] = useLang()
  const t = STR[lang]
  const [title, lead] = { inactive: [t.inactiveTitle, t.inactiveLead], erased: [t.erasedTitle, t.erasedLead] }[status] ?? [t.missingTitle, t.missingLead]
  return (
    <div className="story">
      <div className="story-notice">
        <LangToggle lang={lang} setLang={setLang} />
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
  const chain = useMemo(() => [...ancestors(items, cur), it], [items, cur])
  const root = chain[0]
  const verify = useVerifyAll(chain)
  const [proofOpen, setProofOpen] = useState(false)
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
  const [ais, setAis] = useState(undefined)
  useEffect(() => {
    if (!root.info.shipId) return
    let alive = true
    setAis(null)
    fetchVesselActivity(root.info.shipId, root.info.landedAt ?? root.info.createdAt)
      .then((r) => alive && setAis(r.linked ? r : undefined))
      .catch((e) => alive && setAis({ error: e.message }))
    return () => { alive = false }
  }, [root.id])

  // 道のり：漁獲（船の情報）＋ 各記録を時間順に
  const chapters = useMemo(() => {
    const list = [{
      key: 'catch', en: 'CAUGHT', ja: '漁獲', title: tr(root.info.catchArea) ?? t.noArea,
      lines: [root.info.shipName && `${tr(root.info.shipName)} · ${tr(root.info.gear) ?? ''}`, root.info.period && t.period(root.info.period)].filter(Boolean),
    }]
    const evs = chain.flatMap((c) => c.rawEvents.map((e) => ({ e, c }))).filter(({ e }) => EV[e.type]).sort((a, b) => a.e.id - b.e.id)
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
      list.push({ key: 'table', en: 'YOUR TABLE', ja: 'あなたの食卓へ', title: `${it.info.shelfDays > 5 ? t.bestBefore : t.useBy} ${addDays(it.info.createdAt, it.info.shelfDays)}`, lines: [it.info.storage && t.keepAt(tr(it.info.storage))].filter(Boolean) })
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
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <div className={heroPhoto ? 'hero-grid' : undefined}>
        {heroPhoto && <HeroPhoto main={heroPhoto} sub={ownPhoto} root={root} it={it} verify={verify} t={t} lang={lang} />}
        <div className="hero-text">
        <motion.div className="eyebrow-dark" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>{root.unit === 'lot' ? t.eyebrowLot : t.eyebrow}</motion.div>
        <motion.h1 className="story-h1" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.1 }}>{tr(it.name)}</motion.h1>
        <motion.p className="story-meta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.25 }}>
          {it.qty > 1 && it.unitKg
            ? <>{pack && pack <= it.qty ? t.packNo(pack, it.qty) : t.lotPack(it.unitKg >= 1 ? `${it.unitKg}kg` : `${Math.round(it.unitKg * 1000)}g`, it.qty)}<br />{t.meta(it.kg, tr(root.info.shipName), tr(root.species), true).replace(/^[^・·]*[・·]\s*/, '')}</>
            : t.meta(it.kg, tr(root.info.shipName), tr(root.species), it.kind === 'prod')}
          {/* 水揚げロット：1尾ではなく「どの船が、いつ、どのくらい揚げたまとまりか」を出す */}
          {root.unit === 'lot' && <><br />{t.fromLot(root.info.landedAt ? new Date(root.info.landedAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'ja-JP', { timeZone: 'Asia/Tokyo', month: lang === 'en' ? 'short' : 'numeric', day: 'numeric' }) : '', tr(root.info.shipName), tr(root.species), tr(root.grade), root.count, root.kg)}</>}
        </motion.p>
        <Seal verify={verify} t={t} />
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
          <div className="eyebrow-dark">THE JOURNEY</div>
          <h2 className="story-h2">{t.mapTitle}</h2>
        </motion.div>
        <MapBoundary stops={stops} t={t}><JourneyMap stops={stops} t={t} ais={ais?.linked ? ais : null} /></MapBoundary>
        <div className="map-note">{t.mapNote}{ais?.linked ? ` ・ ${t.aisMapNote}` : ''}</div>
      </section>

      {/* ---- 船の位置の記録との照らし合わせ ---- */}
      <AisCheck root={root} ais={ais} t={t} lang={lang} />

      {/* ---- 道のり ---- */}
      <section className="story-section" ref={journeyRef}>
        <motion.div {...reveal}>
          <div className="eyebrow-dark">EVERY STEP, RECORDED</div>
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

      {/* ---- 記録の証明（押したときだけ開く） ---- */}
      <section className="story-section proof-section">
        <button type="button" className="proof-toggle" onClick={() => setProofOpen((v) => !v)} aria-expanded={proofOpen}>
          <span>{t.proofToggle}</span><small>{t.proofFor}</small><span className="proof-chevron" data-open={proofOpen || undefined}>⌄</span>
        </button>
        <AnimatePresence initial={false}>
          {proofOpen && (
            <motion.div key="proof" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.4, ease }} style={{ overflow: 'hidden' }}>
              <p className="story-lead">
                {t.proofLead}{lang === 'en' ? ' ' : ''}
                {verify?.onchain ? t.proofOnchain
                  : verify?.chains?.includes('pending') ? t.proofPending
                    : verify?.chains?.includes('none') ? t.proofNone
                      : t.proofOff}
              </p>
              <div className="hash-chain">
          {allEvents.map((e, i) => (
            <motion.div key={e.id} className="hash-block glass-dark" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.15 + Math.min(i, 8) * 0.06, ease }}>
              <div className="hb-type">{EV[e.type] ? (lang === 'en' ? EV[e.type].en : EV[e.type].ja) : e.type === 'process' ? t.evProcess : e.type === 'activate' ? t.evActivate : e.type}</div>
              <div className="hb-time">{lang === 'en' ? when(e.item.rawEvents.find((r) => r.id === e.id)?.created_at) : e.t}</div>
              <code className="hb-hash">{shortHash(e.hash)}</code>
              {e.tx
                ? <a className="hb-tx" href={explorerTx(e.tx)} target="_blank" rel="noreferrer"><IconLink size={12} /> {t.viewOnChain}</a>
                : <span className="hb-tx muted">{t.notOnChain}</span>}
            </motion.div>
          ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <footer className="story-footer">
        <div>{BRAND.ja} · {BRAND.en} — {t.tagline}</div>
        {!demo && <Anchor href={location.pathname} c="dimmed" size="xs">{t.forBusiness}</Anchor>}
      </footer>
    </div>
  )
}
