import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './styles.css'
import {
  MantineProvider, createTheme, AppShell, Group, Stack, Text, Title, Button, SegmentedControl, ActionIcon, Menu,
  Paper, Badge, Timeline, TextInput, PasswordInput, NumberInput, Select, Modal, Alert,
  SimpleGrid, Card, Box, ScrollArea, Code, Center, UnstyledButton, Anchor, Loader, ThemeIcon, Checkbox,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { Notifications, notifications } from '@mantine/notifications'
import {
  IconFish, IconSearch, IconPlus, IconCut, IconQrcode, IconShieldCheck, IconSailboat, IconAnchor, IconGavel,
  IconPackage, IconTruck, IconSnowflake, IconPencil, IconCornerDownRight, IconUserSearch, IconDatabase,
  IconAlertTriangle, IconTag, IconLogin, IconLogout, IconLink, IconChevronRight, IconChevronLeft, IconUserCircle,
  IconList, IconCircleCheckFilled, IconLock, IconCamera, IconMapPin, IconPackageImport, IconPackageExport, IconBuildingStore, IconArrowRight, IconPrinter, IconStack2, IconScale, IconLayoutGrid, IconTrash,
} from '@tabler/icons-react'
import { QRCodeSVG } from 'qrcode.react'
import { Html5Qrcode } from 'html5-qrcode'
import {
  supabase, chainEnabled, signIn, signOut, fetchMe, fetchAll, fetchTrace,
  registerLanding, appendEvent, processItem, explorerTx, handover, receiveItem, startSale, handoverMany, receiveMany, sellMany, nextLandingId, makeProcessLot, splitLot,
  declareCatch, fetchVesselFollowup,
} from './api.js'
import { checkWeight, childIds, weightDrift } from './lib/rules.js'
import { checkAis } from './lib/ais.js'
import { compressImage } from './lib/photo.js'
import { OFFSITE_M, currentPosition, positionError } from './lib/geo.js'
import { BRAND } from './brand.js'
import { LogoTile, FishMark, qrLogo } from './logo.jsx'
import { useLook } from './theme.js'
import { ymd, mdhm, shortHash, buildItems, ancestors, rootOf, originsOf, useVerify, useVerifyAll, useVesselActivities } from './model.js'
import { ConsumerNotice, ConsumerView } from './consumer.jsx'

// 主の色の段階（Mantine は10段階で持つ）。apple＝Apple Blue（黒の見た目）、sea＝気仙沼の海の青（theme.js の look で切り替え）
const theme = createTheme({
  primaryColor: 'apple',
  colors: {
    apple: ['#e5f1fc', '#cce3f9', '#99c6f3', '#66aaee', '#338de8', '#0071e3', '#0066cc', '#005bb5', '#004f9e', '#003d7a'],
    sea: ['#e4f4f8', '#c6e7ef', '#93d1e0', '#5db8ce', '#2f9fba', '#14849f', '#0e7089', '#0b5b70', '#084757', '#06333f'],
  },
  primaryShade: 5,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Hiragino Sans', 'BIZ UDPGothic', 'Yu Gothic UI', sans-serif",
  fontFamilyMonospace: "'SF Mono', 'IBM Plex Mono', ui-monospace, monospace",
  headings: { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Hiragino Sans', 'BIZ UDPGothic', sans-serif", fontWeight: '700' },
  defaultRadius: 'md',
  radius: { sm: '8px', md: '12px', lg: '18px', xl: '24px' },
  fontSizes: { xs: '13px', sm: '15px', md: '17px', lg: '20px', xl: '28px' },
  components: {
    Button: { defaultProps: { size: 'md', radius: 'xl' } },
    TextInput: { defaultProps: { size: 'md', variant: 'filled' } },
    PasswordInput: { defaultProps: { size: 'md', variant: 'filled' } },
    NumberInput: { defaultProps: { size: 'md', variant: 'filled' } },
    Select: { defaultProps: { size: 'md', variant: 'filled' } },
    Badge: { defaultProps: { radius: 'xl', variant: 'light' } },
    SegmentedControl: { defaultProps: { radius: 'xl' } },
    Card: { defaultProps: { radius: 'lg', padding: 'lg' }, classNames: { root: 'glass' } },
  },
})

const EVENT_TYPES = {
  catch: { label: '漁獲', icon: IconSailboat },
  landing: { label: '水揚げ・ID発行', icon: IconAnchor },
  auction: { label: 'せり結果', icon: IconGavel },
  storage: { label: '冷凍・保管', icon: IconSnowflake },
  process: { label: '加工（子IDを発行）', icon: IconCut },
  born: { label: '親IDから発行', icon: IconCornerDownRight },
  ship: { label: '出荷', icon: IconTruck },
  fix: { label: '訂正', icon: IconPencil },
  activate: { label: 'QRを有効化', icon: IconTag },
  receive: { label: '受け取り', icon: IconPackageImport },
  sell: { label: '販売開始', icon: IconBuildingStore },
}
// 魚種：コードは ID に入る（FAO の3文字コード。ヨシキリザメだけ以前の SHK のまま）
// lot＝false は1尾ずつ管理（マグロ系）、true は水揚げロット（船 × 水揚げ日 × 魚種 × 銘柄のまとまり）で管理
// kg・count は登録画面の最初の値（見本）
const SPECIES = [
  { name: 'クロマグロ', code: 'PBF', lot: false, kg: 180 },
  { name: 'ミナミマグロ', code: 'SBF', lot: false, kg: 60 },
  { name: 'カツオ', code: 'SKJ', lot: true, kg: 1500, count: 450 },
  { name: 'メバチ', code: 'BET', lot: true, kg: 600, count: 15 },
  { name: 'メカジキ', code: 'SWO', lot: true, kg: 600, count: 8 },
  { name: 'ヨシキリザメ', code: 'SHK', lot: true, kg: 400, count: 20 },
]
const GRADES = ['大', '中', '小', '区分なし']
// 「個体」「水揚げロット」「加工品」の呼び名
const unitWord = (it) => (it.kind === 'prod' ? '加工品' : it.unit === 'lot' ? (it.parent ? '入札の単位' : '水揚げロット') : it.unit === 'mix' ? '加工ロット' : '個体')
// 子の呼び名：水揚げロットを分けたもの（入札の単位）か、加工品か
const kidWord = (it, items) => (it.children.some((id) => items[id]?.unit === 'lot') ? { name: '入札の単位', unit: '件' } : { name: '加工品', unit: 'ロット' })
// 重さの入力の刻み：水揚げロット（数百kg〜）・1尾（数十kg〜）・加工品（kg 未満〜）
const kgInput = (it) => (it.kind === 'prod' ? { steps: [0.1, 1], decimals: 2 } : it.unit === 'lot' || it.unit === 'mix' ? { steps: [10, 100], decimals: 1 } : { steps: [1, 10], decimals: 1 })
const AREAS = ['北西太平洋（FAO 61）', '三陸沖', '中西部太平洋（FAO 71）', '南西太平洋（FAO 81）', 'インド洋東部（FAO 57）', '中東部大西洋（FAO 34）']
// 水揚げ港：遠洋の船は、海外（スペイン）で水揚げしてから冷凍で日本へ運ぶことがある
const PORTS = ['気仙沼港', 'ラス・パルマス港（スペイン）']
const MOBILE = '(max-width: 47.99em)'

const qrUrl = (id, pack) => `${location.origin}${location.pathname}?id=${encodeURIComponent(id)}${pack ? `&pack=${pack}` : ''}`
// 記録できたことを知らせる。チェーンへの記録だけ失敗したときは、そのことも伝える
const notifyRecorded = (title, r) => {
  const geo = r?.locationError ? `（位置は記録できませんでした：${r.locationError}）` : ''
  notifications.show(r?.chainError
    ? { title, message: `記録は保存しました。ブロックチェーンへの記録はできませんでした（${r.chainError.slice(0, 80)}）${geo}`, color: 'yellow', autoClose: 10000 }
    : { title, message: `${r?.txHash ? 'ブロックチェーンに指紋を残しました' : '記録を保存しました'}${geo}`, color: geo ? 'yellow' : 'green', autoClose: geo ? 10000 : 4000 })
}
const errMsg = (e) => notifications.show({ color: 'red', title: 'できませんでした', message: e.message ?? String(e), autoClose: 8000 })
const useIsMobile = () => useMediaQuery(MOBILE, false, { getInitialValueInEffect: false })


// ---- 小さな部品 ----

// iOS の設定画面のような「項目名 … 値」の一覧
function InfoList({ rows }) {
  return (
    <div className="inset-list glass">
      {rows.map(([k, v]) => (
        <div className="inset-row" key={k}><Text size="sm" className="label">{k}</Text><Text size="sm" className="value">{v}</Text></div>
      ))}
    </div>
  )
}

function KindIcon({ kind, size = 36 }) {
  const ind = kind === 'ind'
  return (
    <ThemeIcon size={size} radius="xl" variant="light" color={ind ? undefined : 'orange'}>
      {ind ? <IconFish size={size * 0.55} /> : <IconPackage size={size * 0.55} />}
    </ThemeIcon>
  )
}

function KindBadge({ it }) {
  return <Badge color={it.kind === 'ind' ? undefined : 'orange'}>{unitWord(it)}</Badge>
}

function VerifyBadge({ item, variant = 'light' }) {
  const r = useVerify(item)
  if (!r) return <Badge variant={variant} color="gray" leftSection={<Loader size={10} />}>照合中</Badge>
  if (!r.ok) return <Badge variant={variant} color="red" leftSection={<IconAlertTriangle size={12} />}>記録が一致しません</Badge>
  const chainNote = { match: '・チェーンと一致', none: '（チェーン未記録）', pending: '（チェーンへ記録中）', off: '（チェーン未接続）' }[r.chain] ?? ''
  return <Badge variant={variant} color="green" leftSection={<IconShieldCheck size={12} />}>記録 {item.events.length}件・書き換えなし{chainNote}</Badge>
}

// ロットの数量の表示（「400g × 45パック」）。個体や1個の加工品は空
const gram = (kg) => (kg >= 1 ? `${kg}kg` : `${Math.round(kg * 1000)}g`)
const lotLabel = (it) => (it.qty > 1 && it.unitKg ? `${gram(it.unitKg)} × ${it.qty}パック` : '')
// ラベルの枚数：加工品はパックの数、それ以外（1尾・水揚げロット・入札の単位の箱）は1枚
const labelCount = (it) => (it.kind === 'prod' ? it.qty : 1)

// 魚種ごとの色（一覧のアイコンや詳細の帯に使う）
const SPECIES_COLORS = {
  'クロマグロ': ['#bf1e2d', '#ff375f'], 'ミナミマグロ': ['#af52de', '#ff375f'], 'カツオ': ['#1d3c78', '#0a84ff'],
  'メカジキ': ['#0a84ff', '#64d2ff'], 'ヨシキリザメ': ['#5e5ce6', '#64d2ff'], 'メバチ': ['#ff375f', '#ff9f0a'],
}
const PRODUCT_GRAD = 'linear-gradient(135deg, #ff9f0a, #ffcc00)'
const itemGrad = (it) => {
  if (it.kind === 'prod') return PRODUCT_GRAD
  const [a, b] = SPECIES_COLORS[it.species] ?? ['#0071e3', '#34c759']
  return `linear-gradient(135deg, ${a}, ${b})`
}

function ItemAvatar({ it, size = 40 }) {
  return (
    <Center w={size} h={size} style={{ borderRadius: size * 0.3, background: itemGrad(it), flexShrink: 0, boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)' }}>
      {it.kind === 'ind' ? <IconFish size={size * 0.55} color="white" /> : <IconPackage size={size * 0.55} color="white" />}
    </Center>
  )
}

// 押して選ぶカード（魚種・漁船・加工品）
function ChoiceCard({ checked, onClick, children }) {
  return (
    <UnstyledButton className="choice-card" data-checked={checked || undefined} onClick={onClick} aria-pressed={checked}>
      {children}
      {checked && <IconCircleCheckFilled className="choice-check" size={20} />}
    </UnstyledButton>
  )
}

// 数字を大きく出し、ボタンで増減できる入力（手袋でも押しやすいように）
function BigNumber({ label, value, onChange, unit, steps = [1, 10], min = 0, decimals = 1 }) {
  const v = Number(value) || 0
  const set = (n) => onChange(Math.max(min, Math.round(n * 10 ** decimals) / 10 ** decimals))
  const btn = (d) => <Button key={d} size="compact-sm" variant="light" radius="xl" onClick={() => set(v + d)}>{d > 0 ? `+${d}` : d}</Button>
  return (
    <div>
      <Text className="field-label">{label}</Text>
      <div className="big-number glass">
        <Group gap={4} wrap="nowrap">{[...steps].reverse().map((d) => btn(-d))}</Group>
        <NumberInput variant="unstyled" value={value} onChange={onChange} min={min} decimalScale={decimals} hideControls aria-label={label}
          classNames={{ input: 'big-number-input' }} rightSection={<Text c="dimmed" fw={600} size="sm" style={{ whiteSpace: 'nowrap' }}>{unit}</Text>}
          rightSectionWidth={unit.length * 15 + 12} style={{ flex: 1, minWidth: 0 }} />
        <Group gap={4} wrap="nowrap">{steps.map((d) => btn(d))}</Group>
      </div>
    </div>
  )
}

// 今どこまで進んだか（記録の種類から判定）
const STAGES = {
  ind: [['landing', '水揚げ', IconAnchor], ['auction', 'せり', IconGavel], ['receive', '受け取り', IconPackageImport], ['process', '加工', IconCut]],
  prod: [['born', '発行', IconCornerDownRight], ['ship', '出荷', IconTruck], ['receive', '受け取り', IconPackageImport], ['sell', '販売', IconBuildingStore]],
  mix: [['born', 'ロット作成', IconStack2], ['process', '加工', IconCut]],
}
function Stages({ it }) {
  const done = new Set(it.events.map((e) => (e.type === 'split' ? 'landing' : e.type)))
  return (
    <div className="stages">
      {STAGES[it.unit === 'mix' ? 'mix' : it.kind].map(([k, label, Icon]) => (
        <div key={k} className="stage" data-done={done.has(k) || undefined}>
          <div className="stage-dot"><Icon size={16} /></div>
          <Text size="xs" fw={600}>{label}</Text>
        </div>
      ))}
    </div>
  )
}

// 今日の数字のまとめ
function Overview({ items, dark = false }) {
  const all = Object.values(items)
  const roots = all.filter((x) => !x.parent)
  const today = ymd(new Date())
  const stats = [
    { label: '今日の水揚げ', value: roots.filter((r) => r.info.landedAt && ymd(r.info.landedAt) === today).length, unit: '件', icon: IconAnchor, color: '#0a84ff' },
    { label: '水揚げの記録', value: roots.filter((r) => r.unit !== 'mix').length, unit: '件', icon: IconFish, color: '#5e5ce6' },
    { label: '加工品', value: all.filter((x) => x.kind === 'prod').length, unit: '件', icon: IconPackage, color: '#ff9f0a' },
    { label: '販売中', value: all.filter((x) => x.sold).length, unit: '件', icon: IconBuildingStore, color: '#30d158' },
  ]
  return (
    <div className="overview">
      {stats.map((st, i) => (
        <div key={st.label} className={`stat-tile fadein ${dark ? 'on-dark' : 'glass'}`} style={{ animationDelay: `${i * 50}ms` }}>
          <Center className="stat-icon" style={{ background: st.color }}><st.icon size={18} color="white" /></Center>
          <div><div className="stat-value">{st.value}<small>{st.unit}</small></div><div className="stat-label2">{st.label}</div></div>
        </div>
      ))}
    </div>
  )
}

// 記録した場所：登録住所の近くか、離れていたか（離れていたら黄色で目立たせる）
function LocationNote({ loc }) {
  if (!loc) return <Text size="xs" c="dimmed">位置なし</Text>
  if (loc.distance_m == null) return <Text size="xs" c="dimmed"><IconMapPin size={11} style={{ verticalAlign: -1 }} /> 位置を記録</Text>
  const far = loc.distance_m > OFFSITE_M
  const d = loc.distance_m >= 1000 ? `${(loc.distance_m / 1000).toFixed(1)}km` : `${loc.distance_m}m`
  return far
    ? <Badge size="sm" color="yellow" tt="none" leftSection={<IconMapPin size={11} />}>登録住所から {d} 離れた場所で記録</Badge>
    : <Text size="xs" c="dimmed"><IconMapPin size={11} style={{ verticalAlign: -1 }} /> 登録住所の近く（約 {d}）</Text>
}

// 受け取り時の重さの増減
function WeightNote({ wc }) {
  const d = weightDrift({ prevKg: wc.prev_kg, kg: wc.kg })
  const txt = `重さ ${wc.prev_kg} → ${wc.kg} kg（${wc.diff_kg > 0 ? '+' : ''}${wc.diff_kg} kg、${(d.ratio * 100).toFixed(1)}%）`
  if (d.level === 'gain') return <Badge color="red" tt="none" size="sm">{txt}：増えています（すり替え・水増しの疑い）</Badge>
  if (d.level === 'loss') return <Badge color="yellow" tt="none" size="sm">{txt}：想定より大きく減っています</Badge>
  return <Text size="xs" c="dimmed">{txt}</Text>
}

// ---- 仕入れチェック（買う・受け取る前に） ----
// 記録の書き換え・申告と船の位置（AIS）・指定の仕入れ先 を1行ずつ。level：'ok' / 'warn' / 'ng' / 'wait'
// also：一緒に確かめる記録（まとめて受け取る加工品など）。from：渡し手の事業者（指定の仕入れ先か確かめる）
// enabled＝false のあいだは問い合わせない（閉じている受け取りの画面のため）
function useChecks({ items, it, myBiz, also = [], from = null, enabled = true }) {
  // 元の魚：ふつうは1尾（水揚げロット）。加工ロットから作ったものは、入れた魚すべて
  const origins = originsOf(items, it.id)
  const mixed = rootOf(items, it.id).unit === 'mix'
  const verify = useVerifyAll(enabled ? [...(mixed ? origins : []), ...ancestors(items, it.id), it, ...also] : [])
  const aisList = useVesselActivities(enabled ? origins : [])
  const rows = []
  const row = (key, title, level, text) => rows.push({ key, title, level, text })
  row('rec', '記録', !verify ? 'wait' : verify.ok ? 'ok' : 'ng',
    !verify ? '照合中…' : verify.ok ? `書き換えなし（${verify.count}件）` : '書き換えの疑い')

  // 魚ごとに判定する（short：何尾かをまとめて出すときの言い方）
  const per = origins.map((o, i) => {
    const ais = enabled ? aisList[i] : null
    const name = o.info.shipName ?? o.id
    if (ais === undefined) return { name, area: { level: 'warn', text: '船の位置データなし', short: '位置データなし' } }
    if (ais === null) return { name, area: { level: 'wait' } }
    if (ais.error) return { name, area: { level: 'warn', text: '船の位置データを読み込めません', short: '読み込めない' } }
    const { catchArea, port } = o.info
    const res = checkAis({ catchArea, landingPort: port, landedAt: o.info.landedAt ?? o.info.createdAt, ais })
    const mark = ais.sample ? '（見本）' : ''
    const actual = res.top[0] ? `実際は FAO ${res.top[0][0]}` : ''
    const area = {
      ok: { level: 'ok', text: `申告どおり（${catchArea}）` }, partial: { level: 'warn', text: `一部が申告外（${actual}）`, short: '一部が申告外' },
      ng: { level: 'ng', text: `申告と違う（${actual}）`, short: '申告と違う' },
      none: { level: 'warn', text: ais.declared ? '漁獲期間に操業データなし' : '操業データなし', short: '操業データなし' },
    }[res.area]
    const portRow = !res.port ? null : res.port === 'ok' ? { level: 'ok', text: `${port} ${ymd(res.visit.start)}` } : { level: 'warn', text: `${port}の入港データなし`, short: '入港データなし' }
    return { name, sample: ais.sample, area: { ...area, text: area.text + mark }, port: portRow && { ...portRow, text: portRow.text + mark } }
  })
  // 1尾ならそのまま。何尾かあれば「すべて〜」か、理由ごとに船の名前を並べる
  const add = (key, title, parts, okWord) => {
    const live = parts.filter(Boolean)
    if (!live.length) return
    if (origins.length === 1) return row(key, title, live[0].level, live[0].text)
    if (live.some((x) => x.level === 'wait')) return row(key, title, 'wait', '照合中…')
    const bad = live.filter((x) => x.level !== 'ok')
    if (!bad.length) return row(key, title, 'ok', `${okWord}（${live.length}件）`)
    const g = {}
    for (const x of bad) (g[x.short] ??= new Set()).add(x.name)
    row(key, title, bad.some((x) => x.level === 'ng') ? 'ng' : 'warn', Object.entries(g).map(([k, v]) => `${k}：${[...v].join('・')}`).join('、'))
  }
  // 申告：漁船が自分で申告したか
  add('decl', '申告', origins.map((o) => (o.info.declaration
    ? { level: 'ok', text: `${o.info.declaration.by?.name ?? '漁船'}（${mdhm(o.info.declaration.at)}）`, name: o.info.shipName ?? o.id }
    : { level: 'warn', text: '漁船の申告なし', short: '申告なし', name: o.info.shipName ?? o.id })), '漁船が申告')
  add('area', '漁場', per.map((x) => x.area && { ...x.area, name: x.name }), '申告どおり')
  add('port', '入港', per.map((x) => x.port && { ...x.port, name: x.name }), '入港を確認')
  if (myBiz?.designated_ships) {
    add('ship', '漁船', origins.filter((o) => o.info.shipId).map((o) => {
      const ok = myBiz.designated_ships.includes(o.info.shipId)
      return { level: ok ? 'ok' : 'ng', text: `${o.info.shipName}（${ok ? '指定船' : '指定外'}）`, short: '指定外', name: o.info.shipName }
    }), '指定船')
  }
  if (myBiz?.designated_suppliers && from) {
    const ok = myBiz.designated_suppliers.includes(from.id)
    row('from', '仕入れ先', ok ? 'ok' : 'ng', `${from.name}（${ok ? '指定先' : '指定外'}）`)
  }
  const issues = rows.filter((r) => r.level === 'ng' || r.level === 'warn')
  return { rows, issues, loading: rows.some((r) => r.level === 'wait'), sample: per.some((x) => x.sample) }
}

const CHECK_LOOK = {
  ok: { color: 'green', Icon: IconCircleCheckFilled }, warn: { color: 'yellow', Icon: IconAlertTriangle },
  ng: { color: 'red', Icon: IconAlertTriangle }, wait: { color: 'gray', Icon: null },
}
function CheckRows({ rows }) {
  return (
    <div className="inset-list glass">
      {rows.map((r) => {
        const L = CHECK_LOOK[r.level]
        return (
          <Group key={r.key} gap="sm" wrap="nowrap" className="inset-row" style={{ justifyContent: 'flex-start', alignItems: 'center' }}>
            <ThemeIcon size={24} radius="xl" variant="light" color={L.color} style={{ flexShrink: 0 }}>{L.Icon ? <L.Icon size={14} /> : <Loader size={12} color="gray" />}</ThemeIcon>
            <Text size="sm" className="label" w={64}>{r.title}</Text>
            <Text size="sm" fw={r.level === 'ng' ? 700 : 500} c={r.level === 'ng' ? 'red.7' : undefined} style={{ minWidth: 0 }}>{r.text}</Text>
          </Group>
        )
      })}
    </div>
  )
}

// 受け取る前のチェック：注意があれば、確認のチェックを付けるまで受け取れない
// チェックの結果は受け取りの記録（payload.checks）に入り、指紋に含まれる
function ReceiveChecks({ checks, ack, setAck }) {
  const n = checks.issues.length
  return (
    <div>
      <Text className="field-label">仕入れチェック</Text>
      <CheckRows rows={checks.rows} />
      {!checks.loading && n > 0 && (
        <Alert mt="sm" radius="md" color={checks.issues.some((r) => r.level === 'ng') ? 'red' : 'yellow'} variant="light" icon={<IconAlertTriangle size={18} />} title={`注意 ${n}件`}>
          <Checkbox checked={ack} onChange={(e) => setAck(e.currentTarget.checked)} label="確認のうえ受け取る" />
        </Alert>
      )}
    </div>
  )
}
const checksPayload = (checks) => ({ ok: checks.issues.length === 0, notes: checks.issues.map((r) => `${r.title}：${r.text}`) })
const canReceive = (checks, ack) => !checks.loading && (checks.issues.length === 0 || ack)

// 詳細の「紐づく情報」の一番上（受け取る相手には仕入れ先の行も出る）
function DetailChecks({ items, it, myBiz, from }) {
  const checks = useChecks({ items, it, myBiz, from })
  return (
    <div>
      <Text className="section-label">仕入れチェック</Text>
      <CheckRows rows={checks.rows} />
      <Text size="xs" c="dimmed" mt={6}>船の位置：Global Fishing Watch（約4日遅れ）{checks.sample ? '　※（見本）は表示用の見本データ' : ''}</Text>
    </div>
  )
}

// 加工ロットに入れた魚（押すとその魚を開く）
function MixInputs({ items, lot, setSel }) {
  return (
    <div>
      <Text className="section-label">入れた魚（{lot.info.inputs.length}件・{lot.kg} kg）</Text>
      <div className="inset-list glass">
        {lot.info.inputs.map((id) => {
          const x = items[id]
          return (
            <UnstyledButton key={id} className="list-row" onClick={() => x && setSel(id)}>
              {x && <ItemAvatar it={x} size={32} />}
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={600} truncate>{x ? `${x.info.shipName ?? '—'}・${x.info.catchArea ?? '—'}` : id}</Text>
                <Text size="xs" c="dimmed" truncate>{lot.info.inputKg[id] ?? x?.kg} kg{x?.info.landedAt ? ` · ${ymd(x.info.landedAt)} 水揚げ` : ''} · <span style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{id}</span></Text>
              </div>
              {x && <IconChevronRight size={16} color="var(--apple-text-3)" />}
            </UnstyledButton>
          )
        })}
      </div>
    </div>
  )
}

// 加工ロットを作る：自分が持っていて、まだ加工していない同じ魚種の魚を選ぶ（重さは受け取ったときに量った重さ）
function MixModal({ opened, onClose, item, items, myId, busy, onSave }) {
  const pool = Object.values(items).filter((x) => x.kind === 'ind' && x.unit !== 'mix' && x.species === item.species && !x.into
    && x.children.length === 0 && x.custody.holder === myId && !x.custody.pending)
  const [picked, setPicked] = useState(() => new Set([item.id]))
  const [name, setName] = useState(`${item.species} 加工ロット`)
  const sel = pool.filter((x) => picked.has(x.id))
  const total = sel.reduce((n, x) => n + x.custody.lastKg, 0)
  const toggle = (id) => setPicked((st) => { const n = new Set(st); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <Sheet opened={opened} onClose={onClose} title="加工ロットにまとめる">
      <Stack gap="lg">
        <div>
          <Group justify="space-between" mb={8}>
            <Text className="field-label" mb={0}>入れる魚（{item.species}・手元にあるもの）</Text>
            <Text size="sm" fw={700}>{sel.length}件・{total.toFixed(1)} kg</Text>
          </Group>
          <div className="inset-list glass">
            {pool.length === 0 && <Text size="sm" c="dimmed" p="md">手元に、まとめられる魚がありません</Text>}
            {pool.map((x) => (
              <UnstyledButton key={x.id} className="list-row" data-active={picked.has(x.id) || undefined} onClick={() => toggle(x.id)}>
                <Checkbox checked={picked.has(x.id)} readOnly tabIndex={-1} />
                <ItemAvatar it={x} size={32} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text size="sm" fw={600} truncate>{x.info.shipName ?? '—'}・{x.info.catchArea ?? '—'}</Text>
                  <Text size="xs" c="dimmed" truncate>{x.custody.lastKg} kg · <span style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{x.id}</span></Text>
                </div>
              </UnstyledButton>
            ))}
          </div>
        </div>
        <TextInput label="ロットの名前" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Text size="sm" c="dimmed">入れた魚には、そのあと記録を足せません。加工品はロットから発行します。</Text>
        {/* 加工ロットは2尾以上をまとめるときだけ。1尾なら、その魚から直接「加工して子IDを発行」と同じになる */}
        {sel.length === 1 && <Alert radius="md" color="yellow" variant="light" icon={<IconAlertTriangle size={18} />}>1尾だけなら、その魚の「加工して子IDを発行」を使ってください</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button loading={busy} disabled={sel.length < 2 || !name} leftSection={<IconStack2 size={18} />}
            onClick={() => onSave({ inputs: sel.map((x) => x.id), name, species: item.species })}>{sel.length < 2 ? '2件以上選んでください' : `${sel.length}件でロットを作る`}</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

// 加工の歩留まり：自分が加工した元（1尾・水揚げロット・加工ロット）ごとに、入った重さと出した加工品の重さ
// 出した重さが入った重さを超える記録はサーバーが受け付けない。上限の歩留まり（製品マスタ）を超えたら赤
function YieldPanel({ items, products, myId }) {
  const prodOf = Object.fromEntries(products.map((p) => [p.id, p]))
  const rows = Object.values(items)
    .map((p) => {
      // 入札の単位（水揚げロットを分けたもの）は加工ではないので数えない
      const kids = p.children.map((id) => items[id]).filter((k) => k.row.created_by === myId && k.kind === 'prod')
      if (!kids.length) return null
      const inKg = p.custody.lastKg ?? p.kg
      const outKg = kids.reduce((n, k) => n + k.kg, 0)
      const caps = kids.map((k) => prodOf[k.productId]?.yield_max).filter((v) => v != null).map(Number)
      const cap = caps.length ? Math.max(...caps) : null
      const ratio = inKg > 0 ? outKg / inKg : 0
      return { p, inKg, outKg, ratio, cap, at: kids.map((k) => k.info.createdAt).sort()[0], ng: outKg > inKg || (cap != null && ratio > cap) }
    })
    .filter(Boolean)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
  if (!rows.length) return null
  const tin = rows.reduce((n, r) => n + r.inKg, 0)
  const tout = rows.reduce((n, r) => n + r.outKg, 0)
  return (
    <Card>
      <Group justify="space-between" mb="sm">
        <Text fw={700}><IconScale size={18} style={{ verticalAlign: -3 }} /> 加工の歩留まり</Text>
        <Text size="sm" c="dimmed">計 {tin.toFixed(1)} → {tout.toFixed(1)} kg（{tin > 0 ? Math.round((tout / tin) * 100) : 0}%）</Text>
      </Group>
      <div className="inset-list glass">
        {rows.map((r) => (
          <div key={r.p.id} className="inset-row" style={{ alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} truncate>{r.p.name}</Text>
              <Text size="xs" c="dimmed" truncate>{ymd(r.at)} · <span style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{r.p.id}</span></Text>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <Text size="sm">{r.inKg.toFixed(1)} → {r.outKg.toFixed(1)} kg</Text>
              <Text size="xs" fw={r.ng ? 700 : 500} c={r.ng ? 'red.7' : 'dimmed'}>{Math.round(r.ratio * 100)}%{r.cap != null ? `（上限 ${Math.round(r.cap * 100)}%）` : ''}</Text>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// 履歴：受け取り時のチェック
function ChecksNote({ checks }) {
  if (checks.ok) return <Text size="sm" c="green.8"><IconShieldCheck size={13} style={{ verticalAlign: -2 }} /> 受け取り時のチェック：問題なし</Text>
  return (
    <Text size="sm" c="orange.8"><IconAlertTriangle size={13} style={{ verticalAlign: -2 }} /> 受け取り時のチェック：注意 {checks.notes.length}件（{checks.notes.join('／')}）</Text>
  )
}

// 記録の画面を開いたら位置を取りにいき、取れたか・取れなかった理由を出す（取れなくても記録はできる）
function GeoStatus({ opened }) {
  const [st, setSt] = useState({ state: 'idle' })
  const get = async (fresh) => {
    setSt({ state: 'busy' })
    const p = await currentPosition({ fresh })
    setSt(p ? { state: 'ok', acc: Math.round(p.accuracy) } : { state: 'ng', reason: positionError() })
  }
  useEffect(() => { if (opened) get(false) }, [opened])
  if (st.state === 'idle') return null
  return (
    <Group gap={8} wrap="nowrap" className="geo-status" data-state={st.state}>
      {st.state === 'busy' ? <Loader size={14} /> : <IconMapPin size={16} />}
      <Text size="xs" style={{ flex: 1 }}>
        {st.state === 'busy' && '今いる場所を確かめています…'}
        {st.state === 'ok' && `位置：取得できました（誤差 約${st.acc}m）。記録に場所も残します`}
        {st.state === 'ng' && `位置：${st.reason}。位置なしで記録します`}
      </Text>
      {st.state === 'ng' && <Button size="compact-xs" variant="light" onClick={() => get(true)}>もう一度取得</Button>}
    </Group>
  )
}

// 写真を撮る・選ぶ（スマホではカメラが開く）。送る前に小さくする
function PhotoPicker({ value, onChange, label = '写真', hint }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const pick = async (file) => {
    if (!file) return
    setBusy(true)
    try { onChange(await compressImage(file)) } catch (e) { errMsg(e) } finally { setBusy(false) }
  }
  return (
    <div>
      <Text className="field-label">{label} <Text span size="xs" c="dimmed" fw={400}>（任意）</Text></Text>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
      {value
        ? (
          <div className="photo-preview">
            <img src={value.dataUrl} alt="撮った写真" />
            <Group gap="xs" className="photo-preview-actions">
              <Button size="xs" variant="white" leftSection={<IconCamera size={14} />} onClick={() => input.current.click()}>撮り直す</Button>
              <Button size="xs" variant="white" color="red" onClick={() => onChange(null)}>外す</Button>
            </Group>
          </div>
        )
        : (
          <UnstyledButton className="photo-drop" onClick={() => input.current.click()} disabled={busy}>
            {busy ? <Loader size="sm" /> : (
              <>
                <Center w={44} h={44} style={{ borderRadius: 14, background: 'rgba(0, 113, 227, 0.1)' }}><IconCamera size={24} color="var(--apple-accent)" /></Center>
                <div>
                  <Text size="sm" fw={600}>写真を撮る・選ぶ</Text>
                  <Text size="xs" c="dimmed">{hint ?? '写真の指紋も記録に残すので、あとから差し替えられません'}</Text>
                </div>
              </>
            )}
          </UnstyledButton>
        )}
    </div>
  )
}

// 発行されるラベルの見本
function LabelPreview({ itemId, species, kg, shipName, port = '気仙沼港' }) {
  return (
    <div>
      <Text className="field-label">発行されるラベル</Text>
      <div className="label-preview">
        <Paper p={6} radius="sm" withBorder><QRCodeSVG value={qrUrl(itemId)} size={76} {...qrLogo(76)} /></Paper>
        <div style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" fw={600}>{BRAND.ja} · {port}</Text>
          <Text ff="monospace" fw={700} size="md" style={{ wordBreak: 'break-all' }}>{itemId}</Text>
          <Text size="sm" c="dimmed">{species} · {Number(kg) || 0} kg · {shipName ?? '—'}</Text>
        </div>
      </div>
    </div>
  )
}

// スマホでは全画面、PCでは中央のシートとして開く
function Sheet({ opened, onClose, title, children }) {
  const isMobile = useIsMobile()
  return (
    <Modal opened={opened} onClose={onClose} fullScreen={isMobile} radius={isMobile ? 0 : 'lg'} centered size="lg"
      title={<Text fw={700} size="lg">{title}</Text>} overlayProps={{ backgroundOpacity: 0.3, blur: 6 }}
      transitionProps={{ transition: isMobile ? 'slide-up' : 'pop', duration: 250 }}>
      {children}
    </Modal>
  )
}

// 系譜ツリー
function TreeNode({ items, id, current, onPick, depth = 0 }) {
  const it = items[id]
  return (
    <>
      <UnstyledButton className="list-row" data-active={id === current || undefined} onClick={() => onPick(id)} style={{ paddingLeft: 14 + depth * 24 }}>
        {depth > 0 && <IconCornerDownRight size={16} color="var(--apple-text-3)" />}
        <KindIcon kind={it.kind} size={30} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text size="sm" fw={600} truncate>{it.name}　{it.kg} kg{lotLabel(it) && `（${lotLabel(it)}）`}</Text>
          <Text size="xs" ff="monospace" c="dimmed" truncate>{it.id}{it.custody.holderName && ` · 持ち主 ${it.custody.holderName}`}{it.custody.pendingName && ` → ${it.custody.pendingName}へ引き渡し中`}</Text>
        </div>
      </UnstyledButton>
      {it.children.map((c) => <TreeNode key={c} items={items} id={c} current={current} onPick={onPick} depth={depth + 1} />)}
    </>
  )
}

// ---- 管理画面（ID中心） ----

function ItemList({ items, currentRoot, onPick, onRegister, onScan, isMobile, inbox = [] }) {
  const [q, setQ] = useState('')
  const roots = Object.values(items).filter((x) => !x.parent && (x.id.includes(q.toUpperCase()) || x.name.includes(q)))
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Title order={2} className="headline" fz={isMobile ? 26 : 22}>水揚げ一覧</Title>
        {!isMobile && <ActionIcon variant="light" radius="xl" size="lg" onClick={onScan} aria-label="QRを読んで開く"><IconQrcode size={20} /></ActionIcon>}
      </Group>
      {inbox.length > 0 && (
        <div className="inbox">
          <Text size="xs" fw={700} c="#8a5300" mb={6}><IconPackageImport size={13} style={{ verticalAlign: -2 }} /> あなた宛ての受け取り待ち</Text>
          {inbox.map((b) => (
            <UnstyledButton key={b.key} className="inbox-row" onClick={() => onPick(b.root.id)}>
              <ItemAvatar it={b.root} size={28} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={600} truncate>{b.root.name}{b.split ? ` の入札の単位 ${b.count}件` : b.count > 1 || b.lots ? ` の加工品 ${b.count}ロット` : ''}</Text>
                <Text size="xs" c="dimmed" truncate>{b.from} から · {b.kg.toFixed(1)} kg</Text>
              </div>
              <IconChevronRight size={16} color="var(--apple-text-3)" />
            </UnstyledButton>
          ))}
        </div>
      )}
      <TextInput placeholder="IDか魚種で探す" leftSection={<IconSearch size={18} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label="検索" radius="md" />
      <div className="inset-list glass">
        {roots.map((r, i) => (
          <UnstyledButton key={r.id} className="list-row fadein" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
            data-active={(!isMobile && currentRoot === r.id) || undefined} onClick={() => onPick(r.id)}>
            <ItemAvatar it={r} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text fw={600} size="sm" truncate>{r.name}</Text>
              <Text size="xs" c="dimmed" truncate>{r.kg} kg · <span style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{r.id}</span></Text>
            </div>
            {r.into && <Badge size="sm" color="gray" style={{ flexShrink: 0 }}>ロットへ</Badge>}
            {r.children.length > 0 && (r.children.some((id) => items[id]?.unit === 'lot')
              ? <Badge size="sm" color="blue" style={{ flexShrink: 0 }}>分け {r.children.length}</Badge>
              : <Badge size="sm" color="orange" style={{ flexShrink: 0 }}>加工 {r.children.length}</Badge>)}
            <IconChevronRight size={18} color="var(--apple-text-3)" />
          </UnstyledButton>
        ))}
        {roots.length === 0 && <Text size="sm" c="dimmed" p="md">{q ? '見つかりませんでした' : 'まだ水揚げの記録がありません'}</Text>}
      </div>
      {!isMobile && onRegister && <Button leftSection={<IconPlus size={18} />} onClick={onRegister}>水揚げを登録</Button>}
    </Stack>
  )
}

// ラベルのQR。販売開始で有効になり、消費者が読めるようになる（それまでは薄く表示）
// 事業者はログインしていれば、有効になる前でも読める
function QrBlock({ it, onPrint, size = 112, onBand = false, kid = '加工品' }) {
  return (
    <Stack align="center" gap={8}>
      <Paper p={8} radius="md" shadow={onBand ? 'md' : undefined} style={{ background: 'white' }}>
        <Box style={{ opacity: it.qr === 'active' ? 1 : 0.4 }}><QRCodeSVG value={qrUrl(it.id)} size={size} {...qrLogo(size)} /></Box>
      </Paper>
      {/* QR は販売開始を記録すると自動で公開になる（ボタンはない）。加工した元の魚は、加工品のラベルの QR で公開する */}
      {it.qr === 'active'
        ? <Badge variant={onBand ? 'white' : 'light'} color="green" tt="none" leftSection={<IconCircleCheckFilled size={12} />}>消費者に公開中</Badge>
        : <Badge variant={onBand ? 'white' : 'light'} color="gray" tt="none">{it.children.length > 0 ? `${kid}のラベルで公開` : '販売開始で自動公開'}</Badge>}
      {onPrint && (
        <Button size="compact-xs" variant={onBand ? 'white' : 'subtle'} leftSection={<IconPrinter size={13} />} onClick={onPrint}>
          {labelCount(it) > 1 ? `ラベルを印刷（${labelCount(it)}枚）` : 'ラベルを印刷'}
        </Button>
      )}
    </Stack>
  )
}

// ==== ラベルの印刷 ====
// 画面には出さない印刷用の用紙。印刷するときだけ表示する（styles.css の @media print）
// ブラウザからはプリンターがつながっているか分からないので、印刷の画面を開くだけ（つながっていなければ PDF に保存できる）
function PrintSheet({ job, items }) {
  if (!job) return null
  const labels = job.flatMap((it) => (labelCount(it) > 1 ? Array.from({ length: it.qty }, (_, i) => ({ it, pack: i + 1 })) : [{ it, pack: null }]))
  return createPortal(
    <div className="print-sheet" aria-hidden>
      {labels.map(({ it, pack }) => {
        const root = rootOf(items, it.id)
        return (
          <div className="print-label" key={`${it.id}-${pack ?? 0}`}>
            <QRCodeSVG value={qrUrl(it.id, pack)} size={88} {...qrLogo(88)} />
            <div className="print-label-text">
              <div className="pl-brand"><FishMark width={22} color="#0b2a3a" eye="#fff" /><b>{BRAND.ja}</b> {BRAND.en}<span>気仙沼</span></div>
              <div className="pl-name">{it.name}</div>
              <div className="pl-no">{shortNo(it.id)}{pack ? <small> {pack}/{it.qty}</small> : null}</div>
              <div className="pl-weight">{it.qty > 1 && it.unitKg ? gram(it.unitKg) : `${it.kg} kg`} · {root.species}{root.info.shipName ? ` · ${root.info.shipName}` : ''}</div>
              <div className="pl-id">{it.id}</div>
            </div>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

// ラベルに大きく出す短い番号：KSN-PBF-261006-001-P01 → 1006-001-P01（水揚げの月日・連番・加工品の番号）
const shortNo = (id) => {
  const m = /^KSN-[A-Z]+-\d{2}(\d{4})-(.+)$/.exec(id)
  return m ? `${m[1]}-${m[2]}` : id
}

// 印刷する対象を受け取り、用紙を描いてから印刷の画面を開く
function usePrintLabels() {
  const [job, setJob] = useState(null)
  useEffect(() => {
    if (!job) return
    const done = () => setJob(null)
    window.addEventListener('afterprint', done)
    const t = setTimeout(() => window.print(), 100) // 用紙が描かれてから開く
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [job])
  return [job, setJob]
}

// ==== 水産流通適正化法：太平洋クロマグロの大型魚（30kg以上・解体前） ====
// 2026年4月から対象。取引のときに「名称・漁船名・産地での重さ・陸揚げ日」を伝え（QR などのタグでもよい）、
// 販売日・販売先・販売時の重さを3年間記録する（水産庁のリーフレットによる）。届出（eMAFF）は事業者ごとの手続きで魚籍の外
const tekiseikaTarget = (it) => it.unit === 'fish' && it.species === 'クロマグロ' && it.kg >= 30

function tekiseikaRows(it) {
  let kg = it.kg
  const rows = []
  for (const ev of it.events) {
    const raw = it.rawEvents.find((r) => r.id === ev.id)
    if (Number(ev.kg) > 0) kg = Number(ev.kg)
    if ((ev.type === 'auction' || ev.type === 'ship') && ev.to) rows.push({ id: ev.id, date: ymd(raw.created_at), kind: ev.type === 'auction' ? 'せり（販売）' : '出荷（販売）', from: ev.who, to: ev.to.name, kg })
    else if (ev.type === 'receive') rows.push({ id: ev.id, date: ymd(raw.created_at), kind: '受け取り（買受け）', from: ev.from?.name ?? '—', to: ev.who, kg })
  }
  return rows
}

function TekiseikaSheet({ it }) {
  const rows = tekiseikaRows(it)
  return (
    <>
      <InfoList rows={[
        ['名称', '太平洋クロマグロ（天然）'],
        ['採捕した漁船名', it.info.shipName ?? '—'],
        ['産地における重量', `${it.kg} kg`],
        ['陸揚げ日', it.info.landedAt ? ymd(it.info.landedAt) : '—'],
        ['タグの番号（QR）', <span key="id" style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{it.id}</span>],
      ]} />
      <Text size="sm" fw={600} mt="md" mb={6}>取引の記録（{rows.length}件）</Text>
      {rows.length > 0
        ? (
          <div className="inset-list glass teki-rows">
            {rows.map((r) => (
              <div className="inset-row" key={r.id}>
                <Text size="sm" className="label">{r.date}</Text>
                <Text size="sm" className="value">{r.kind}：{r.from} → {r.to}　{r.kg} kg</Text>
              </div>
            ))}
          </div>
        )
        : <Text size="sm" c="dimmed">まだ取引の記録はありません</Text>}
    </>
  )
}

function TekiseikaCard({ it }) {
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    const t = setTimeout(() => window.print(), 100)
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [printing])
  return (
    <Card>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <div>
          <Text fw={700}>水産流通適正化法の伝達事項</Text>
          <Text size="xs" c="dimmed">太平洋クロマグロ 30kg以上・解体前（2026年4月から対象）</Text>
        </div>
        <Button size="compact-sm" variant="light" leftSection={<IconPrinter size={14} />} onClick={() => setPrinting(true)}>印刷</Button>
      </Group>
      <TekiseikaSheet it={it} />
      <Text size="xs" c="dimmed" mt="sm">ラベルの QR で伝達できます（タグ等による伝達）。取引記録は消せない形で残ります。届出（eMAFF）は各事業者で行ってください。</Text>
      {printing && createPortal(
        <div className="print-sheet print-doc" aria-hidden>
          <h1>水産流通適正化法 伝達事項・取引記録</h1>
          <p>太平洋クロマグロ（30kg以上・解体前）　出力日 {ymd(new Date().toISOString())}　{BRAND.ja} {BRAND.en}</p>
          <TekiseikaSheet it={it} />
        </div>,
        document.body,
      )}
    </Card>
  )
}

function Detail({ items, it, setSel, busy, open, run, guard, isMobile, onBack, me, myBiz, onPrint }) {
  const [tab, setTab] = useState('info')
  useEffect(() => setTab('info'), [it.id])
  const anc = ancestors(items, it.id)
  const root = rootOf(items, it.id)
  // 写真：自分の写真がなければ、元の1尾の写真を引き継いで出す
  const bandPhoto = it.photos.at(-1) ?? root.photos[0] ?? null
  const chainPhotos = [...anc, it].flatMap((c) => c.photos.map((p) => ({ ...p, owner: c })))
  // 立場：今の持ち主か、受け取る相手か、どちらでもないか（未ログインはボタンを押すとログインを求める）
  const myId = me?.business?.id ?? null
  const cu = it.custody
  const isHolder = !!myId && cu.holder === myId
  const isRecipient = !!myId && cu.pending === myId
  const canAct = !myId || (isHolder && !cu.pending)
  // 役割ごとにできる操作（サーバー record-event の決まりと同じ）：加工は加工・小売、販売開始は小売だけ。未ログインは押すとログインを求める
  const role = me?.business?.role
  const canProcess = !me || role === 'processor' || role === 'retailer'
  const canSell = !me || role === 'retailer'
  // 加工品が今どこにあるか（持ち主ごと・引き渡し中ごとの数）
  const kidsWhere = (() => {
    const g = {}
    for (const id of it.children) {
      const c = items[id].custody
      const label = c.pending ? `${c.pendingName}へ引き渡し中` : items[id].sold ? `${c.holderName}で販売中` : `${c.holderName}が保有`
      g[label] = (g[label] ?? 0) + 1
    }
    return Object.entries(g).map(([label, count]) => ({ label, count }))
  })()
  // この親から作られた加工品のうち、自分宛てに引き渡し中のもの／自分が持っていてまだ販売していないもの
  const inboxKids = myId ? it.children.map((id) => items[id]).filter((k) => k.custody.pending === myId) : []
  const kw = kidWord(it, items)
  const isSplit = kw.name === '入札の単位'
  // 入札の単位に分けられるのは、市場が持っている水揚げロット（分けたものは分けない）
  const canSplit = (!me || role === 'market') && it.unit === 'lot' && !it.parent && it.children.every((id) => items[id]?.unit === 'lot')
  const splitRest = isSplit ? (cu.lastKg ?? it.kg) - it.children.reduce((n, id) => n + items[id].kg, 0) : 0
  const myKids = myId ? it.children.map((id) => items[id]).filter((k) => k.custody.holder === myId && !k.custody.pending && !k.sold && k.children.length === 0) : []

  return (
    <Stack gap="lg" className="fadein" key={it.id}>
      {isMobile && (
        <Anchor component="button" onClick={onBack} c="white" fw={500}><Group gap={2}><IconChevronLeft size={20} />水揚げ一覧</Group></Anchor>
      )}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        <div className="detail-band" style={{ background: bandPhoto ? `linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.6)), url("${bandPhoto.url}") center / cover` : itemGrad(it) }}>
          <div className="band-shine" />
          <Group justify="space-between" align="flex-start" wrap="nowrap" gap="lg" style={{ position: 'relative' }}>
            <Stack gap={8} style={{ minWidth: 0, flex: 1 }}>
              {anc.length > 0 && (
                <Group gap={6}>
                  <Text size="xs" c="rgba(255,255,255,0.8)">元をたどる</Text>
                  {anc.map((a) => (
                    <Badge key={a.id} component="button" variant="white" color="dark" onClick={() => setSel(a.id)} style={{ cursor: 'pointer', opacity: 0.9 }} rightSection={<IconChevronRight size={10} />}>
                      {a.name}
                    </Badge>
                  ))}
                </Group>
              )}
              <Group gap={6}><Badge variant="white" color="dark">{unitWord(it)}</Badge><VerifyBadge item={it} variant="white" /></Group>
              <div>
                <Title order={1} className="headline" c="white" fz={isMobile ? 28 : 36}>{it.name}</Title>
                <Text c="rgba(255,255,255,0.88)" size="lg" fw={500}>{it.kg} kg{lotLabel(it) && `（${lotLabel(it)}）`}</Text>
              </div>
              <Text size="xs" ff="monospace" c="rgba(255,255,255,0.85)" style={{ wordBreak: 'break-all' }}>{it.id}</Text>
            </Stack>
            {!isMobile && <QrBlock it={it} onPrint={() => onPrint([it])} size={104} onBand kid={kw.name} />}
          </Group>
        </div>
        <Box p={isMobile ? 'md' : 'lg'}>
          <Stages it={it} />
          {it.parent && <Text size="sm" c="dimmed" mb="sm">親ID <Anchor component="button" ff="monospace" size="sm" onClick={() => setSel(it.parent)}>{it.parent}</Anchor></Text>}
          <div className="custody-bar">
            <Text size="sm"><Text span c="dimmed">{it.children.length ? (isSplit ? '分ける前の持ち主 ' : '加工前の持ち主 ') : '今の持ち主 '}</Text><Text span fw={700}>{cu.holderName ?? '—'}</Text>{isHolder && <Badge size="xs" ml={6}>あなた</Badge>}</Text>
            {kidsWhere.length > 0 && (
              <Text size="sm" className="custody-kids">
                <Text span c="dimmed">{kw.name} {it.children.length}{kw.unit}：</Text>
                {kidsWhere.map((w, i) => <Text span key={w.label} fw={600}>{i ? '、' : ''}{w.label} {w.count}</Text>)}
              </Text>
            )}
            {cu.pending && (
              <Text size="sm" className="custody-pending"><IconArrowRight size={14} style={{ verticalAlign: -2 }} /> <Text span fw={700}>{cu.pendingName}</Text> へ引き渡し中（受け取り待ち）</Text>
            )}
          </div>
          {inboxKids.length > 0 && (
            <Button fullWidth size="lg" mb="sm" leftSection={<IconPackageImport size={20} />} onClick={() => open('bulkReceive')}>
              {kw.name}を受け取る（{inboxKids.length}{kw.unit}・合計 {inboxKids.reduce((n, k) => n + k.custody.lastKg, 0).toFixed(1)} kg）
            </Button>
          )}
          {myKids.length > 0 && !isHolder && (
            <SimpleGrid cols={isMobile ? 1 : 2} spacing="sm" mb="sm">
              {canSell && <Button leftSection={<IconBuildingStore size={18} />} onClick={() => open('bulkSell')}>加工品の販売を始める（{myKids.length}ロット）</Button>}
              <Button leftSection={<IconPackageExport size={18} />} variant="light" onClick={() => open('bulk')}>{kw.name}を引き渡す</Button>
            </SimpleGrid>
          )}
          {it.into ? (
            <Text size="sm" className="custody-note">加工ロット <Anchor component="button" ff="monospace" size="sm" onClick={() => setSel(it.into)}>{it.into}</Anchor> に入れました。加工品はロットから発行します。</Text>
          ) : isRecipient ? (
            <Button fullWidth size="lg" leftSection={<IconPackageImport size={20} />} onClick={() => open('receive')}>{cu.holderName} から受け取る</Button>
          ) : canAct && isSplit ? (
            <Stack gap="xs">
              <Text size="sm" c="dimmed">入札の単位に分けました（{it.children.length}件）。せり・出荷は分けたものごとに記録します。</Text>
              <Group gap={6}>
                {it.children.map((id) => items[id]).map((k) => (
                  <Badge key={k.id} component="button" variant="light" size="lg" tt="none" onClick={() => setSel(k.id)} style={{ cursor: 'pointer' }} rightSection={<IconChevronRight size={12} />}>
                    {k.id.slice(-2)}・{k.kg}kg{k.custody.pending ? `・${k.custody.pendingName}へ` : k.custody.holder !== it.custody.holder ? `・${k.custody.holderName}` : ''}
                  </Badge>
                ))}
              </Group>
              <SimpleGrid cols={isMobile ? 1 : 2} spacing="sm">
                {canSplit && splitRest > 0.05 && <Button leftSection={<IconLayoutGrid size={18} />} variant="light" onClick={() => open('split')}>残りを分ける（{splitRest.toFixed(1)} kg）</Button>}
                <Button leftSection={<IconPlus size={18} />} variant="light" onClick={() => open('add')}>情報を追記</Button>
              </SimpleGrid>
            </Stack>
          ) : canAct && it.children.length > 0 ? (
            <Stack gap="xs">
              <Text size="sm" c="dimmed">加工済みです（加工品 {it.children.length}ロット）。引き渡しはロットごとに記録します。</Text>
              <SimpleGrid cols={isMobile ? 1 : 2} spacing="sm">
                <Button leftSection={<IconPackageExport size={18} />} onClick={() => open('bulk')}>加工品を引き渡す</Button>
                {canSell && myKids.length > 0 && <Button leftSection={<IconBuildingStore size={18} />} variant="light" onClick={() => open('bulkSell')}>加工品の販売を始める（{myKids.length}ロット）</Button>}
                {canProcess && <Button leftSection={<IconCut size={18} />} variant="light" onClick={() => open('process')}>残りを加工する</Button>}
                <Button leftSection={<IconPlus size={18} />} variant="light" onClick={() => open('add')}>情報を追記</Button>
              </SimpleGrid>
            </Stack>
          ) : canAct ? (
            <SimpleGrid cols={isMobile ? 1 : 2} spacing="sm">
              {canProcess && <Button leftSection={<IconCut size={18} />} onClick={() => open('process')}>加工して子IDを発行</Button>}
              {canSplit && <Button leftSection={<IconLayoutGrid size={18} />} onClick={() => open('split')}>入札の単位に分ける</Button>}
              <Button leftSection={<IconPackageExport size={18} />} variant={canSplit ? 'light' : 'filled'} onClick={() => open('handover')}>{role === 'market' ? (canSplit ? 'まとめて引き渡す（せり・出荷）' : '引き渡す（せり・出荷）') : '引き渡す（出荷）'}</Button>
              {canSell && <Button leftSection={<IconBuildingStore size={18} />} variant="light" onClick={() => open('sell')}>販売を始める</Button>}
              <Button leftSection={<IconPlus size={18} />} variant="light" onClick={() => open('add')}>情報を追記</Button>
              {canProcess && it.kind === 'ind' && it.unit !== 'mix' && myId && <Button leftSection={<IconStack2 size={18} />} variant="light" onClick={() => open('mix')} style={{ gridColumn: '1 / -1' }}>ほかの魚とまとめて加工ロットにする</Button>}
            </SimpleGrid>
          ) : isHolder ? (
            <Stack gap="xs">
              <Text size="sm" c="dimmed">{cu.pendingName} の受け取りを待っています。相手を間違えたときは、引き渡し先を変えられます。</Text>
              <SimpleGrid cols={isMobile ? 1 : 2} spacing="sm">
                <Button leftSection={<IconPackageExport size={18} />} variant="light" onClick={() => open('handover')}>引き渡し先を変える</Button>
                <Button leftSection={<IconPlus size={18} />} variant="light" onClick={() => open('add')}>訂正を追記</Button>
              </SimpleGrid>
            </Stack>
          ) : (
            <Text size="sm" c="dimmed" className="custody-note">この魚を今持っているのは {cu.holderName} です。加工・引き渡し・販売を記録できるのは持ち主だけです。</Text>
          )}
          {it.children.length > 0 && (
            <Button mt="sm" variant="subtle" size="xs" leftSection={<IconPrinter size={14} />}
              onClick={() => onPrint(it.children.map((id) => items[id]))}>
              {kw.name}のラベルを印刷（{it.children.length}{kw.unit}・{it.children.reduce((n, id) => n + labelCount(items[id]), 0)}枚）
            </Button>
          )}
          {isMobile && <Box mt="lg"><QrBlock it={it} onPrint={() => onPrint([it])} size={104} kid={kw.name} /></Box>}
        </Box>
      </Card>

      <SegmentedControl fullWidth value={tab} onChange={setTab} size="md"
        data={[{ value: 'info', label: '紐づく情報' }, { value: 'log', label: `履歴 ${it.events.length}` }, { value: 'tree', label: '親子関係' }]} />

      {tab === 'info' && <DetailChecks items={items} it={it} myBiz={myBiz} from={isRecipient ? { id: cu.holder, name: cu.holderName } : null} />}

      {tab === 'info' && root.unit === 'mix' && <MixInputs items={items} lot={root} setSel={setSel} />}

      {tab === 'info' && tekiseikaTarget(it) && <TekiseikaCard it={it} />}

      {tab === 'info' && chainPhotos.length > 0 && (
        <div>
          <Text className="section-label">写真（水揚げ時から引き継ぎ）</Text>
          <div className="photo-strip">
            {chainPhotos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="photo-thumb">
                <img src={p.url} alt={p.owner.name} loading="lazy" />
                <span>{p.owner.kind === 'ind' ? '水揚げ時' : p.owner.name} · {ymd(p.at)}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {tab === 'info' && (
        <SimpleGrid cols={{ base: 1, md: it.kind === 'prod' ? 2 : 1 }} spacing="lg">
          <div>
            <Text className="section-label">{`この${unitWord(it)}の情報`}</Text>
            <InfoList rows={it.attrs} />
          </div>
          {it.kind === 'prod' && (
            <div>
              <Text className="section-label">元の{unitWord(root)}から自動で引き継ぐ情報</Text>
              <InfoList rows={[[`元の${unitWord(root)}のID`, <Anchor key="r" component="button" ff="monospace" size="sm" onClick={() => setSel(root.id)}>{root.id}</Anchor>], ...root.attrs.filter(([k]) => !k.startsWith('重量'))]} />
            </div>
          )}
        </SimpleGrid>
      )}

      {tab === 'log' && (
        <Card>
          <Group gap={8} mb="lg" wrap="nowrap" align="flex-start">
            <IconLock size={16} color="var(--apple-text-2)" style={{ marginTop: 3, flexShrink: 0 }} />
            <Text size="sm" c="dimmed">記録は追記だけできます。間違いは消さずに「訂正」として新しい記録を足します。各記録の指紋（ハッシュ）はブロックチェーンに残ります。</Text>
          </Group>
          <Timeline active={it.events.length} bulletSize={32} lineWidth={2}>
            {it.events.map((e) => {
              const T = EVENT_TYPES[e.type] ?? EVENT_TYPES.fix
              return (
                <Timeline.Item key={e.id} bullet={<T.icon size={16} />} title={<Group gap="xs"><Text fw={600}>{T.label}</Text><Text size="xs" c="dimmed">{e.t}</Text></Group>}>
                  {e.detail && <Text size="sm">{e.detail}</Text>}
                  {e.to && <Text size="sm"><IconArrowRight size={13} style={{ verticalAlign: -2 }} /> {e.to.name} へ引き渡し</Text>}
                  {e.type === 'receive' && e.from && <Text size="sm">{e.from.name} から受け取り</Text>}
                  {e.wc && <WeightNote wc={e.wc} />}
                  {e.decl && <Text size="sm" c="green.8"><IconSailboat size={13} style={{ verticalAlign: -2 }} /> 漁船の申告：{e.decl.by?.name}（{mdhm(e.decl.at)}・<span style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{e.decl.id}</span>）</Text>}
                  {e.checks && <ChecksNote checks={e.checks} />}
                  {e.scale && <Text size="sm" c="green.8"><IconScale size={13} style={{ verticalAlign: -2 }} /> はかり：{e.scale.name} {e.scale.kg} kg{e.scale.total ? '（合計）' : ''}・署名つき</Text>}
                  <Group gap="xs" mt={4}>
                    <Text size="xs" c="dimmed">{e.who}</Text><Code fz="xs">{shortHash(e.hash)}</Code><LocationNote loc={e.loc} />
                    {e.tx && <Anchor size="xs" href={explorerTx(e.tx)} target="_blank"><Group gap={2}><IconLink size={12} />チェーン</Group></Anchor>}
                  </Group>
                </Timeline.Item>
              )
            })}
          </Timeline>
        </Card>
      )}

      {tab === 'tree' && (
        <div>
          <Text className="section-label">元の{unitWord(root)}から、加工でどう分かれたか。押すとその記録を開きます</Text>
          <div className="inset-list glass"><TreeNode items={items} id={root.id} current={it.id} onPick={setSel} /></div>
        </div>
      )}
    </Stack>
  )
}

function Manager({ items, db, sel, setSel, reload, guard, modal, setModal, pane, setPane, me }) {
  const isMobile = useIsMobile()
  const [busy, setBusy] = useState(false)
  const [printJob, setPrintJob] = usePrintLabels()
  // 加工したあとに印刷する：読み直しで新しいロットが一覧に入ってから印刷の画面を開く
  const [printAfterIds, setPrintAfterIds] = useState(null)
  useEffect(() => {
    if (!printAfterIds || !printAfterIds.every((id) => items[id])) return
    setPrintJob(printAfterIds.map((id) => items[id]))
    setPrintAfterIds(null)
  }, [items, printAfterIds])
  const roots = Object.values(items).filter((x) => !x.parent)
  const it = items[sel] ?? roots[0]

  // 書き込み → 読み直し → 通知
  const run = async (fn, done) => {
    setBusy(true)
    try { const r = await fn(); await reload(); setModal(null); done?.(r) } catch (e) { errMsg(e) } finally { setBusy(false) }
  }
  const open = (m) => guard(() => setModal(m))
  const pick = (id) => { setSel(id); setPane('detail') }

  // 自分宛てに引き渡し中のもの（元の1尾ごとにまとめる）
  const myId = me?.business?.id
  // 自分の事業者の行（指定の仕入れ先を持つ）
  const myBiz = db.businesses.find((b) => b.id === myId) ?? null
  const inbox = useMemo(() => {
    if (!myId) return []
    const g = {}
    for (const x of Object.values(items)) {
      if (x.custody.pending !== myId) continue
      const root = rootOf(items, x.id)
      // 元の魚・渡し手・種類（入札の単位か、それ以外か）ごとにまとめる
      const split = x.unit === 'lot' && !!x.parent
      const key = `${root.id}|${x.custody.holder}|${split}`
      g[key] ??= { key, root, count: 0, kg: 0, from: x.custody.holderName, lots: x.kind === 'prod', split }
      g[key].count += 1
      g[key].kg += x.custody.lastKg
    }
    return Object.values(g)
  }, [items, myId])
  // 水揚げの登録は市場だけ（未ログインのときはボタンを押すとログインを求める）
  const canRegister = !me || me.business?.role === 'market'
  const list = <ItemList items={items} currentRoot={it && rootOf(items, it.id).id} onPick={pick} onRegister={canRegister ? () => open('register') : null} onScan={() => setModal('scan')} isMobile={isMobile} inbox={inbox} />
  const yields = myId ? <YieldPanel items={items} products={db.products} myId={myId} /> : null
  const detail = it
    ? <Detail items={items} it={it} setSel={setSel} busy={busy} open={open} run={run} guard={guard} isMobile={isMobile} onBack={() => setPane('list')} me={me} myBiz={myBiz} onPrint={setPrintJob} />
    : (
      <Card><Center mih={260}><Stack align="center" gap="xs">
        <KindIcon kind="ind" size={56} />
        <Text fw={600} mt="xs">まだ水揚げの記録がありません</Text>
        <Text size="sm" c="dimmed">「水揚げを登録」から始めてください</Text>
      </Stack></Center></Card>
    )

  const hour = new Date().getHours()
  const hello = hour < 11 ? 'おはようございます' : hour < 18 ? 'こんにちは' : 'おつかれさまです'
  const showDetail = isMobile && pane === 'detail' && it
  const hero = (
    <section className="mgr-hero" data-compact={showDetail || undefined}>
      <div className="mgr-hero-glow" aria-hidden />
      <div className="mgr-hero-inner">
        {!showDetail && (
          <>
            <Text className="mgr-date">{new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short' })}</Text>
            <Title order={1} className="headline" c="white" fz={isMobile ? 24 : 30} mt={4}>{hello}{me?.business ? `、${me.business.name}` : ''}</Title>
            <Text size="sm" c="rgba(255,255,255,0.7)" mt={4} mb={isMobile ? 'md' : 'lg'}>{me?.business ? '今日の水揚げと加工の記録です' : 'ログインすると記録できます。一覧と履歴はそのまま見られます'}</Text>
            <Overview items={items} dark />
          </>
        )}
      </div>
    </section>
  )

  return (
    <>
      <PrintSheet job={printJob} items={items} />
      {hero}
      <div className="mgr-overlap">
        {isMobile
          ? (showDetail ? detail : <Stack gap="lg"><Card>{list}</Card>{yields}</Stack>)
          : (
            <Box style={{ display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
              <Stack gap="lg"><Card>{list}</Card>{yields}</Stack>
              {detail}
            </Box>
          )}
      </div>

      <RegisterModal key={`reg-${modal === 'register'}`} opened={modal === 'register'} onClose={() => setModal(null)} busy={busy} items={items} ships={db.ships} declarations={db.declarations ?? []}
        onSave={(f) => run(() => registerLanding(f), (r) => { pick(f.itemId); notifyRecorded(`${f.lot ? '水揚げロット' : '個体'}のIDを発行しました：${f.itemId}`, r) })} />
      {it && <>
        <AddInfoModal opened={modal === 'add'} onClose={() => setModal(null)} item={it} busy={busy}
          onSave={(type, detail, photo) => run(() => appendEvent(it.id, type, detail, photo), (r) => notifyRecorded('追記しました', r))} />
        <ProcessModal key={it.id + (modal === 'process')} opened={modal === 'process'} onClose={() => setModal(null)} item={it} items={items} products={db.products} busy={busy}
          onSave={(f) => run(() => processItem({ parent: it, ...f }), (r) => {
            notifyRecorded(`${f.childIds.length}ロット（${f.lots.reduce((n, l) => n + l.quantity, 0)}パック）を発行し、親ID ${it.id} を紐づけました`, r)
            if (f.printAfter) setPrintAfterIds(f.childIds)
          })} />
        <HandoverModal key={`h-${it.id}-${modal === 'handover'}`} opened={modal === 'handover'} onClose={() => setModal(null)} item={it} businesses={db.businesses} myId={me?.business?.id} myRole={me?.business?.role} busy={busy}
          onSave={(f) => run(() => handover({ itemId: it.id, ...f }), (r) => notifyRecorded('引き渡しを記録しました（相手が受け取ると持ち主が移ります）', r))} />
        <BulkHandoverModal key={`b-${it.id}-${modal === 'bulk'}`} opened={modal === 'bulk'} onClose={() => setModal(null)} item={it} items={items} businesses={db.businesses} myId={me?.business?.id} myRole={me?.business?.role} busy={busy}
          onSave={(f) => run(() => handoverMany({ rows: f.ids.map((id) => ({ id, kg: items[id].custody.lastKg })), toId: f.toId, detail: f.detail || '出荷' }), (r) => notifyRecorded(`${kidWord(it, items).name} ${f.ids.length}${kidWord(it, items).unit}（合計 ${f.totalKg.toFixed(1)}kg）の引き渡しを記録しました`, r))} />
        <BulkReceiveModal key={`br-${it.id}-${modal === 'bulkReceive'}`} opened={modal === 'bulkReceive'} onClose={() => setModal(null)} item={it} items={items} myId={me?.business?.id} myBiz={myBiz} busy={busy}
          onSave={(f) => run(() => receiveMany({ rows: f.rows, detail: f.detail, checks: f.checks }), (r) => notifyRecorded(`${kidWord(it, items).name} ${f.rows.length}${kidWord(it, items).unit}の受け取りを記録しました`, r))} />
        <BulkSellModal key={`bs-${it.id}-${modal === 'bulkSell'}`} opened={modal === 'bulkSell'} onClose={() => setModal(null)} item={it} items={items} myId={me?.business?.id} busy={busy}
          onSave={(f) => run(() => sellMany(f), (r) => notifyRecorded(`加工品 ${f.ids.length}ロットの販売開始を記録しました`, r))} />
        <ReceiveModal key={`r-${it.id}-${modal === 'receive'}`} opened={modal === 'receive'} onClose={() => setModal(null)} item={it} items={items} myBiz={myBiz} busy={busy}
          onSave={(f) => run(() => receiveItem({ itemId: it.id, ...f }), (r) => notifyRecorded('受け取りを記録しました。持ち主があなたに移りました', r))} />
        <MixModal key={`m-${it.id}-${modal === 'mix'}`} opened={modal === 'mix'} onClose={() => setModal(null)} item={it} items={items} myId={myId} busy={busy}
          onSave={(f) => run(async () => {
            const code = SPECIES.find((x) => x.name === f.species)?.code ?? 'FSH'
            const itemId = await nextLandingId(`KSN-${code}-${ymd(new Date()).replaceAll('-', '').slice(2)}-M`, Object.keys(items))
            return { ...(await makeProcessLot({ itemId, name: f.name, inputs: f.inputs })), itemId }
          }, (r) => { pick(r.itemId); notifyRecorded(`加工ロット ${r.itemId} を作りました（${f.inputs.length}件）`, r) })} />
        <SplitModal key={`sp-${it.id}-${modal === 'split'}`} opened={modal === 'split'} onClose={() => setModal(null)} item={it} items={items} busy={busy}
          onSave={(f) => run(() => splitLot({ parentId: it.id, lots: f.lots }), (r) => {
            notifyRecorded(`${f.lots.length}件に分けました（${f.lots.map((l) => l.itemId.slice(-2)).join('・')}）`, r)
            if (f.printAfter) setPrintAfterIds(f.lots.map((l) => l.itemId))
          })} />
        <SellModal key={`s-${it.id}-${modal === 'sell'}`} opened={modal === 'sell'} onClose={() => setModal(null)} item={it} busy={busy}
          onSave={(f) => run(() => startSale({ itemId: it.id, ...f }), (r) => notifyRecorded('販売開始を記録しました', r))} />
      </>}
    </>
  )
}

// 漁船：水揚げした魚ごとに、そこから作られたもの（加工ロット・加工品）をたどって、段階と行き先をまとめる
function followupOf(data) {
  const items = Object.fromEntries(data.items.map((i) => [i.id, i]))
  const evs = {}
  for (const e of data.events) (evs[e.item_id] ??= []).push(e)
  const kidsOf = (id) => data.items.filter((i) => i.parent_id === id || i.inputs?.includes(id))
  return data.roots.filter((r) => items[r.id]).map((r) => {
    const all = []
    const walk = (id) => { if (all.includes(id)) return; all.push(id); kidsOf(id).forEach((k) => walk(k.id)) }
    walk(r.id)
    const list = all.map((id) => items[id])
    const ev = all.flatMap((id) => evs[id] ?? [])
    const auction = (evs[r.id] ?? []).find((e) => e.type === 'auction')
    const products = list.filter((i) => i.kind === 'product')
    const lot = list.find((i) => i.kind === 'process_lot')
    const processors = [...new Set(ev.filter((e) => e.type === 'born').map((e) => e.who))]
    // 販売中：店ごとのパック数
    const shops = {}
    for (const e of ev.filter((x) => x.type === 'sell')) {
      shops[e.who] ??= { packs: 0, names: new Set() }
      shops[e.who].packs += items[e.item_id]?.quantity ?? 1
      if (e.display_name) shops[e.who].names.add(e.display_name)
    }
    return {
      root: items[r.id], declarationId: r.declaration_id, auction, lot, products, processors,
      packs: products.reduce((n, p) => n + p.quantity, 0),
      shops: Object.entries(shops).map(([who, v]) => ({ who, packs: v.packs, names: [...v.names] })),
    }
  })
}

function FollowupCard({ f }) {
  const steps = [
    { label: '水揚げ', done: true, text: `${ymd(f.root.landed_at ?? f.root.created_at)} · ${f.root.landing_port ?? '—'}` },
    { label: 'せり', done: !!f.auction, text: f.auction ? `買受：${f.auction.to ?? '—'}` : '—' },
    { label: '加工', done: f.products.length > 0 || !!f.lot,
      text: f.products.length ? `${f.processors.join('・') || '—'} · 加工品 ${f.products.length}ロット・${f.packs}パック${f.lot ? `（加工ロット ${f.lot.inputs?.length ?? 1}件）` : ''}` : f.lot ? `加工ロット ${f.lot.id}` : '—' },
    { label: '販売', done: f.shops.length > 0, text: f.shops.length ? f.shops.map((s) => `${s.who} ${s.packs}パック`).join('・') : '—' },
  ]
  return (
    <div className="inset-row" style={{ display: 'block' }}>
      <Group justify="space-between" wrap="nowrap" mb={8}>
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={700}>{f.root.species} {f.root.weight_kg} kg</Text>
          <Text size="xs" c="dimmed" ff="monospace" truncate>{f.root.id}{f.declarationId ? ` · ${f.declarationId}` : ''}</Text>
        </div>
        <Badge color={f.shops.length ? 'green' : 'gray'} style={{ flexShrink: 0 }}>{f.shops.length ? '販売中' : steps.filter((s) => s.done).at(-1).label}</Badge>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 4 }} spacing="xs">
        {steps.map((s) => (
          <div key={s.label} className="followup-step" data-done={s.done || undefined}>
            <Text size="xs" fw={700}>{s.done ? '✓ ' : ''}{s.label}</Text>
            <Text size="xs" c="dimmed">{s.text}</Text>
          </div>
        ))}
      </SimpleGrid>
      {f.shops.some((s) => s.names.length) && <Text size="xs" c="dimmed" mt={6}>売場表示：{[...new Set(f.shops.flatMap((s) => s.names))].join('・')}</Text>}
    </div>
  )
}

// 漁船の画面：水揚げの前に漁獲を申告する（自分の鍵で署名・その場の位置も記録）。申告した一覧
function VesselPage({ me, db, reload }) {
  const isMobile = useIsMobile()
  const myBiz = db.businesses.find((b) => b.id === me.business.id)
  const ship = db.ships.find((s) => s.id === myBiz?.ship_id)
  const [species, setSpecies] = useState(SPECIES[0].name)
  const [area, setArea] = useState(AREAS[0])
  const [catchFrom, setCatchFrom] = useState(ymd(new Date(Date.now() - 30 * 86400000)))
  const [catchTo, setCatchTo] = useState(ymd(new Date()))
  const [estKg, setEstKg] = useState(SPECIES[0].kg)
  const [estCount, setEstCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const sp = SPECIES.find((x) => x.name === species)
  const mine = (db.declarations ?? []).filter((d) => d.declared_by === me.business.id)
  // 水揚げ後の記録（申告から水揚げされた魚の、その後）
  const [follow, setFollow] = useState(null)
  useEffect(() => { fetchVesselFollowup().then((d) => setFollow(followupOf(d))).catch((e) => setFollow({ error: e.message })) }, [db])
  const landedDecl = new Map((Array.isArray(follow) ? follow : []).map((f) => [f.declarationId, f.root.id]))
  const submit = async () => {
    setBusy(true)
    try {
      const r = await declareCatch({ species, catchArea: area, catchFrom, catchTo, estKg: Number(estKg), estCount: sp.lot ? Number(estCount) : 1 })
      await reload()
      notifyRecorded(`申告しました：${r.id}`, r)
    } catch (e) { errMsg(e) } finally { setBusy(false) }
  }
  return (
    <>
      <section className="mgr-hero">
        <div className="mgr-hero-glow" aria-hidden />
        <div className="mgr-hero-inner">
          <Text className="mgr-date">{new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short' })}</Text>
          <Title order={1} className="headline" c="white" fz={isMobile ? 24 : 30} mt={4} mb="lg">{ship?.name ?? me.business.name}</Title>
        </div>
      </section>
      <div className="mgr-overlap">
        <Box style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 360px', gap: 28, alignItems: 'start' }}>
          <Card>
            <Stack gap="lg">
              <Title order={2} className="headline" fz={22}>漁獲の申告</Title>
              <Select label="魚種" data={SPECIES.map((x) => x.name)} value={species} allowDeselect={false}
                onChange={(v) => { const x = SPECIES.find((y) => y.name === v); setSpecies(v); setEstKg(x.kg); setEstCount(x.count ?? 1) }} />
              <div>
                <Text className="field-label">漁獲海域</Text>
                <SegmentedControl fullWidth data={AREAS} value={area} onChange={setArea} orientation="vertical" />
              </div>
              <SimpleGrid cols={2} spacing="xs">
                <TextInput type="date" label="漁獲期間（始まり）" value={catchFrom} max={catchTo} onChange={(e) => e.currentTarget.value && setCatchFrom(e.currentTarget.value)} />
                <TextInput type="date" label="漁獲期間（終わり）" value={catchTo} max={ymd(new Date())} onChange={(e) => e.currentTarget.value && setCatchTo(e.currentTarget.value)} />
              </SimpleGrid>
              {sp.lot && <BigNumber label="尾数（見込み）" value={estCount} onChange={setEstCount} unit="尾" steps={[1, 10]} min={1} decimals={0} />}
              <BigNumber label="重さ（見込み）" value={estKg} onChange={setEstKg} unit="kg" steps={sp.lot ? [10, 100] : [1, 10]} min={0.1} />
              <GeoStatus opened />
              <Button size="lg" loading={busy} disabled={!ship || catchFrom > catchTo} leftSection={<IconSailboat size={20} />} onClick={submit}>申告する</Button>
              {!ship && <Text size="sm" c="red">この漁船の事業者に、船がひも付いていません</Text>}
            </Stack>
          </Card>
          <Card>
            <Text fw={700} mb="sm">申告した漁獲（{mine.length}件）</Text>
            <div className="inset-list glass">
              {mine.map((d) => (
                <div key={d.id} className="inset-row" style={{ display: 'block' }}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" fw={600}>{d.species}・{d.catch_area}</Text>
                    <Badge size="sm" color={landedDecl.has(d.id) ? 'green' : 'gray'} style={{ flexShrink: 0 }}>{landedDecl.has(d.id) ? '水揚げ済み' : '水揚げ前'}</Badge>
                  </Group>
                  <Text size="xs" c="dimmed">{d.catch_from}〜{d.catch_to} · {mdhm(d.created_at)}</Text>
                  <Group gap="xs" mt={2}>
                    <Text size="xs" ff="monospace" c="dimmed">{d.id}</Text>
                    {d.tx_hash && <Anchor size="xs" href={explorerTx(d.tx_hash)} target="_blank"><Group gap={2}><IconLink size={12} />チェーン</Group></Anchor>}
                  </Group>
                </div>
              ))}
              {mine.length === 0 && <Text size="sm" c="dimmed" p="md">まだ申告はありません</Text>}
            </div>
          </Card>
        </Box>
        <Card mt="lg">
          <Text fw={700} mb="sm">水揚げ後の記録（{Array.isArray(follow) ? follow.length : '…'}件）</Text>
          {follow?.error && <Text size="sm" c="red">読み込めません：{follow.error}</Text>}
          {Array.isArray(follow) && (
            <div className="inset-list glass">
              {follow.map((f) => <FollowupCard key={f.root.id} f={f} />)}
              {follow.length === 0 && <Text size="sm" c="dimmed" p="md">水揚げされた申告はまだありません</Text>}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

// 入札の単位に分ける（市場）：水揚げロットを、入札にかける箱・山ごとに分ける。
// 1件ごとに重さ・尾数（おおよそ）・銘柄・体長の目安。重さの合計は水揚げの重さまで（サーバーでも確かめる）
function SplitModal({ opened, onClose, item, items, busy, onSave }) {
  const done = item.children.map((id) => items[id]).filter(Boolean)
  const baseKg = item.custody.lastKg ?? item.kg
  const doneKg = done.reduce((n, k) => n + k.kg, 0)
  const restKg = Math.max(0, Math.round((baseKg - doneKg) * 10) / 10)
  // 次の番号（01, 02 …）
  const nextNo = done.reduce((m, k) => Math.max(m, Number(k.id.slice(-2)) || 0), 0) + 1
  const perKg = item.count && item.kg ? item.count / item.kg : null
  const countOf = (kg) => (perKg ? Math.max(1, Math.round(kg * perKg)) : 1)
  const row = (kg) => ({ kg, count: countOf(kg), grade: item.grade ?? GRADES[1], lengthCm: '' })
  const [rows, setRows] = useState(() => {
    const half = Math.round((restKg / 2) * 10) / 10
    return restKg > 0 ? [row(half), row(Math.round((restKg - half) * 10) / 10)] : [row(0)]
  })
  const [printAfter, setPrintAfter] = useState(true)
  const set = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v, ...(k === 'kg' ? { count: countOf(Number(v) || 0) } : {}) } : r)))
  const sum = Math.round(rows.reduce((n, r) => n + (Number(r.kg) || 0), 0) * 100) / 100
  const left = Math.round((restKg - sum) * 10) / 10
  const over = sum > restKg + 0.005
  const ok = rows.length > 0 && rows.every((r) => Number(r.kg) > 0 && Number(r.count) >= 1) && !over
  const idOf = (i) => `${item.id}-${String(nextNo + i).padStart(2, '0')}`
  return (
    <Sheet opened={opened} onClose={onClose} title="入札の単位に分ける">
      <Stack gap="lg">
        <InfoList rows={[['水揚げロット', `${item.name} ${baseKg} kg${item.count ? `・約${item.count}尾` : ''}`], ...(done.length ? [['分けた分', `${done.length}件・${doneKg.toFixed(1)} kg`]] : []), ['分けられる残り', `${restKg} kg`]]} />
        <Text size="sm" c="dimmed">箱・山ごとに分けると、それぞれに番号（QR）が付き、別々の買い手にせり・出荷できます。</Text>
        {rows.map((r, i) => (
          <Card key={i} padding="md" withBorder radius="lg">
            <Group justify="space-between" mb="xs">
              <Text fw={700} ff="monospace" size="sm">{idOf(i)}</Text>
              {rows.length > 1 && <ActionIcon variant="subtle" color="gray" aria-label="この行を消す" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><IconTrash size={18} /></ActionIcon>}
            </Group>
            <Stack gap="sm">
              <BigNumber label="重さ" value={r.kg} onChange={(v) => set(i, 'kg', v)} unit="kg" steps={[1, 10]} min={0} />
              <BigNumber label="尾数（おおよそ）" value={r.count} onChange={(v) => set(i, 'count', v)} unit="尾" steps={[1, 10]} min={1} decimals={0} />
              <div>
                <Text className="field-label">銘柄（サイズの区分）</Text>
                <SegmentedControl fullWidth data={GRADES} value={r.grade} onChange={(v) => set(i, 'grade', v)} />
              </div>
              <NumberInput label="体長（1尾の目安・入れなくてもよい）" suffix=" cm" min={0} max={999} allowDecimal={false} value={r.lengthCm} onChange={(v) => set(i, 'lengthCm', v)}
                styles={{ label: { fontSize: 14, fontWeight: 600, marginBottom: 8 } }} />
            </Stack>
          </Card>
        ))}
        <Button variant="light" leftSection={<IconPlus size={18} />} onClick={() => setRows((rs) => [...rs, row(Math.max(0, left))])}>箱・山を足す</Button>
        <Group justify="space-between">
          <Text size="sm" fw={700}>合計 {sum.toFixed(1)} kg（{rows.length}件）</Text>
          <Text size="sm" c={over ? 'red' : 'dimmed'} fw={over ? 700 : 400}>{over ? `水揚げの重さを ${(sum - restKg).toFixed(1)} kg 超えています` : `残り ${left.toFixed(1)} kg`}</Text>
        </Group>
        <Checkbox checked={printAfter} onChange={(e) => setPrintAfter(e.currentTarget.checked)} label="分けたあと、箱に貼るラベル（QR）を印刷する" />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button loading={busy} disabled={!ok} leftSection={<IconLayoutGrid size={18} />}
            onClick={() => onSave({ printAfter, lots: rows.map((r, i) => ({ itemId: idOf(i), weightKg: Number(r.kg), count: Math.trunc(Number(r.count)), grade: r.grade, lengthCm: Number(r.lengthCm) > 0 ? Math.round(Number(r.lengthCm)) : null })) })}>
            {rows.length}件に分ける
          </Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

// 引き渡す（せり結果・出荷）：渡す相手を選ぶ。重さは任意（入れると受け取り時に増減を確かめられる）
// 立場ごとに、次に渡すことが多い相手（一覧の上に並べる）
const NEXT_ROLES = { market: ['processor', 'exporter', 'retailer'], processor: ['retailer', 'exporter', 'processor'], retailer: ['retailer'], exporter: ['retailer'] }

function HandoverModal({ opened, onClose, item, businesses, myId, myRole, busy, onSave }) {
  // せり結果は市場の記録。ほかの事業者は出荷を最初に選んでおく
  const [kind, setKind] = useState(myRole === 'market' ? 'auction' : 'ship')
  const order = NEXT_ROLES[myRole] ?? []
  const rank = (b) => (order.includes(b.role) ? order.indexOf(b.role) : order.length)
  const others = businesses.filter((b) => b.id !== myId && b.role !== 'admin' && b.role !== 'vessel').sort((a, b) => rank(a) - rank(b))
  // 渡す相手は、間違えないよう最初は選ばない（選ぶまで「引き渡す」は押せない）
  const [toId, setToId] = useState(null)
  const [kg, setKg] = useState(item.custody.lastKg)
  const [detail, setDetail] = useState('')
  const roleName = { market: '市場', processor: '加工', retailer: '小売', exporter: '輸出' }
  return (
    <Sheet opened={opened} onClose={onClose} title="引き渡す">
      <Stack gap="lg">
        <Group gap="sm" wrap="nowrap" className="glass" p="sm" style={{ borderRadius: 16 }}>
          <ItemAvatar it={item} size={44} />
          <div style={{ minWidth: 0 }}><Text size="sm" fw={600}>{item.name}　{item.kg} kg</Text><Text size="xs" ff="monospace" c="dimmed" truncate>{item.id}</Text></div>
        </Group>
        {/* せり結果は市場だけが記録できる（ほかの事業者は出荷だけ） */}
        {myRole === 'market' && (
          <div>
            <Text className="field-label">記録の種類</Text>
            <SegmentedControl fullWidth value={kind} onChange={setKind} data={[{ value: 'auction', label: 'せり結果' }, { value: 'ship', label: '出荷' }]} />
          </div>
        )}
        <div>
          <Text className="field-label">渡す相手（買い受けた事業者）を選ぶ</Text>
          <Stack gap="xs">
            {others.map((b) => (
              <ChoiceCard key={b.id} checked={toId === b.id} onClick={() => setToId(b.id)}>
                <Group gap="sm" wrap="nowrap">
                  <Center w={36} h={36} style={{ borderRadius: 10, background: 'rgba(0, 113, 227, 0.1)', flexShrink: 0 }}><IconBuildingStore size={20} color="var(--apple-accent)" /></Center>
                  <div style={{ minWidth: 0 }}><Text fw={600} size="sm">{b.name}</Text><Text size="xs" c="dimmed">{roleName[b.role] ?? b.role}{b.address ? ` · ${b.address}` : ''}</Text></div>
                </Group>
              </ChoiceCard>
            ))}
          </Stack>
        </div>
        <BigNumber label="渡すときの重さ" value={kg} onChange={setKg} unit="kg" steps={kgInput(item).steps} min={0.1} decimals={kgInput(item).decimals} />
        <TextInput label="メモ（任意）" placeholder="例：買受番号 052、冷凍車で配送" value={detail} onChange={(e) => setDetail(e.currentTarget.value)} />
        <Text size="sm" c="dimmed">相手が受け取ると、持ち主が相手に移ります。受け取られるまで、この魚は加工・販売できません。</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button loading={busy} disabled={!toId} leftSection={<IconPackageExport size={18} />}
            onClick={() => onSave({ kind, toId, weightKg: Number(kg) || null, detail: detail || (kind === 'auction' ? 'せり結果' : '出荷') })}>{toId ? `${others.find((b) => b.id === toId)?.name} へ引き渡す` : '相手を選んでください'}</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

// 加工品をまとめて引き渡す：渡す加工品にチェックを付け、相手を選ぶ。個数と総重量を確かめてから記録する
// 一部をA店、残りをB店、と分けるときは2回に分けて行う
function BulkHandoverModal({ opened, onClose, item, items, businesses, myId, myRole, busy, onSave }) {
  const kids = item.children.map((id) => items[id])
  // 自分が持っていて、引き渡し中でないものだけ選べる（未ログインのときは全部）
  const ready = (k) => !myId || (k.custody.holder === myId && !k.custody.pending)
  const [picked, setPicked] = useState(() => new Set(kids.filter(ready).map((k) => k.id)))
  const order = NEXT_ROLES[myRole] ?? []
  const rank = (b) => (order.includes(b.role) ? order.indexOf(b.role) : order.length)
  const others = businesses.filter((b) => b.id !== myId && b.role !== 'admin' && b.role !== 'vessel').sort((a, b) => rank(a) - rank(b))
  const [toId, setToId] = useState(null)
  const [detail, setDetail] = useState('')
  const sel = kids.filter((k) => picked.has(k.id))
  const totalKg = sel.reduce((n, k) => n + k.kg, 0)
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const roleName = { market: '市場', processor: '加工', retailer: '小売', exporter: '輸出' }
  return (
    <Sheet opened={opened} onClose={onClose} title={`${kidWord(item, items).name}を引き渡す`}>
      <Stack gap="lg">
        <div>
          <Group justify="space-between" mb={8}>
            <Text className="field-label" mb={0}>渡す{kidWord(item, items).name}を選ぶ</Text>
            <Text size="sm" fw={700}>{sel.length}ロット{sel.reduce((n, k) => n + k.qty, 0) > sel.length ? `（${sel.reduce((n, k) => n + k.qty, 0)}パック）` : ''}・合計 {totalKg.toFixed(1)} kg</Text>
          </Group>
          <div className="inset-list glass">
            {kids.map((k) => {
              const ok = ready(k)
              return (
                <UnstyledButton key={k.id} className="list-row" data-active={picked.has(k.id) || undefined} disabled={!ok} onClick={() => ok && toggle(k.id)} style={{ opacity: ok ? 1 : 0.45 }}>
                  <Checkbox checked={picked.has(k.id)} readOnly tabIndex={-1} disabled={!ok} />
                  <ItemAvatar it={k} size={32} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={600} truncate>{k.name}　{k.kg} kg{lotLabel(k) && `（${lotLabel(k)}）`}</Text>
                    <Text size="xs" ff="monospace" c="dimmed" truncate>{k.id}</Text>
                  </div>
                  {!ok && <Text size="xs" c="dimmed">{k.custody.pending ? `${k.custody.pendingName}へ引き渡し中` : `持ち主：${k.custody.holderName}`}</Text>}
                </UnstyledButton>
              )
            })}
          </div>
        </div>
        <div>
          <Text className="field-label">渡す相手を選ぶ</Text>
          <Stack gap="xs">
            {others.map((b) => (
              <ChoiceCard key={b.id} checked={toId === b.id} onClick={() => setToId(b.id)}>
                <Group gap="sm" wrap="nowrap">
                  <Center w={36} h={36} style={{ borderRadius: 10, background: 'rgba(0, 113, 227, 0.1)', flexShrink: 0 }}><IconBuildingStore size={20} color="var(--apple-accent)" /></Center>
                  <div style={{ minWidth: 0 }}><Text fw={600} size="sm">{b.name}</Text><Text size="xs" c="dimmed">{roleName[b.role] ?? b.role}{b.address ? ` · ${b.address}` : ''}</Text></div>
                </Group>
              </ChoiceCard>
            ))}
          </Stack>
        </div>
        <TextInput label="メモ（任意）" placeholder="例：冷凍車で配送、伝票番号 123" value={detail} onChange={(e) => setDetail(e.currentTarget.value)} />
        <Text size="sm" c="dimmed">選んだ加工品の1つずつに、引き渡しの記録（それぞれの重さ付き）が残ります。一部を別の店に渡すときは、残りを選び直してもう一度行ってください。</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button loading={busy} disabled={!toId || sel.length === 0} leftSection={<IconPackageExport size={18} />}
            onClick={() => onSave({ ids: sel.map((k) => k.id), toId, totalKg, detail })}>
            {toId && sel.length ? `${sel.length}ロットを ${others.find((b) => b.id === toId)?.name} へ` : '加工品と相手を選んでください'}
          </Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

// 加工品をまとめて受け取る：受け取るロットを選び、量った総重量を入れる
// 各ロットの重さは、渡したときの重さに「量った総重量 ÷ 渡したときの総重量」を掛けて記録する（全体の増減が各ロットに出る）
function BulkReceiveModal({ opened, onClose, item, items, myId, myBiz, busy, onSave }) {
  const kids = item.children.map((id) => items[id]).filter((k) => k.custody.pending === myId)
  const [picked, setPicked] = useState(() => new Set(kids.map((k) => k.id)))
  const checks = useChecks({ items, it: item, myBiz, also: kids, from: kids[0] ? { id: kids[0].custody.holder, name: kids[0].custody.holderName } : null, enabled: opened })
  const [ack, setAck] = useState(false)
  const sel = kids.filter((k) => picked.has(k.id))
  const expected = sel.reduce((n, k) => n + k.custody.lastKg, 0)
  const [total, setTotal] = useState(Math.round(expected * 100) / 100)
  const [detail, setDetail] = useState('')
  const packs = sel.reduce((n, k) => n + labelCount(k), 0)
  const d = expected > 0 && Number(total) > 0 ? weightDrift({ prevKg: expected, kg: Number(total) }) : null
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const from = kids[0]?.custody.holderName
  return (
    <Sheet opened={opened} onClose={onClose} title={`${kidWord(item, items).name}を受け取る`}>
      <Stack gap="lg">
        <div>
          <Group justify="space-between" mb={8}>
            <Text className="field-label" mb={0}>{from} から届いた{kidWord(item, items).name}</Text>
            <Text size="sm" fw={700}>{sel.length}{kidWord(item, items).unit}{packs > sel.length ? `（${packs}パック）` : ''}・{expected.toFixed(1)} kg</Text>
          </Group>
          <div className="inset-list glass">
            {kids.map((k) => (
              <UnstyledButton key={k.id} className="list-row" data-active={picked.has(k.id) || undefined} onClick={() => toggle(k.id)}>
                <Checkbox checked={picked.has(k.id)} readOnly tabIndex={-1} />
                <ItemAvatar it={k} size={32} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text size="sm" fw={600} truncate>{k.name}　{k.custody.lastKg} kg{lotLabel(k) && `（${lotLabel(k)}）`}</Text>
                  <Text size="xs" ff="monospace" c="dimmed" truncate>{k.id}</Text>
                </div>
              </UnstyledButton>
            ))}
          </div>
        </div>
        <BigNumber label="量った総重量" value={total} onChange={setTotal} unit="kg" steps={[0.1, 1]} min={0.01} decimals={2} />
        {d && d.level !== 'ok' && (
          <Alert radius="md" color={d.level === 'gain' ? 'red' : 'yellow'} variant="light" icon={<IconAlertTriangle size={18} />}>
            {d.level === 'gain' ? `渡したときより ${(d.ratio * 100).toFixed(1)}% 重くなっています。別の魚が混ざっていないか確かめてください` : `渡したときより ${(-d.ratio * 100).toFixed(1)}% 軽くなっています。想定より大きく減っています`}（記録はできます）
          </Alert>
        )}
        <TextInput label="メモ（任意）" placeholder="例：冷凍庫Aに入庫" value={detail} onChange={(e) => setDetail(e.currentTarget.value)} />
        <ReceiveChecks checks={checks} ack={ack} setAck={setAck} />
        <GeoStatus opened={opened} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button loading={busy} disabled={sel.length === 0 || !(Number(total) > 0) || !canReceive(checks, ack)} leftSection={<IconPackageImport size={18} />}
            onClick={() => {
              const ratio = Number(total) / expected
              onSave({ rows: sel.map((k) => ({ id: k.id, kg: Math.round(k.custody.lastKg * ratio * 100) / 100 })), detail, checks: checksPayload(checks) })
            }}>{checks.loading ? '照合中…' : sel.length ? `${sel.length}${kidWord(item, items).unit}を受け取る` : '受け取るものを選んでください'}</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

// 加工品をまとめて販売を始める：売るロットを選び、売場での表示名を入れる
function BulkSellModal({ opened, onClose, item, items, myId, busy, onSave }) {
  const kids = item.children.map((id) => items[id]).filter((k) => k.custody.holder === myId && !k.custody.pending && !k.sold && k.children.length === 0)
  const [picked, setPicked] = useState(() => new Set(kids.map((k) => k.id)))
  const [displayName, setDisplayName] = useState(kids[0]?.name ?? item.name)
  const sel = kids.filter((k) => picked.has(k.id))
  const packs = sel.reduce((n, k) => n + k.qty, 0)
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <Sheet opened={opened} onClose={onClose} title="加工品の販売を始める">
      <Stack gap="lg">
        <div>
          <Group justify="space-between" mb={8}>
            <Text className="field-label" mb={0}>販売するロットを選ぶ</Text>
            <Text size="sm" fw={700}>{sel.length}ロット{packs > sel.length ? `（${packs}パック）` : ''}</Text>
          </Group>
          <div className="inset-list glass">
            {kids.map((k) => (
              <UnstyledButton key={k.id} className="list-row" data-active={picked.has(k.id) || undefined} onClick={() => toggle(k.id)}>
                <Checkbox checked={picked.has(k.id)} readOnly tabIndex={-1} />
                <ItemAvatar it={k} size={32} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text size="sm" fw={600} truncate>{k.name}　{k.kg} kg{lotLabel(k) && `（${lotLabel(k)}）`}</Text>
                  <Text size="xs" ff="monospace" c="dimmed" truncate>{k.id}</Text>
                </div>
              </UnstyledButton>
            ))}
          </div>
        </div>
        <TextInput label="売場での表示名" description={`値札やラベルに書く名前（元の魚種：${item.species}）`} value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
        <GeoStatus opened={opened} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button loading={busy} disabled={sel.length === 0 || !displayName} leftSection={<IconBuildingStore size={18} />}
            onClick={() => onSave({ ids: sel.map((k) => k.id), displayName })}>{sel.length ? `${sel.length}ロットの販売を始める` : 'ロットを選んでください'}</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

// 受け取る：重さを量って入れる。場所も記録する
function ReceiveModal({ opened, onClose, item, items, myBiz, busy, onSave }) {
  const [kg, setKg] = useState(item.custody.lastKg)
  const checks = useChecks({ items, it: item, myBiz, from: { id: item.custody.holder, name: item.custody.holderName }, enabled: opened })
  const [ack, setAck] = useState(false)
  const [detail, setDetail] = useState('')
  const d = Number(kg) > 0 && item.custody.lastKg ? weightDrift({ prevKg: item.custody.lastKg, kg: Number(kg) }) : null
  return (
    <Sheet opened={opened} onClose={onClose} title="受け取る">
      <Stack gap="lg">
        <Group gap="sm" wrap="nowrap" className="glass" p="sm" style={{ borderRadius: 16 }}>
          <ItemAvatar it={item} size={44} />
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={600}>{item.name}</Text>
            <Text size="xs" c="dimmed">{item.custody.holderName} から · 渡したときの重さ {item.custody.lastKg} kg</Text>
          </div>
        </Group>
        <BigNumber label="受け取った重さ" value={kg} onChange={setKg} unit="kg" steps={kgInput(item).steps} min={0.1} decimals={kgInput(item).decimals} />
        {d && d.level !== 'ok' && (
          <Alert radius="md" color={d.level === 'gain' ? 'red' : 'yellow'} variant="light" icon={<IconAlertTriangle size={18} />}>
            {d.level === 'gain' ? `渡したときより ${(d.ratio * 100).toFixed(1)}% 重くなっています。別の魚が混ざっていないか確かめてください` : `渡したときより ${(-d.ratio * 100).toFixed(1)}% 軽くなっています。想定より大きく減っています`}（記録はできます）
          </Alert>
        )}
        <TextInput label="メモ（任意）" placeholder="例：冷凍庫Aに入庫" value={detail} onChange={(e) => setDetail(e.currentTarget.value)} />
        <ReceiveChecks checks={checks} ack={ack} setAck={setAck} />
        <GeoStatus opened={opened} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button loading={busy} disabled={!canReceive(checks, ack)} leftSection={<IconPackageImport size={18} />}
            onClick={() => onSave({ weightKg: Number(kg) || null, detail, checks: checksPayload(checks) })}>{checks.loading ? '照合中…' : '受け取る'}</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

// 販売を始める：売場での表示名を選ぶ（元の魚種と違えば、あとで照合して警告する）
function SellModal({ opened, onClose, item, busy, onSave }) {
  const [displayName, setDisplayName] = useState(item.name)
  return (
    <Sheet opened={opened} onClose={onClose} title="販売を始める">
      <Stack gap="lg">
        <Group gap="sm" wrap="nowrap" className="glass" p="sm" style={{ borderRadius: 16 }}>
          <ItemAvatar it={item} size={44} />
          <div style={{ minWidth: 0 }}><Text size="sm" fw={600}>{item.name}　{item.kg} kg</Text><Text size="xs" c="dimmed">元の魚種：{item.species}</Text></div>
        </Group>
        <TextInput label="売場での表示名" description="値札やラベルに書く名前" value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
        <GeoStatus opened={opened} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button loading={busy} disabled={!displayName} leftSection={<IconBuildingStore size={18} />} onClick={() => onSave({ displayName })}>販売を始める</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

function AddInfoModal({ opened, onClose, item, busy, onSave }) {
  const [type, setType] = useState('storage')
  const [detail, setDetail] = useState('')
  const [photo, setPhoto] = useState(null)
  return (
    <Sheet opened={opened} onClose={onClose} title="情報を追記">
      <Stack>
        <Paper p="sm" radius="md" bg="gray.0"><Text size="sm" fw={600}>{item.name}</Text><Text size="xs" ff="monospace" c="dimmed">{item.id}</Text></Paper>
        <Select label="記録の種類" value={type} onChange={setType} allowDeselect={false}
          data={[{ value: 'storage', label: '冷凍・保管' }, { value: 'fix', label: '訂正（前の記録を正す）' }]} />
        <TextInput label="内容" placeholder="例：冷凍庫Bへ移動、−50℃" value={detail} onChange={(e) => setDetail(e.currentTarget.value)} />
        <PhotoPicker value={photo} onChange={setPhoto} />
        <Text size="sm" c="dimmed">保存すると、この記録は消せません。記録する事業者はログイン中の事業者になります。せり・出荷は「引き渡す」から記録します。</Text>
        <Group justify="flex-end" mt="sm"><Button variant="default" onClick={onClose}>やめる</Button><Button disabled={!detail} loading={busy} onClick={() => { onSave(type, detail, photo); setDetail(''); setPhoto(null) }}>追記する</Button></Group>
      </Stack>
    </Sheet>
  )
}

function ProcessModal({ opened, onClose, item, items, products, busy, onSave }) {
  const choices = products.filter((p) => p.species === item.species)
  const [productId, setProductId] = useState(choices[0]?.id ?? null)
  const [customName, setCustomName] = useState(`${item.name} 加工品`)
  // ロット＝同じ規格のパックのまとまり。例：ロイン 20kg × 1個 を 4ロット、柵 400g × 45パック を 1ロット
  const small = item.kind === 'prod'
  const parentKg = item.custody.lastKg ?? item.kg
  const issuedKg = item.children.reduce((a, c) => a + items[c].kg, 0)
  // 発行できる量 ＝ 元の重さ × 歩留まりの上限 − 発行済み（上限がなければ 元の重さ − 発行済み）
  const roomOf = (p) => Math.max(0, Math.floor((parentKg * (p?.yield_max != null ? Number(p.yield_max) : 1) - issuedKg) * 100 + 1e-6) / 100)
  // 最初の値は、発行できる量に収まるようにする
  const defaultsFor = (p) => {
    const room = roomOf(p)
    if (small) {
      const per = Math.max(1, Math.min(10, Math.floor(room / 0.4 + 1e-9)))
      return { unit: 0.4, perLot: per, lotCount: 1 }
    }
    const u = room >= 20 ? 20 : Math.max(0.1, Math.floor(room * 10) / 10)
    return { unit: u, perLot: 1, lotCount: Math.max(1, Math.min(4, Math.floor(room / u + 1e-9))) }
  }
  const init = defaultsFor(choices[0])
  const [unit, setUnit] = useState(init.unit)
  const [perLot, setPerLot] = useState(init.perLot)
  const [lotCount, setLotCount] = useState(init.lotCount)
  const [photo, setPhoto] = useState(null)
  const [printAfter, setPrintAfter] = useState(true)
  const product = choices.find((p) => p.id === productId)
  const room = roomOf(product)
  const pickProduct = (p) => {
    setProductId(p.id)
    const d = defaultsFor(p)
    setUnit(d.unit); setPerLot(d.perLot); setLotCount(d.lotCount)
  }
  const n = Number(lotCount) || 0
  const q = Math.max(1, Math.trunc(Number(perLot) || 1))
  const u = Number(unit) || 0
  const lotKg = Math.round(q * u * 100) / 100
  const weights = Array.from({ length: n }, () => lotKg)
  const check = checkWeight({
    parentKg, childrenKg: item.children.map((c) => items[c].kg), newKg: weights,
    yieldMin: product?.yield_min != null ? Number(product.yield_min) : null, yieldMax: product?.yield_max != null ? Number(product.yield_max) : null,
  })
  const ids = childIds(item.id, item.kind === 'ind', item.children.length, n)
  const name = product?.name ?? customName
  const pct = Math.min(100, check.ratio * 100)
  return (
    <Sheet opened={opened} onClose={onClose} title="加工して子IDを発行">
      <Stack gap="lg">
        <Group gap="sm" wrap="nowrap" className="glass" p="sm" style={{ borderRadius: 16 }}>
          <ItemAvatar it={item} size={44} />
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={600}>{item.name}　{item.kg} kg</Text>
            <Text size="xs" ff="monospace" c="dimmed" truncate>{item.id}（登録済みの子 {item.children.length}件）</Text>
          </div>
        </Group>
        <div>
          <Text className="field-label">加工品</Text>
          {choices.length > 0
            ? (
              <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
                {choices.map((p) => (
                  <ChoiceCard key={p.id} checked={productId === p.id} onClick={() => pickProduct(p)}>
                    <Text fw={600} size="sm" pr={24}>{p.name}</Text>
                    <Text size="xs" c="dimmed">{[p.storage, p.yield_min != null && `歩留まり ${Math.round(p.yield_min * 100)}〜${Math.round(p.yield_max * 100)}%`].filter(Boolean).join(' · ') || '—'}</Text>
                  </ChoiceCard>
                ))}
              </SimpleGrid>
            )
            : <TextInput value={customName} onChange={(e) => setCustomName(e.currentTarget.value)} aria-label="加工品の名前" />}
        </div>
        <BigNumber label="1パック（1個）の重さ" value={unit} onChange={setUnit} unit="kg" steps={u < 1 ? [0.05, 0.1] : [1, 5]} min={0.01} decimals={u < 1 ? 3 : 1} />
        <BigNumber label="1ロットのパック数" value={perLot} onChange={setPerLot} unit="パック" steps={[1, 10]} min={1} decimals={0} />
        <BigNumber label="ロットの数（発行するID）" value={lotCount} onChange={setLotCount} unit="ロット" steps={[1, 10]} min={1} decimals={0} />
        <Text size="sm" fw={600}>{n}ロット × {q}パック × {gram(u)} ＝ 合計 {check.total.toFixed(1)} kg（1ロット {lotKg} kg）</Text>
        {/* 親の重量に対して、子の合計がどれだけか */}
        <div>
          {room <= 0 && <Alert radius="md" color="red" variant="light" icon={<IconAlertTriangle size={18} />} mb="sm">残りが足りません（発行済み {issuedKg.toFixed(1)} kg）</Alert>}
          <Group justify="space-between" mb={6}><Text size="sm" c="dimmed">合計 {check.total.toFixed(1)} kg ／ 親 {parentKg} kg（発行できる残り {room.toFixed(1)} kg）</Text><Text size="sm" fw={700} c={check.ok ? undefined : 'red'}>{(check.ratio * 100).toFixed(0)}%</Text></Group>
          <Box h={10} style={{ borderRadius: 99, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <Box h="100%" w={`${pct}%`} style={{ borderRadius: 99, background: check.ok ? 'linear-gradient(90deg, var(--mantine-primary-color-filled), var(--mantine-primary-color-4))' : 'var(--apple-red)', transition: 'width 250ms var(--ease-apple)' }} />
          </Box>
        </div>
        {check.issues.map((i) => (
          <Alert key={i.message} radius="md" color={i.level === 'error' ? 'red' : i.level === 'warning' ? 'yellow' : undefined} variant="light" icon={<IconAlertTriangle size={18} />}>{i.message}</Alert>
        ))}
        <PhotoPicker value={photo} onChange={setPhoto} label="加工品の写真" hint="撮らなくても、水揚げ時の写真が消費者の画面に出ます" />
        <Checkbox checked={printAfter} onChange={(e) => setPrintAfter(e.currentTarget.checked)} size="md"
          label={`発行したらラベルを印刷する（${n}ロット × ${q}パック ＝ ${n * q}枚）`} />
        <Text size="sm" c="dimmed">ロットごとに子ID（{ids[0]} …）を発行し、すべてに親IDを持たせます。パックのQRは「ロットのID＋連番」で、どのパックからも元の水揚げ（1尾、または水揚げロット）までたどれます。魚種・漁船・海域などは親から自動で引き継ぎます。</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button leftSection={<IconCut size={18} />} loading={busy} disabled={!check.ok || n < 1 || !name || !(u > 0)}
            onClick={() => onSave({ childIds: ids, productId: product?.id ?? null, name, lots: ids.map((id) => ({ id, quantity: q, unitKg: u })), photo, printAfter })}>{n}ロットを発行</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

function RegisterModal({ opened, onClose, busy, items, ships, declarations = [], onSave }) {
  const [shipId, setShipId] = useState(null)
  // 漁船の申告：まだ水揚げに使っていないもの。選ぶと魚種・船・海域・漁獲期間は申告のまま（変えられない）
  const usedDecl = new Set(Object.values(items).map((x) => x.info.declaration?.id).filter(Boolean))
  const openDecls = declarations.filter((d) => !usedDecl.has(d.id))
  const [declId, setDeclId] = useState(null)
  const decl = openDecls.find((d) => d.id === declId) ?? null
  const [species, setSpecies] = useState(SPECIES[0].name)
  const [area, setArea] = useState(AREAS[0])
  const [port, setPort] = useState(PORTS[0])
  // 漁獲期間（申告）：船の位置の記録（AIS）と照らし合わせるので日付で入れる。最初は水揚げ日の 30 日前〜前日
  const [catchFrom, setCatchFrom] = useState(ymd(new Date(Date.now() - 30 * 86400000)))
  const [catchTo, setCatchTo] = useState(ymd(new Date(Date.now() - 86400000)))
  const [kg, setKg] = useState(SPECIES[0].kg)
  const [count, setCount] = useState(1)
  const [lengthCm, setLengthCm] = useState('') // 体長（任意）。入れると消費者の画面に魚の立体が出る
  const [grade, setGrade] = useState(GRADES[1])
  const [photo, setPhoto] = useState(null)
  const sp = SPECIES.find((x) => x.name === species)
  const pickSpecies = (x) => { setSpecies(x.name); setKg(x.kg); setCount(x.count ?? 1) }
  const pickDecl = (d) => {
    setDeclId(d?.id ?? null)
    if (!d) return
    const x = SPECIES.find((y) => y.name === d.species)
    if (x) { setSpecies(x.name); setKg(d.payload?.est_kg ?? x.kg); setCount(d.payload?.est_count ?? x.count ?? 1) }
    setShipId(d.ship_id); setArea(d.catch_area); setCatchFrom(d.catch_from); setCatchTo(d.catch_to)
  }
  const ship = ships.find((s) => s.id === (shipId ?? ships[0]?.id))
  // 水揚げ日（登録が水揚げの翌日以降になることもあるので選べる。時刻は朝 6 時として記録）
  const [day, setDay] = useState(ymd(new Date()))
  const landedAt = new Date(`${day}T06:00:00+09:00`).toISOString()
  const periodOk = catchFrom <= catchTo && catchTo <= day
  // ID：KSN-魚種コード-水揚げ日(YYMMDD)-連番（1尾ずつも水揚げロットも同じ形）
  const prefix = `KSN-${sp.code}-${day.replaceAll('-', '').slice(2)}-`
  // 連番は空いているものを探す（チェーンにすでにあるIDも飛ばす）。チェーンに聞けないときは DB だけで決める
  const known = Object.keys(items).filter((id) => id.startsWith(prefix)).sort().join(' ')
  const [itemId, setItemId] = useState(null)
  useEffect(() => {
    if (!opened) return
    let alive = true
    const ids = known ? known.split(' ') : []
    setItemId(null)
    nextLandingId(prefix, ids)
      .catch(() => { let seq = 1; while (ids.includes(prefix + String(seq).padStart(3, '0'))) seq++; return prefix + String(seq).padStart(3, '0') })
      .then((id) => alive && setItemId(id))
    return () => { alive = false }
  }, [opened, prefix, known])
  const speciesCards = (lot) => (
    <SimpleGrid cols={{ base: 2, xs: lot ? 4 : 2 }} spacing="sm">
      {SPECIES.filter((x) => x.lot === lot).map((x) => (
        <ChoiceCard key={x.name} checked={species === x.name} onClick={() => pickSpecies(x)}>
          <Stack align="center" gap={6}>
            <ItemAvatar it={{ kind: 'ind', species: x.name }} size={40} />
            <Text fw={600} fz={13} style={{ whiteSpace: 'nowrap' }}>{x.name}</Text>
            <Text size="xs" c="dimmed" ff="monospace">{x.code}</Text>
          </Stack>
        </ChoiceCard>
      ))}
    </SimpleGrid>
  )
  return (
    <Sheet opened={opened} onClose={onClose} title="水揚げを登録">
      <Stack gap="lg">
        {openDecls.length > 0 && (
          <div>
            <Text className="field-label">漁船の申告（{openDecls.length}件）</Text>
            <Stack gap="xs">
              {openDecls.map((d) => (
                <ChoiceCard key={d.id} checked={declId === d.id} onClick={() => pickDecl(d)}>
                  <Text fw={600} size="sm" pr={24}>{d.payload?.ship?.name ?? '—'}・{d.species}・{d.catch_area}</Text>
                  <Text size="xs" c="dimmed">{d.catch_from}〜{d.catch_to} · {mdhm(d.created_at)} 申告 · <span style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{d.id}</span></Text>
                </ChoiceCard>
              ))}
              <ChoiceCard checked={!declId} onClick={() => pickDecl(null)}><Text fw={600} size="sm">申告なしで登録</Text></ChoiceCard>
            </Stack>
          </div>
        )}
        {decl && <InfoList rows={[['魚種', decl.species], ['漁船', decl.payload?.ship?.name ?? '—'], ['漁獲海域', decl.catch_area], ['漁獲期間', `${decl.catch_from}〜${decl.catch_to}`], ['申告', `${mdhm(decl.created_at)}（漁船の鍵で署名）`]]} />}
        {!decl && <>
        <div>
          <Text className="field-label">魚種</Text>
          <Text size="xs" c="dimmed" mb={6}>1尾ずつ管理する魚（マグロ）</Text>
          {speciesCards(false)}
          <Text size="xs" c="dimmed" mt="sm" mb={6}>まとめて管理する魚（船・水揚げ日・銘柄ごとに1つのID）</Text>
          {speciesCards(true)}
        </div>
        <div>
          <Text className="field-label">漁船</Text>
          <Stack gap="xs">
            {ships.map((s) => (
              <ChoiceCard key={s.id} checked={ship?.id === s.id} onClick={() => setShipId(s.id)}>
                <Group gap="sm" wrap="nowrap">
                  <Center w={36} h={36} style={{ borderRadius: 10, background: 'rgba(0, 113, 227, 0.1)', flexShrink: 0 }}><IconSailboat size={20} color="var(--apple-accent)" /></Center>
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600} size="sm">{s.name}</Text>
                    <Text size="xs" c="dimmed">{s.gear} · 登録番号 {s.reg_no} · 許可番号 {s.permit_no ?? '—'}</Text>
                  </div>
                </Group>
              </ChoiceCard>
            ))}
          </Stack>
          <Text size="xs" c="dimmed" mt={6}><IconDatabase size={12} style={{ verticalAlign: -1 }} /> 登録番号・許可番号・漁法は船マスタから自動で入ります</Text>
        </div>
        <div>
          <Text className="field-label">漁獲海域</Text>
          <SegmentedControl fullWidth data={AREAS} value={area} onChange={setArea} orientation="vertical" />
        </div>
        </>}
        <TextInput type="date" label="水揚げ日" value={day} max={ymd(new Date())} onChange={(e) => e.currentTarget.value && setDay(e.currentTarget.value)}
          styles={{ label: { fontSize: 14, fontWeight: 600, marginBottom: 8 } }} />
        <div>
          <Text className="field-label">水揚げ港</Text>
          <SegmentedControl fullWidth data={PORTS} value={port} onChange={setPort} />
          {port !== PORTS[0] && <Text size="xs" c="dimmed" mt={6}>海外で水揚げし、冷凍で気仙沼へ運ぶ場合。消費者の地図にも水揚げした港が出ます</Text>}
        </div>
        {sp.lot && (
          <div>
            <Text className="field-label">銘柄（サイズの区分）</Text>
            <SegmentedControl fullWidth data={GRADES} value={grade} onChange={setGrade} />
            <Text size="xs" c="dimmed" mt={6}>船・水揚げ日・銘柄ごとに1つのIDにします。入札のときに、箱・山ごとに分けられます</Text>
          </div>
        )}
        {sp.lot && <BigNumber label="尾数（おおよそ）" value={count} onChange={setCount} unit="尾" steps={[1, 10]} min={1} decimals={0} />}
        <BigNumber label={sp.lot ? '重量（合計）' : '重量'} value={kg} onChange={setKg} unit="kg" steps={sp.lot ? [10, 100] : [1, 10]} min={0.1} />
        <div>
          <BigNumber label={sp.lot ? '体長（1尾の目安・入れなくてもよい）' : '体長（入れなくてもよい）'} value={lengthCm} onChange={setLengthCm} unit="cm" steps={[1, 10]} min={0} decimals={0} />
          <Text size="xs" c="dimmed" mt={6}>{sp.lot ? '入れると、消費者の画面に平均的な1尾の立体が、人と並んで出ます' : '入れると、消費者の画面にこの魚の立体（実際の大きさを人と比べたもの）が出ます'}</Text>
        </div>
        {!decl && <div>
          <Text className="field-label">漁獲期間</Text>
          <SimpleGrid cols={2} spacing="xs">
            <TextInput type="date" label="始まり" value={catchFrom} max={day} onChange={(e) => e.currentTarget.value && setCatchFrom(e.currentTarget.value)} />
            <TextInput type="date" label="終わり" value={catchTo} max={day} onChange={(e) => e.currentTarget.value && setCatchTo(e.currentTarget.value)} />
          </SimpleGrid>
          <Text size="xs" c={periodOk ? 'dimmed' : 'red'} mt={6}>
            {periodOk ? 'この期間に、申告した海域で漁をしていたかを、船の位置の記録と照らし合わせます' : '漁獲期間は「始まり ≦ 終わり ≦ 水揚げ日」にしてください'}
          </Text>
        </div>}
        {decl && !periodOk && <Text size="sm" c="red">水揚げ日が、申告した漁獲期間の終わりより前です</Text>}
        <PhotoPicker value={photo} onChange={setPhoto} label="水揚げ時の写真"
          hint={sp.lot ? '消費者の画面に「水揚げ時の様子」として大きく出ます。加工品にも引き継がれます' : '消費者の画面に「元の1尾」として大きく出ます。加工品にも引き継がれます'} />
        {itemId
          ? <LabelPreview itemId={itemId} species={sp.lot ? `${species}（${grade}・約${Number(count) || 0}尾）` : species} kg={kg} shipName={ship?.name} port={port} />
          : <Group gap="xs"><Loader size="xs" /><Text size="sm" c="dimmed">番号を確かめています…</Text></Group>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button loading={busy} disabled={!ship || !itemId || !periodOk || !(Number(kg) > 0) || (sp.lot && !(Number(count) >= 1))} leftSection={<IconTag size={18} />}
            onClick={() => onSave({ itemId, species, lot: sp.lot, grade, count: Math.trunc(Number(count)), weightKg: Number(kg), shipId: ship.id, catchArea: area, landingPort: port, catchFrom, catchTo, landedAt, photo, declarationId: decl?.id ?? null, lengthCm: Number(lengthCm) > 0 ? Math.round(Number(lengthCm)) : null })}>
            {sp.lot ? '水揚げロットのIDを発行' : '個体IDを発行'}
          </Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

// QR読み取り（スマホのカメラ）。カメラが使えないときはIDを手で入れる
function ScanModal({ opened, onClose, onFound }) {
  const [manual, setManual] = useState('')
  const [camErr, setCamErr] = useState(null)
  const toId = (text) => { try { return new URL(text).searchParams.get('id') ?? text } catch { return text } }
  useEffect(() => {
    if (!opened) return
    setCamErr(null)
    let scanner, stopped = false
    const t = setTimeout(() => {
      scanner = new Html5Qrcode('qr-reader')
      scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, (text) => {
        if (stopped) return
        stopped = true
        scanner.stop().catch(() => {})
        onFound(toId(text).trim())
      }).catch((e) => setCamErr(String(e)))
    }, 300) // シートが開いてから始める
    return () => { clearTimeout(t); if (scanner?.isScanning) scanner.stop().catch(() => {}) }
  }, [opened])
  return (
    <Sheet opened={opened} onClose={onClose} title="QRを読んで開く">
      <Stack>
        <Box id="qr-reader" style={{ minHeight: camErr ? 0 : 260, borderRadius: 18, overflow: 'hidden', background: camErr ? undefined : '#000' }} />
        {camErr && <Text size="sm" c="dimmed">カメラを使えませんでした。IDを入力してください。</Text>}
        <Group align="flex-end">
          <TextInput style={{ flex: 1 }} label="IDを入力" placeholder="KSN-SWO-261003-001" value={manual} onChange={(e) => setManual(e.currentTarget.value)} />
          <Button disabled={!manual} onClick={() => onFound(toId(manual).trim().toUpperCase())}>開く</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

// ログイン画面（管理画面はログインした事業者だけが開ける。QRから開く消費者画面はログイン不要）
function LoginPage() {
  const isMobile = useIsMobile()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e?.preventDefault()
    setBusy(true)
    try { await signIn(email, password) } catch (err) { errMsg(err) } finally { setBusy(false) }
  }
  return (
    <div className="login-page">
      <div className="mgr-hero-glow" aria-hidden />
      <form className="login-card fadein" onSubmit={submit}>
        <Center mx="auto"><LogoTile size={56} /></Center>
        <Group gap={8} justify="center" align="baseline" mt="md">
          <Title order={1} className="headline" fz={isMobile ? 30 : 34} style={{ letterSpacing: '0.04em' }}>{BRAND.ja}</Title>
          <Text fw={600} size="sm" c="dimmed" style={{ letterSpacing: '0.14em' }}>{BRAND.en}</Text>
        </Group>
        <Text ta="center" size="sm" c="dimmed" mt={4} mb="xl">気仙沼で獲れた1尾ごとの戸籍。事業者の方はログインしてください</Text>
        <Stack gap="md">
          <TextInput label="メールアドレス" variant="default" radius="md" value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoComplete="username" type="email" required />
          <PasswordInput label="パスワード" variant="default" radius="md" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" required />
          <Button type="submit" fullWidth size="lg" mt="sm" loading={busy} disabled={!email || !password} leftSection={<IconLogin size={18} />}>ログイン</Button>
        </Stack>
        <Text ta="center" size="xs" c="dimmed" mt="xl">消費者の方は、商品のラベルの QR を読むと履歴を見られます（ログインは不要です）</Text>
      </form>
    </div>
  )
}

function LoginModal({ opened, onClose }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try { await signIn(email, password); setPassword(''); onClose() } catch (e) { errMsg(e) } finally { setBusy(false) }
  }
  return (
    <Sheet opened={opened} onClose={onClose} title="事業者としてログイン">
      <Stack>
        <Text size="sm" c="dimmed">記録するにはログインが必要です。消費者の画面はログインなしで見られます。</Text>
        <TextInput label="メールアドレス" value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoComplete="username" />
        <PasswordInput label="パスワード" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <Group justify="flex-end" mt="sm"><Button variant="default" onClick={onClose}>やめる</Button><Button loading={busy} disabled={!email || !password} onClick={submit}>ログイン</Button></Group>
      </Stack>
    </Sheet>
  )
}

// ---- 全体 ----

// 画面の中でエラーが起きても、ヘッダーやタブは残して別の画面へ移れるようにする
class ViewBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('画面のエラー', error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <Alert color="red" radius="lg" icon={<IconAlertTriangle />} title="この画面を表示できませんでした" maw={720} mx="auto" mt="xl">
        {String(this.state.error?.message ?? this.state.error)}
      </Alert>
    )
  }
}

function TabBar({ view, pane, onList, onRegister, onScan, onConsumer }) {
  const tabs = [
    { key: 'list', label: '一覧', icon: IconList, active: view === 'manage', onClick: onList },
    { key: 'add', label: '登録', icon: IconPlus, onClick: onRegister },
    { key: 'scan', label: 'QR', icon: IconQrcode, onClick: onScan },
    { key: 'consumer', label: '消費者', icon: IconUserSearch, active: view === 'consumer', onClick: onConsumer },
  ]
  return (
    <Group gap={0} h="100%" className="tabbar" align="flex-start">
      {tabs.map((t) => (
        <UnstyledButton key={t.key} className="tabbar-btn" data-active={t.active || undefined} onClick={t.onClick}>
          <t.icon size={24} stroke={1.6} /><Text size="10px" fw={500}>{t.label}</Text>
        </UnstyledButton>
      ))}
    </Group>
  )
}

function App() {
  const [look, setLook] = useLook()
  // QRから開いたときの ID。ログインした事業者が自分の見える範囲の魚を読んだら、管理画面の詳細を開いて消す
  const [qid, setQid] = useState(() => new URLSearchParams(location.search).get('id'))
  const isMobile = useIsMobile()
  const [db, setDb] = useState(null)
  const [trace, setTrace] = useState(null) // 消費者として読んだとき：'ok' | 'inactive' | 'missing' | 'erased'
  const [erased, setErased] = useState(null) // 'erased' のとき：チェーンに残っている発行の記録
  const [loadErr, setLoadErr] = useState(null)
  const [me, setMe] = useState(null)
  const [authChecked, setAuthChecked] = useState(false) // ログイン状態を確かめ終えたか
  const [loginOpen, setLoginOpen] = useState(false)
  // 管理画面で開いている記録は URL（?item=）にも残す。デモ中に読み直しても同じ記録が開き、特定の魚へのリンクも作れる
  const urlItem = new URLSearchParams(location.search).get('item')
  const [sel, setSel] = useState(qid ?? urlItem)
  const [view, setView] = useState(qid ? 'consumer' : 'manage')
  const [pane, setPane] = useState(urlItem && !qid ? 'detail' : 'list') // スマホの管理画面：一覧 or 詳細
  const [modal, setModal] = useState(null) // 'register' | 'add' | 'process' | 'scan'
  // QRから来た消費者・ログインしていない人には、管理用の切り替えを見せない
  const showNav = !qid && !!me

  // 事業者（ログイン）：見える範囲を読む。QR の ID がその中にあれば管理画面の詳細を開く
  // 消費者（または見える範囲にない ID）：その ID 1件分だけ読む（販売開始前なら何も返らない）
  const reload = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const all = await fetchAll()
        if (!qid || all.items.some((r) => r.id === qid)) {
          setDb(all); setTrace(null); setLoadErr(null)
          if (qid) {
            setSel(qid); setView('manage'); setPane('detail')
            history.replaceState(null, '', location.pathname)
            setQid(null)
          }
          return
        }
      }
      if (!qid) return setDb(null)
      const r = await fetchTrace(qid)
      setTrace(r.status); setErased(r.erased ?? null); setDb(r.db ?? null); setLoadErr(null)
    } catch (e) { setLoadErr(e.message ?? String(e)) }
  }, [qid])
  // ログイン状態が分かってから読む（ログイン・ログアウトしたら読み直す）
  useEffect(() => { if (authChecked) reload() }, [authChecked, me?.business?.id, qid])
  useEffect(() => {
    fetchMe().then((m) => { setMe(m); setAuthChecked(true) })
    // コールバックの中で Supabase を呼ぶと詰まることがあるので、次の処理に回す
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => setTimeout(() => fetchMe().then((m) => { setMe(m); setAuthChecked(true) }), 0))
    return () => subscription.unsubscribe()
  }, [])
  const items = useMemo(() => (db ? buildItems(db) : null), [db])
  useEffect(() => {
    if (qid || !authChecked || (me && view !== 'manage')) return
    const u = new URL(location.href)
    // ログアウトしたら消す（次にログインした人に前の記録を開かせない）
    if (sel && me) u.searchParams.set('item', sel); else u.searchParams.delete('item')
    history.replaceState(null, '', u)
  }, [sel, qid, me, view, authChecked])
  // ログアウトしたら管理画面に戻す（消費者画面の切り替えもログインした人だけ）
  useEffect(() => { if (authChecked && !me && !qid) setView('manage') }, [authChecked, me])

  // 記録する操作の前にログインと所属を確かめる
  const guard = (fn) => {
    if (!me) return setLoginOpen(true)
    if (!me.business) return notifications.show({ color: 'red', title: '事業者に所属していません', message: `${me.email} は members に登録されていません` })
    fn()
  }
  const onScanned = (id) => {
    if (!items?.[id]) return notifications.show({ color: 'red', message: `ID ${id} は見つかりません（登録されていないか、あなたの事業者が扱っていない魚です）` })
    setModal(null); setSel(id); setPane('detail')
    notifications.show({ message: `QRを読み取りました：${items[id].name}` })
  }

  const account = me
    ? (
      <Menu position="bottom-end" radius="md" shadow="md">
        <Menu.Target>
          {isMobile
            ? <ActionIcon variant="subtle" radius="xl" size="lg" aria-label="アカウント"><IconUserCircle size={26} /></ActionIcon>
            : <Button variant="white" size="sm" leftSection={<IconUserCircle size={18} />}>{me.business?.name ?? me.email}</Button>}
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{me.business?.name ?? '所属なし'}</Menu.Label>
          <Menu.Item closeMenuOnClick={false} onClick={() => setLook(look === 'sea' ? 'classic' : 'sea')}
            leftSection={<span className="look-dot" data-look={look === 'sea' ? 'classic' : 'sea'} />}>{look === 'sea' ? '画面の色：黒にする' : '画面の色：海にする'}</Menu.Item>
          <Menu.Item leftSection={<IconLogout size={16} />} onClick={signOut}>ログアウト</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    )
    : isMobile
      ? <ActionIcon variant="subtle" radius="xl" size="lg" onClick={() => setLoginOpen(true)} aria-label="ログイン"><IconLogin size={22} /></ActionIcon>
      : <Button variant="white" size="sm" leftSection={<IconLogin size={16} />} onClick={() => setLoginOpen(true)}>ログイン</Button>

  // ログイン状態を確かめ終えるまで待つ。QRから来た消費者以外は、ログインしていなければログイン画面
  if (!authChecked && !qid) return <Center mih="100dvh" bg="#09142c"><Loader color="white" /></Center>
  if (!qid && !me) return <LoginPage />
  // 消費者として読んだが、まだ販売前・ID がない
  const notice = qid && trace && trace !== 'ok' ? trace : null

  return (
    <AppShell className={view === 'consumer' ? 'dark-shell' : 'navy-shell'} header={{ height: isMobile ? 56 : 64 }} footer={{ height: 64, collapsed: !(isMobile && showNav) }}
      padding={0}>
      <AppShell.Header className="glass-nav" px={isMobile ? 'md' : 'xl'}>
        <Group h="100%" justify="space-between" wrap="nowrap" maw={1280} mx="auto">
          <Group gap={10} wrap="nowrap">
            <LogoTile size={32} />
            <Group gap={6} align="baseline" wrap="nowrap">
              <Text fw={700} size="md" className="brand" style={{ letterSpacing: '0.04em' }}>{BRAND.ja}</Text>
              <Text fw={600} size="xs" className="brand brand-en" style={{ letterSpacing: '0.12em' }}>{BRAND.en}</Text>
            </Group>
          </Group>
          <Group gap="sm" wrap="nowrap">
            {!isMobile && showNav && (
              <SegmentedControl value={view} onChange={setView} size="sm"
                data={[{ value: 'manage', label: <Group gap={6} wrap="nowrap"><IconDatabase size={16} /><span>ID管理</span></Group> },
                  { value: 'consumer', label: <Group gap={6} wrap="nowrap"><IconUserSearch size={16} /><span>消費者が見る画面</span></Group> }]} />
            )}
            {view === 'manage' && !qid && account}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main style={{ background: 'transparent' }}>
        {loadErr ? <Alert color="red" radius="lg" icon={<IconAlertTriangle />} title="データを読み込めませんでした" maw={720} mx="auto" mt="xl">{loadErr}</Alert>
          : notice ? <ConsumerNotice status={notice} erased={erased} />
          : !items ? <Center mih={300}><Loader /></Center>
          : view === 'manage'
            ? (me?.business?.role === 'vessel'
              ? <VesselPage me={me} db={db} reload={reload} />
              : <Manager items={items} db={db} sel={sel} setSel={setSel} reload={reload} guard={guard} modal={modal} setModal={setModal} pane={pane} setPane={setPane} me={me} />)
            : <ViewBoundary key={view}><ConsumerView items={items} sel={sel} setSel={setSel} demo={showNav} /></ViewBoundary>}
        {!chainEnabled && view === 'manage' && items && (
          <Text size="xs" c="dimmed" ta="center" pb="xl" px="md">ブロックチェーン未接続（記録とハッシュはDBに保存しています）</Text>
        )}
      </AppShell.Main>

      <AppShell.Footer className="glass-tabbar">
        <TabBar view={view} pane={pane}
          onList={() => { setView('manage'); setPane('list') }}
          onRegister={() => {
            setView('manage')
            if (me?.business && me.business.role !== 'market') return notifications.show({ color: 'yellow', message: '水揚げの登録は市場だけができます' })
            guard(() => setModal('register'))
          }}
          onScan={() => { setView('manage'); setModal('scan') }}
          onConsumer={() => setView('consumer')} />
      </AppShell.Footer>

      <ScanModal opened={modal === 'scan'} onClose={() => setModal(null)} onFound={onScanned} />
      <LoginModal opened={loginOpen} onClose={() => setLoginOpen(false)} />
    </AppShell>
  )
}

// 見た目（look）に合わせて主の色を切り替える
function Themed() {
  const [look] = useLook()
  const t = useMemo(() => ({ ...theme, primaryColor: look === 'sea' ? 'sea' : 'apple' }), [look])
  return (
    <MantineProvider theme={t}>
      <Notifications position="top-center" />
      <App />
    </MantineProvider>
  )
}

createRoot(document.getElementById('root')).render(
  <Themed />
)
