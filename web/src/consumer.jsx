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
import { explorerTx } from './api.js'

// 地図に置く地点。海域は正確な漁獲地点ではなく、海域の代表地点（画面にもそう書く）
const AREA_POINTS = {
  '北西太平洋（FAO 61）': [150.5, 37.6],
  '三陸沖': [143.4, 39.0],
}
const KESENNUMA_PORT = [141.5785, 38.9035]
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'

const EV = {
  landing: { en: 'LANDED', ja: '水揚げ' },
  auction: { en: 'AUCTION', ja: 'せり' },
  storage: { en: 'STORED', ja: '冷凍・保管' },
  born: { en: 'PROCESSED', ja: '加工' },
  ship: { en: 'SHIPPED', ja: '出荷' },
  fix: { en: 'CORRECTED', ja: '訂正' },
}

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
function Seal({ verify }) {
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
        <div className="seal-title">{state === 'wait' ? '記録を照合しています' : state === 'ok' ? '記録は書き換えられていません' : '記録が一致しません'}</div>
        <div className="seal-sub">
          {state === 'ok' && `${verify.count}件の記録をすべて確かめました`}
          {state === 'ng' && '記録の一部が書き換えられた可能性があります'}
          {state === 'wait' && '少しお待ちください'}
        </div>
      </div>
    </motion.div>
  )
}

// 表紙の写真（元の1尾）。写真の指紋が記録と一致したら印を出す
function HeroPhoto({ main, sub, root, it, verify }) {
  const isRootPhoto = root.photos[0] === main
  return (
    <motion.figure className="hero-photo" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, ease, delay: 0.15 }}>
      <img src={main.url} alt={`${root.species}の水揚げ時の写真`} />
      <figcaption>
        <span>{isRootPhoto ? '水揚げ時の、この魚の元の姿' : it.name} · {ymd(main.at)}</span>
        {verify?.ok && verify.photoCount > 0 && <span className="photo-ok">写真も記録と一致</span>}
      </figcaption>
      {sub && (
        <motion.div className="hero-photo-sub" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.6, ease }}>
          <img src={sub.url} alt={`${it.name}の写真`} />
          <span>加工後</span>
        </motion.div>
      )}
    </motion.figure>
  )
}

// 旅の地図：海域 → 気仙沼港 → 加工場。画面に入ったら線が伸びていく
function JourneyMap({ stops }) {
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
      const PLACE = { right: ['left', [-7, 0]], left: ['right', [7, 0]], 'below-left': ['top-right', [7, -7]] }
      stops.forEach((s) => {
        const side = s.side === 'left' ? (wide ? 'left' : 'below-left') : 'right'
        const el = document.createElement('div')
        el.className = `map-pin ${side}`
        el.innerHTML = `<span class="dot"></span><span class="tag"><b>${s.label}</b>${s.sub ? `<small>${s.sub}</small>` : ''}</span>`
        new maplibregl.Marker({ element: el, anchor: PLACE[side][0], offset: PLACE[side][1] }).setLngLat(s.at).addTo(map)
      })
      setReady(true)
    })
    return () => {
      mapRef.current = null
      setReady(false)
      try { map.remove() } catch { /* 片付け中のエラーは無視してよい */ }
    }
  }, [stops.map((s) => s.at.join()).join('|')])

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

  if (failed) return <MapFallback stops={stops} />
  return <div ref={box} className="journey-map" />
}

// 地図を表示できないときの代わりの図
function MapFallback({ stops }) {
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
      <div className="fb-note">この端末では地図を表示できませんでした</div>
    </div>
  )
}

// 地図で予期しないエラーが起きても、ページ全体を道連れにしない
class MapBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('地図のエラー', error) }
  render() { return this.state.error ? <MapFallback stops={this.props.stops} /> : this.props.children }
}

// 1尾から生まれた加工品（重さの内訳）
function Family({ items, it }) {
  const parent = items[it.parent]
  if (!parent) return null
  const kids = parent.children.map((id) => items[id])
  const used = kids.reduce((n, k) => n + k.kg, 0)
  return (
    <section className="story-section">
      <motion.div {...reveal}>
        <div className="eyebrow-dark">ONE FISH, MANY TABLES</div>
        <h2 className="story-h2"><CountUp value={parent.kg} decimals={parent.kg % 1 ? 1 : 0} suffix=" kg" />の{parent.name}から、<br />{kids.length}つの加工品が生まれました。</h2>
        <p className="story-lead">これはそのうちの1つです。分けた重さの合計が元の重さを超えないことを、記録のたびに確かめています。</p>
      </motion.div>
      <motion.div className="weight-bar" {...reveal} transition={{ ...reveal.transition, delay: 0.15 }}>
        {kids.map((k, i) => (
          <motion.div key={k.id} className="weight-seg" data-current={k.id === it.id || undefined}
            initial={{ flexGrow: 0 }} whileInView={{ flexGrow: k.kg }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.3 + i * 0.08, ease }}
            title={`${k.name} ${k.kg} kg`} />
        ))}
        <motion.div className="weight-seg rest" initial={{ flexGrow: 0 }} whileInView={{ flexGrow: Math.max(0, parent.kg - used) }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.5, ease }} />
      </motion.div>
      <div className="weight-legend">
        <span><i className="sw cur" />この商品 {it.kg} kg</span>
        <span><i className="sw sib" />ほかの加工品</span>
        <span><i className="sw rest" />骨・皮・端材など {Math.max(0, parent.kg - used).toFixed(1)} kg</span>
      </div>
    </section>
  )
}

export function ConsumerView({ items, sel, setSel, demo }) {
  const all = Object.values(items)
  const leaves = all.filter((x) => x.children.length === 0)
  const cur = items[sel] ? sel : leaves.find((x) => x.kind === 'prod')?.id ?? leaves[0]?.id
  if (!cur) return <div className="story"><div className="story-empty">まだ記録がありません</div></div>
  return <Story key={cur} items={items} cur={cur} all={all} setSel={setSel} demo={demo} />
}

function Story({ items, cur, all, setSel, demo }) {
  const it = items[cur]
  const chain = useMemo(() => [...ancestors(items, cur), it], [items, cur])
  const root = chain[0]
  const verify = useVerifyAll(chain)
  const [proofOpen, setProofOpen] = useState(false)
  const journeyRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: journeyRef, offset: ['start 70%', 'end 60%'] })
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 })

  // 地図の地点（気仙沼の中で近い地点はまとめる）
  const stops = useMemo(() => {
    const s = [{ at: AREA_POINTS[root.info.catchArea] ?? AREA_POINTS['北西太平洋（FAO 61）'], label: '漁獲', sub: `${root.info.catchArea ?? '海域不明'}（代表地点）`, side: 'left' }]
    s.push({ at: KESENNUMA_PORT, label: '気仙沼港', sub: chain.length > 1 ? '水揚げ・加工' : '水揚げ' })
    return s
  }, [chain])
  const distance = Math.round(stops.slice(1).reduce((n, s, i) => n + km(stops[i].at, s.at), 0) / 10) * 10

  // 道のり：漁獲（船の情報）＋ 各記録を時間順に
  const chapters = useMemo(() => {
    const list = [{
      key: 'catch', en: 'CAUGHT', ja: '漁獲', title: root.info.catchArea ?? '海域の記録なし',
      lines: [root.info.shipName && `${root.info.shipName}・${root.info.gear ?? ''}`, root.info.period && `漁獲期間 ${root.info.period}`].filter(Boolean),
    }]
    const evs = chain.flatMap((c) => c.rawEvents.map((e) => ({ e, c }))).filter(({ e }) => EV[e.type]).sort((a, b) => a.e.id - b.e.id)
    for (const { e, c } of evs) {
      const ev = c.events.find((x) => x.id === e.id)
      if (e.type === 'landing') list.push({ key: e.id, ...EV.landing, title: c.info.port ?? '気仙沼港', big: c.kg, unit: 'kg', lines: [`${ymd(e.created_at)} 水揚げ`, ev.who], at: e.created_at })
      else if (e.type === 'born') list.push({ key: e.id, ...EV.born, title: c.name, big: c.kg, unit: 'kg', lines: [ev.who, `${ymd(e.created_at)} 加工`, c.info.storage && `保存 ${c.info.storage}`].filter(Boolean), at: e.created_at })
      else list.push({ key: e.id, ...EV[e.type], title: ev.detail || EV[e.type].ja, lines: [ev.who, mdhm(e.created_at)], at: e.created_at })
    }
    if (it.kind === 'prod' && it.info.shelfDays != null) {
      list.push({ key: 'table', en: 'YOUR TABLE', ja: 'あなたの食卓へ', title: `${it.info.shelfDays > 5 ? '賞味期限' : '消費期限'} ${addDays(it.info.createdAt, it.info.shelfDays)}`, lines: [it.info.storage && `${it.info.storage}で保存してください`].filter(Boolean) })
    }
    return list
  }, [chain])

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
        {demo && (
          <div className="demo-picker">
            <Select size="sm" radius="xl" value={cur} onChange={setSel} allowDeselect={false} searchable aria-label="表示する商品（デモ用）" comboboxProps={{ withinPortal: true }}
              data={all.map((p) => ({ value: p.id, label: `${p.name}（${p.id}）` }))} />
          </div>
        )}
        <div className={heroPhoto ? 'hero-grid' : undefined}>
        {heroPhoto && <HeroPhoto main={heroPhoto} sub={ownPhoto} root={root} it={it} verify={verify} />}
        <div className="hero-text">
        <motion.div className="eyebrow-dark" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>KESENNUMA TRACEABILITY · この魚の履歴書</motion.div>
        <motion.h1 className="story-h1" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.1 }}>{it.name}</motion.h1>
        <motion.p className="story-meta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.25 }}>
          {it.kg} kg ・ {root.info.shipName ?? ''} が獲った{root.species}{it.kind === 'prod' ? 'から' : ''}
        </motion.p>
        <Seal verify={verify} />
        <div className="hero-stats">
          <div><b><CountUp value={distance} suffix=" km" /></b><span className="stat-label">海から港までの旅</span></div>
          <div><b><CountUp value={days} suffix=" 日" /></b><span className="stat-label">水揚げから</span></div>
          <div><b><CountUp value={allEvents.length} suffix=" 件" /></b><span className="stat-label">ここまでの記録</span></div>
        </div>
        </div>
        </div>
      </section>

      {/* ---- 旅の地図 ---- */}
      <section className="map-section">
        <motion.div className="map-caption" {...reveal}>
          <div className="eyebrow-dark">THE JOURNEY</div>
          <h2 className="story-h2">海から、気仙沼へ。</h2>
        </motion.div>
        <MapBoundary stops={stops}><JourneyMap stops={stops} /></MapBoundary>
        <div className="map-note">海域は代表地点です。地図 © OpenFreeMap / OpenStreetMap</div>
      </section>

      {/* ---- 道のり ---- */}
      <section className="story-section" ref={journeyRef}>
        <motion.div {...reveal}>
          <div className="eyebrow-dark">EVERY STEP, RECORDED</div>
          <h2 className="story-h2">ここまでの、すべての記録。</h2>
        </motion.div>
        <div className="chapters">
          <div className="chapter-rail"><motion.div className="chapter-rail-fill" style={{ scaleY: progress }} /></div>
          {chapters.map((c, i) => (
            <motion.article key={c.key} className="chapter" {...reveal}>
              <div className="chapter-no">{String(i + 1).padStart(2, '0')}</div>
              <div className="chapter-body">
                <div className="chapter-en">{c.en} <span>· {c.ja}</span></div>
                <h3 className="chapter-title">{c.title}</h3>
                {c.big != null && <div className="chapter-big"><CountUp value={c.big} decimals={c.big % 1 ? 1 : 0} /><small>{c.unit}</small></div>}
                {c.lines.map((l) => <p key={l} className="chapter-line">{l}</p>)}
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      {/* ---- 1尾から生まれた加工品 ---- */}
      <Family items={items} it={it} />

      {/* ---- 記録の証明（押したときだけ開く） ---- */}
      <section className="story-section proof-section">
        <button type="button" className="proof-toggle" onClick={() => setProofOpen((v) => !v)} aria-expanded={proofOpen}>
          <span>記録の証明を見る</span><small>バイヤー・専門家向け</small><span className="proof-chevron" data-open={proofOpen || undefined}>⌄</span>
        </button>
        <AnimatePresence initial={false}>
          {proofOpen && (
            <motion.div key="proof" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.4, ease }} style={{ overflow: 'hidden' }}>
              <p className="story-lead">
                それぞれの記録は、ひとつ前の記録の指紋（ハッシュ）を含んでいます。1件でも書き換えると、それ以降の指紋がすべて合わなくなります。
                {verify?.onchain
                  ? '指紋はブロックチェーンにも残しているので、記録した事業者自身でもあとから書き換えられません。下のカードの「チェーンで確認」から、ブロックチェーン上の記録を誰でも確かめられます。'
                  : verify?.chains?.includes('pending')
                    ? '（最新の記録をブロックチェーンに書き込んでいるところです。数秒〜数十秒で反映されます）'
                    : verify?.chains?.includes('none')
                      ? '（この商品にはブロックチェーンにつなぐ前の記録が含まれます。それらの指紋はデータベースだけに保存しています）'
                      : '（この環境はまだブロックチェーンにつないでいません。指紋はデータベースに保存しています）'}
              </p>
              <div className="hash-chain">
          {allEvents.map((e, i) => (
            <motion.div key={e.id} className="hash-block glass-dark" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.15 + Math.min(i, 8) * 0.06, ease }}>
              <div className="hb-type">{EV[e.type]?.ja ?? (e.type === 'process' ? '子IDを発行' : e.type === 'activate' ? 'QRを有効化' : e.type)}</div>
              <div className="hb-time">{e.t}</div>
              <code className="hb-hash">{shortHash(e.hash)}</code>
              {e.tx
                ? <a className="hb-tx" href={explorerTx(e.tx)} target="_blank" rel="noreferrer"><IconLink size={12} /> チェーンで確認</a>
                : <span className="hb-tx muted">チェーン未接続</span>}
            </motion.div>
          ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <footer className="story-footer">
        <div>浜の履歴書 · Hama no Rirekisho</div>
        {!demo && <Anchor href={location.pathname} c="dimmed" size="xs">事業者の方はこちら</Anchor>}
      </footer>
    </div>
  )
}
