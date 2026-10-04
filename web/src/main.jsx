import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './styles.css'
import {
  MantineProvider, createTheme, AppShell, Group, Stack, Text, Title, Button, SegmentedControl, ActionIcon, Menu,
  Paper, Badge, Timeline, TextInput, PasswordInput, NumberInput, Select, Modal, Alert,
  SimpleGrid, Card, Box, ScrollArea, Code, Center, UnstyledButton, Anchor, Loader, ThemeIcon,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { Notifications, notifications } from '@mantine/notifications'
import {
  IconFish, IconSearch, IconPlus, IconCut, IconQrcode, IconShieldCheck, IconSailboat, IconAnchor, IconGavel,
  IconPackage, IconTruck, IconSnowflake, IconPencil, IconCornerDownRight, IconUserSearch, IconDatabase,
  IconAlertTriangle, IconTag, IconLogin, IconLogout, IconLink, IconChevronRight, IconChevronLeft, IconUserCircle,
  IconList, IconCircleCheckFilled, IconLock, IconCamera,
} from '@tabler/icons-react'
import { QRCodeSVG } from 'qrcode.react'
import { Html5Qrcode } from 'html5-qrcode'
import {
  supabase, chainEnabled, signIn, signOut, fetchMe, fetchAll,
  registerIndividual, appendEvent, processItem, activateQr, explorerTx,
} from './api.js'
import { checkWeight, childIds } from './lib/rules.js'
import { compressImage } from './lib/photo.js'
import { ymd, shortHash, buildItems, ancestors, rootOf, useVerify } from './model.js'
import { ConsumerView } from './consumer.jsx'

// Apple Blue を中心にした色の段階（Mantine は10段階で持つ）
const theme = createTheme({
  primaryColor: 'apple',
  colors: { apple: ['#e5f1fc', '#cce3f9', '#99c6f3', '#66aaee', '#338de8', '#0071e3', '#0066cc', '#005bb5', '#004f9e', '#003d7a'] },
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
  landing: { label: '水揚げ・個体ID発行', icon: IconAnchor },
  auction: { label: 'せり結果', icon: IconGavel },
  storage: { label: '冷凍・保管', icon: IconSnowflake },
  process: { label: '加工（子IDを発行）', icon: IconCut },
  born: { label: '親IDから発行', icon: IconCornerDownRight },
  ship: { label: '出荷', icon: IconTruck },
  fix: { label: '訂正', icon: IconPencil },
  activate: { label: 'QRを有効化', icon: IconTag },
}
const SPECIES_CODES = { 'メカジキ': 'SWO', 'ヨシキリザメ': 'SHK', 'メバチ': 'BET' }
const AREAS = ['北西太平洋（FAO 61）', '三陸沖']
const MOBILE = '(max-width: 47.99em)'

const qrUrl = (id) => `${location.origin}${location.pathname}?id=${encodeURIComponent(id)}`
// 記録できたことを知らせる。チェーンへの記録だけ失敗したときは、そのことも伝える
const notifyRecorded = (title, r) => notifications.show(r?.chainError
  ? { title, message: `記録は保存しました。ブロックチェーンへの記録はできませんでした（${r.chainError.slice(0, 80)}）`, color: 'yellow', autoClose: 10000 }
  : { title, message: r?.txHash ? 'ブロックチェーンに指紋を残しました' : '記録を保存しました', color: 'green' })
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
    <ThemeIcon size={size} radius="xl" variant="light" color={ind ? 'apple' : 'orange'}>
      {ind ? <IconFish size={size * 0.55} /> : <IconPackage size={size * 0.55} />}
    </ThemeIcon>
  )
}

function KindBadge({ kind }) {
  return kind === 'ind' ? <Badge color="apple">個体</Badge> : <Badge color="orange">加工品</Badge>
}

function VerifyBadge({ item, variant = 'light' }) {
  const r = useVerify(item)
  if (!r) return <Badge variant={variant} color="gray" leftSection={<Loader size={10} />}>照合中</Badge>
  if (!r.ok) return <Badge variant={variant} color="red" leftSection={<IconAlertTriangle size={12} />}>記録が一致しません</Badge>
  const chainNote = { match: '・チェーンと一致', none: '（チェーン未記録）', pending: '（チェーンへ記録中）', off: '（チェーン未接続）' }[r.chain] ?? ''
  return <Badge variant={variant} color="green" leftSection={<IconShieldCheck size={12} />}>記録 {item.events.length}件・書き換えなし{chainNote}</Badge>
}

// 魚種ごとの色（一覧のアイコンや詳細の帯に使う）
const SPECIES_COLORS = { 'メカジキ': ['#0a84ff', '#64d2ff'], 'ヨシキリザメ': ['#5e5ce6', '#64d2ff'], 'メバチ': ['#ff375f', '#ff9f0a'] }
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
          classNames={{ input: 'big-number-input' }} rightSection={<Text c="dimmed" fw={600} size="sm">{unit}</Text>} style={{ flex: 1 }} />
        <Group gap={4} wrap="nowrap">{steps.map((d) => btn(d))}</Group>
      </div>
    </div>
  )
}

// 今どこまで進んだか（記録の種類から判定）
const STAGES = {
  ind: [['landing', '水揚げ', IconAnchor], ['auction', 'せり', IconGavel], ['process', '加工', IconCut], ['ship', '出荷', IconTruck]],
  prod: [['born', '発行', IconCornerDownRight], ['storage', '保管', IconSnowflake], ['activate', 'ラベル', IconTag], ['ship', '出荷', IconTruck]],
}
function Stages({ it }) {
  const done = new Set(it.events.map((e) => e.type))
  if (it.qr === 'active') done.add('activate')
  return (
    <div className="stages">
      {STAGES[it.kind].map(([k, label, Icon]) => (
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
    { label: '今日の水揚げ', value: roots.filter((r) => r.info.landedAt && ymd(r.info.landedAt) === today).length, unit: '尾', icon: IconAnchor, color: '#0a84ff' },
    { label: '登録した個体', value: roots.length, unit: '尾', icon: IconFish, color: '#5e5ce6' },
    { label: '加工品', value: all.length - roots.length, unit: '件', icon: IconPackage, color: '#ff9f0a' },
    { label: 'ラベル未貼付', value: all.filter((x) => x.qr !== 'active').length, unit: '件', icon: IconTag, color: '#ff375f' },
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
function LabelPreview({ itemId, species, kg, shipName }) {
  return (
    <div>
      <Text className="field-label">発行されるラベル</Text>
      <div className="label-preview">
        <Paper p={6} radius="sm" withBorder><QRCodeSVG value={qrUrl(itemId)} size={76} /></Paper>
        <div style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" fw={600}>浜の履歴書 · 気仙沼港</Text>
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
          <Text size="sm" fw={600} truncate>{it.name}　{it.kg} kg</Text>
          <Text size="xs" ff="monospace" c="dimmed" truncate>{it.id}</Text>
        </div>
      </UnstyledButton>
      {it.children.map((c) => <TreeNode key={c} items={items} id={c} current={current} onPick={onPick} depth={depth + 1} />)}
    </>
  )
}

// ---- 管理画面（ID中心） ----

function ItemList({ items, currentRoot, onPick, onRegister, onScan, isMobile }) {
  const [q, setQ] = useState('')
  const roots = Object.values(items).filter((x) => !x.parent && (x.id.includes(q.toUpperCase()) || x.name.includes(q)))
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Title order={2} className="headline" fz={isMobile ? 26 : 22}>個体一覧</Title>
        {!isMobile && <ActionIcon variant="light" radius="xl" size="lg" onClick={onScan} aria-label="QRを読んで開く"><IconQrcode size={20} /></ActionIcon>}
      </Group>
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
            {r.children.length > 0 && <Badge size="sm" color="orange" style={{ flexShrink: 0 }}>加工 {r.children.length}</Badge>}
            <IconChevronRight size={18} color="var(--apple-text-3)" />
          </UnstyledButton>
        ))}
        {roots.length === 0 && <Text size="sm" c="dimmed" p="md">{q ? '見つかりませんでした' : 'まだ個体がありません'}</Text>}
      </div>
      {!isMobile && <Button leftSection={<IconPlus size={18} />} onClick={onRegister}>水揚げした個体を登録</Button>}
    </Stack>
  )
}

// ラベルのQR（貼るまでは薄く表示し、有効化ボタンを出す）
function QrBlock({ it, busy, onActivate, size = 112, onBand = false }) {
  return (
    <Stack align="center" gap={8}>
      <Paper p={8} radius="md" shadow={onBand ? 'md' : undefined} style={{ background: 'white' }}>
        <Box style={{ opacity: it.qr === 'active' ? 1 : 0.4 }}><QRCodeSVG value={qrUrl(it.id)} size={size} /></Box>
      </Paper>
      {it.qr === 'active'
        ? <Badge variant={onBand ? 'white' : 'light'} color="green" leftSection={<IconCircleCheckFilled size={12} />}>QR 有効</Badge>
        : <Button size="xs" variant={onBand ? 'white' : 'light'} leftSection={<IconTag size={14} />} loading={busy} onClick={onActivate}>貼ったので有効化</Button>}
    </Stack>
  )
}

function Detail({ items, it, setSel, busy, open, run, guard, isMobile, onBack }) {
  const [tab, setTab] = useState('info')
  useEffect(() => setTab('info'), [it.id])
  const anc = ancestors(items, it.id)
  const root = rootOf(items, it.id)
  // 写真：自分の写真がなければ、元の1尾の写真を引き継いで出す
  const bandPhoto = it.photos.at(-1) ?? root.photos[0] ?? null
  const chainPhotos = [...anc, it].flatMap((c) => c.photos.map((p) => ({ ...p, owner: c })))
  const activate = () => guard(() => run(() => activateQr(it.id), () => notifications.show({ title: 'QRを有効にしました', message: 'このQRは2回目の有効化ができません', color: 'green' })))

  return (
    <Stack gap="lg" className="fadein" key={it.id}>
      {isMobile && (
        <Anchor component="button" onClick={onBack} c="white" fw={500}><Group gap={2}><IconChevronLeft size={20} />個体一覧</Group></Anchor>
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
              <Group gap={6}><Badge variant="white" color="dark">{it.kind === 'ind' ? '個体' : '加工品'}</Badge><VerifyBadge item={it} variant="white" /></Group>
              <div>
                <Title order={1} className="headline" c="white" fz={isMobile ? 28 : 36}>{it.name}</Title>
                <Text c="rgba(255,255,255,0.88)" size="lg" fw={500}>{it.kg} kg</Text>
              </div>
              <Text size="xs" ff="monospace" c="rgba(255,255,255,0.85)" style={{ wordBreak: 'break-all' }}>{it.id}</Text>
            </Stack>
            {!isMobile && <QrBlock it={it} busy={busy} onActivate={activate} size={104} onBand />}
          </Group>
        </div>
        <Box p={isMobile ? 'md' : 'lg'}>
          <Stages it={it} />
          {it.parent && <Text size="sm" c="dimmed" mb="sm">親ID <Anchor ff="monospace" size="sm" onClick={() => setSel(it.parent)}>{it.parent}</Anchor></Text>}
          <SimpleGrid cols={isMobile ? 1 : 2} spacing="sm">
            <Button leftSection={<IconCut size={18} />} onClick={() => open('process')}>加工して子IDを発行</Button>
            <Button leftSection={<IconPlus size={18} />} variant="light" onClick={() => open('add')}>情報を追記</Button>
          </SimpleGrid>
          {isMobile && <Box mt="lg"><QrBlock it={it} busy={busy} onActivate={activate} size={104} /></Box>}
        </Box>
      </Card>

      <SegmentedControl fullWidth value={tab} onChange={setTab} size="md"
        data={[{ value: 'info', label: '紐づく情報' }, { value: 'log', label: `履歴 ${it.events.length}` }, { value: 'tree', label: '親子関係' }]} />

      {tab === 'info' && chainPhotos.length > 0 && (
        <div>
          <Text className="section-label">写真（元の1尾から引き継ぎ）</Text>
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
            <Text className="section-label">{it.kind === 'ind' ? 'この個体の情報' : 'この加工品の情報'}</Text>
            <InfoList rows={it.attrs} />
          </div>
          {it.kind === 'prod' && (
            <div>
              <Text className="section-label">元の個体から自動で引き継ぐ情報</Text>
              <InfoList rows={[['元の個体ID', <Anchor key="r" ff="monospace" size="sm" onClick={() => setSel(root.id)}>{root.id}</Anchor>], ...root.attrs.filter(([k]) => !k.startsWith('重量'))]} />
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
                  <Group gap="xs" mt={4}>
                    <Text size="xs" c="dimmed">{e.who}</Text><Code fz="xs">{shortHash(e.hash)}</Code>
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
          <Text className="section-label">元の個体から、加工でどう分かれたか。押すとその記録を開きます</Text>
          <div className="inset-list glass"><TreeNode items={items} id={root.id} current={it.id} onPick={setSel} /></div>
        </div>
      )}
    </Stack>
  )
}

function Manager({ items, db, sel, setSel, reload, guard, modal, setModal, pane, setPane, me }) {
  const isMobile = useIsMobile()
  const [busy, setBusy] = useState(false)
  const roots = Object.values(items).filter((x) => !x.parent)
  const it = items[sel] ?? roots[0]

  // 書き込み → 読み直し → 通知
  const run = async (fn, done) => {
    setBusy(true)
    try { const r = await fn(); await reload(); setModal(null); done?.(r) } catch (e) { errMsg(e) } finally { setBusy(false) }
  }
  const open = (m) => guard(() => setModal(m))
  const pick = (id) => { setSel(id); setPane('detail') }

  const list = <ItemList items={items} currentRoot={it && rootOf(items, it.id).id} onPick={pick} onRegister={() => open('register')} onScan={() => setModal('scan')} isMobile={isMobile} />
  const detail = it
    ? <Detail items={items} it={it} setSel={setSel} busy={busy} open={open} run={run} guard={guard} isMobile={isMobile} onBack={() => setPane('list')} />
    : (
      <Card><Center mih={260}><Stack align="center" gap="xs">
        <KindIcon kind="ind" size={56} />
        <Text fw={600} mt="xs">まだ個体がありません</Text>
        <Text size="sm" c="dimmed">「水揚げした個体を登録」から始めてください</Text>
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
      {hero}
      <div className="mgr-overlap">
        {isMobile
          ? (showDetail ? detail : <Card>{list}</Card>)
          : (
            <Box style={{ display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
              <Card style={{ position: 'sticky', top: 88 }}>{list}</Card>
              {detail}
            </Box>
          )}
      </div>

      <RegisterModal opened={modal === 'register'} onClose={() => setModal(null)} busy={busy} items={items} ships={db.ships}
        onSave={(f) => run(() => registerIndividual(f), (r) => { pick(f.itemId); notifyRecorded(`個体IDを発行しました：${f.itemId}`, r) })} />
      {it && <>
        <AddInfoModal opened={modal === 'add'} onClose={() => setModal(null)} item={it} busy={busy}
          onSave={(type, detail, photo) => run(() => appendEvent(it.id, type, detail, photo), (r) => notifyRecorded('追記しました', r))} />
        <ProcessModal key={it.id + (modal === 'process')} opened={modal === 'process'} onClose={() => setModal(null)} item={it} items={items} products={db.products} busy={busy}
          onSave={(f) => run(() => processItem({ parent: it, ...f }), () => notifications.show({ title: '子IDを発行しました', message: `${f.childIds.length}件の加工品に親ID ${it.id} を紐づけました`, color: 'green' }))} />
      </>}
    </>
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
          data={[{ value: 'auction', label: 'せり結果' }, { value: 'storage', label: '冷凍・保管' }, { value: 'ship', label: '出荷' }, { value: 'fix', label: '訂正（前の記録を正す）' }]} />
        <TextInput label="内容" placeholder="例：冷凍庫Bへ移動、−50℃" value={detail} onChange={(e) => setDetail(e.currentTarget.value)} />
        <PhotoPicker value={photo} onChange={setPhoto} />
        <Text size="sm" c="dimmed">保存すると、この記録は消せません。記録する事業者はログイン中の事業者になります。</Text>
        <Group justify="flex-end" mt="sm"><Button variant="default" onClick={onClose}>やめる</Button><Button disabled={!detail} loading={busy} onClick={() => { onSave(type, detail, photo); setDetail(''); setPhoto(null) }}>追記する</Button></Group>
      </Stack>
    </Sheet>
  )
}

function ProcessModal({ opened, onClose, item, items, products, busy, onSave }) {
  const choices = products.filter((p) => p.species === item.species)
  const [productId, setProductId] = useState(choices[0]?.id ?? null)
  const [customName, setCustomName] = useState(`${item.name} 加工品`)
  const [count, setCount] = useState(item.kind === 'ind' ? 4 : 2)
  const [w, setW] = useState(item.kind === 'ind' ? 20 : 0.4)
  const [photo, setPhoto] = useState(null)
  const product = choices.find((p) => p.id === productId)
  const n = Number(count) || 0
  const weights = Array.from({ length: n }, () => Number(w) || 0)
  const check = checkWeight({
    parentKg: item.kg, childrenKg: item.children.map((c) => items[c].kg), newKg: weights,
    yieldMin: product?.yield_min != null ? Number(product.yield_min) : null, yieldMax: product?.yield_max != null ? Number(product.yield_max) : null,
  })
  const ids = childIds(item.id, item.kind === 'ind', item.children.length, n)
  const name = product?.name ?? customName
  const pct = Math.min(100, check.ratio * 100)
  const small = item.kind === 'prod'
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
                  <ChoiceCard key={p.id} checked={productId === p.id} onClick={() => setProductId(p.id)}>
                    <Text fw={600} size="sm" pr={24}>{p.name}</Text>
                    <Text size="xs" c="dimmed">{[p.storage, p.yield_min != null && `歩留まり ${Math.round(p.yield_min * 100)}〜${Math.round(p.yield_max * 100)}%`].filter(Boolean).join(' · ') || '—'}</Text>
                  </ChoiceCard>
                ))}
              </SimpleGrid>
            )
            : <TextInput value={customName} onChange={(e) => setCustomName(e.currentTarget.value)} aria-label="加工品の名前" />}
        </div>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <BigNumber label="いくつに分けるか" value={count} onChange={setCount} unit="個" steps={[1]} min={1} decimals={0} />
          <BigNumber label="1つあたりの重さ" value={w} onChange={setW} unit="kg" steps={small ? [0.1] : [1]} min={0.1} decimals={small ? 2 : 1} />
        </SimpleGrid>
        {/* 親の重量に対して、子の合計がどれだけか */}
        <div>
          <Group justify="space-between" mb={6}><Text size="sm" c="dimmed">合計 {check.total.toFixed(1)} kg ／ 親 {item.kg} kg</Text><Text size="sm" fw={700} c={check.ok ? undefined : 'red'}>{(check.ratio * 100).toFixed(0)}%</Text></Group>
          <Box h={10} style={{ borderRadius: 99, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <Box h="100%" w={`${pct}%`} style={{ borderRadius: 99, background: check.ok ? 'linear-gradient(90deg, #0a84ff, #64d2ff)' : 'var(--apple-red)', transition: 'width 250ms var(--ease-apple)' }} />
          </Box>
        </div>
        {check.issues.map((i) => (
          <Alert key={i.message} radius="md" color={i.level === 'error' ? 'red' : i.level === 'warning' ? 'yellow' : 'apple'} variant="light" icon={<IconAlertTriangle size={18} />}>{i.message}</Alert>
        ))}
        <PhotoPicker value={photo} onChange={setPhoto} label="加工品の写真" hint="撮らなくても、元の1尾の写真が消費者の画面に出ます" />
        <Text size="sm" c="dimmed">子ID {n}件（{ids[0]} …）を発行し、すべてに親IDを持たせます。漁船・海域などは親から自動で引き継ぎます。</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button leftSection={<IconCut size={18} />} loading={busy} disabled={!check.ok || n < 1 || !name}
            onClick={() => onSave({ childIds: ids, productId: product?.id ?? null, name, weights, photo })}>{n}件を発行</Button>
        </Group>
      </Stack>
    </Sheet>
  )
}

function RegisterModal({ opened, onClose, busy, items, ships, onSave }) {
  const [shipId, setShipId] = useState(null)
  const [species, setSpecies] = useState('メカジキ')
  const [area, setArea] = useState(AREAS[0])
  const [period, setPeriod] = useState('')
  const [kg, setKg] = useState(110)
  const [photo, setPhoto] = useState(null)
  const ship = ships.find((s) => s.id === (shipId ?? ships[0]?.id))
  // ID：KSN-魚種コード-水揚げ日(YYMMDD)-連番
  const today = new Date().toISOString()
  const prefix = `KSN-${SPECIES_CODES[species]}-${ymd(today).replaceAll('-', '').slice(2)}-`
  const seq = Object.keys(items).filter((id) => id.startsWith(prefix) && !id.slice(prefix.length).includes('-')).length + 1
  const itemId = prefix + String(seq).padStart(3, '0')
  return (
    <Sheet opened={opened} onClose={onClose} title="水揚げした個体を登録">
      <Stack gap="lg">
        <div>
          <Text className="field-label">魚種</Text>
          <SimpleGrid cols={3} spacing="sm">
            {Object.entries(SPECIES_CODES).map(([sp, code]) => (
              <ChoiceCard key={sp} checked={species === sp} onClick={() => setSpecies(sp)}>
                <Stack align="center" gap={6}>
                  <ItemAvatar it={{ kind: 'ind', species: sp }} size={44} />
                  <Text fw={600} fz={13} style={{ whiteSpace: 'nowrap' }}>{sp}</Text>
                  <Text size="xs" c="dimmed" ff="monospace">{code}</Text>
                </Stack>
              </ChoiceCard>
            ))}
          </SimpleGrid>
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
          <SegmentedControl fullWidth data={AREAS} value={area} onChange={setArea} />
        </div>
        <BigNumber label="重量" value={kg} onChange={setKg} unit="kg" steps={[1, 10]} min={0.1} />
        <TextInput label="漁獲期間" placeholder="例：9/20〜10/1" value={period} onChange={(e) => setPeriod(e.currentTarget.value)}
          styles={{ label: { fontSize: 14, fontWeight: 600, marginBottom: 8 } }} />
        <PhotoPicker value={photo} onChange={setPhoto} label="水揚げ時の写真" hint="消費者の画面に「元の1尾」として大きく出ます。加工品にも引き継がれます" />
        <LabelPreview itemId={itemId} species={species} kg={kg} shipName={ship?.name} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button loading={busy} disabled={!ship || !(Number(kg) > 0)} leftSection={<IconTag size={18} />}
            onClick={() => onSave({ itemId, species, weightKg: Number(kg), shipId: ship.id, catchArea: area, period, landedAt: today, photo })}>個体IDを発行</Button>
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
  const qid = new URLSearchParams(location.search).get('id') // QRから開いたとき（消費者）
  const isMobile = useIsMobile()
  const [db, setDb] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [me, setMe] = useState(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [sel, setSel] = useState(qid)
  const [view, setView] = useState(qid ? 'consumer' : 'manage')
  const [pane, setPane] = useState('list') // スマホの管理画面：一覧 or 詳細
  const [modal, setModal] = useState(null) // 'register' | 'add' | 'process' | 'scan'
  const showNav = !qid // QRから来た消費者には管理用の切り替えを見せない

  const reload = useCallback(async () => {
    try { setDb(await fetchAll()); setLoadErr(null) } catch (e) { setLoadErr(e.message ?? String(e)) }
  }, [])
  useEffect(() => {
    reload()
    fetchMe().then(setMe)
    // コールバックの中で Supabase を呼ぶと詰まることがあるので、次の処理に回す
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => setTimeout(() => fetchMe().then(setMe), 0))
    return () => subscription.unsubscribe()
  }, [])
  const items = useMemo(() => (db ? buildItems(db) : null), [db])

  // 記録する操作の前にログインと所属を確かめる
  const guard = (fn) => {
    if (!me) return setLoginOpen(true)
    if (!me.business) return notifications.show({ color: 'red', title: '事業者に所属していません', message: `${me.email} は members に登録されていません` })
    fn()
  }
  const onScanned = (id) => {
    if (!items?.[id]) return notifications.show({ color: 'red', message: `ID ${id} は登録されていません` })
    setModal(null); setSel(id); setPane('detail')
    notifications.show({ message: `QRを読み取りました：${items[id].name}`, color: 'apple' })
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
          <Menu.Item leftSection={<IconLogout size={16} />} onClick={signOut}>ログアウト</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    )
    : isMobile
      ? <ActionIcon variant="subtle" radius="xl" size="lg" onClick={() => setLoginOpen(true)} aria-label="ログイン"><IconLogin size={22} /></ActionIcon>
      : <Button variant="white" size="sm" leftSection={<IconLogin size={16} />} onClick={() => setLoginOpen(true)}>ログイン</Button>

  return (
    <AppShell className={view === 'consumer' ? 'dark-shell' : 'navy-shell'} header={{ height: isMobile ? 56 : 64 }} footer={{ height: 64, collapsed: !(isMobile && showNav) }}
      padding={0}>
      <AppShell.Header className="glass-nav" px={isMobile ? 'md' : 'xl'}>
        <Group h="100%" justify="space-between" wrap="nowrap" maw={1280} mx="auto">
          <Group gap={10} wrap="nowrap">
            <Center w={32} h={32} style={{ borderRadius: 9, background: 'linear-gradient(135deg, #0a84ff, #0071e3 55%, #34c759)' }}><IconFish size={19} color="white" /></Center>
            <Text fw={700} size="md" className="brand" style={{ letterSpacing: '-0.01em' }}>浜の履歴書</Text>
          </Group>
          <Group gap="sm" wrap="nowrap">
            {!isMobile && showNav && (
              <SegmentedControl value={view} onChange={setView} size="sm"
                data={[{ value: 'manage', label: <Group gap={6} wrap="nowrap"><IconDatabase size={16} /><span>ID管理</span></Group> },
                  { value: 'consumer', label: <Group gap={6} wrap="nowrap"><IconUserSearch size={16} /><span>消費者が見る画面</span></Group> }]} />
            )}
            {view === 'manage' && account}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main style={{ background: 'transparent' }}>
        {loadErr ? <Alert color="red" radius="lg" icon={<IconAlertTriangle />} title="データを読み込めませんでした" maw={720} mx="auto" mt="xl">{loadErr}</Alert>
          : !items ? <Center mih={300}><Loader /></Center>
          : view === 'manage'
            ? <Manager items={items} db={db} sel={sel} setSel={setSel} reload={reload} guard={guard} modal={modal} setModal={setModal} pane={pane} setPane={setPane} me={me} />
            : <ViewBoundary key={view}><ConsumerView items={items} sel={sel} setSel={setSel} demo={showNav} /></ViewBoundary>}
        {!chainEnabled && view === 'manage' && items && (
          <Text size="xs" c="dimmed" ta="center" pb="xl" px="md">ブロックチェーン未接続（記録とハッシュはDBに保存しています）</Text>
        )}
      </AppShell.Main>

      <AppShell.Footer className="glass-tabbar">
        <TabBar view={view} pane={pane}
          onList={() => { setView('manage'); setPane('list') }}
          onRegister={() => { setView('manage'); guard(() => setModal('register')) }}
          onScan={() => { setView('manage'); setModal('scan') }}
          onConsumer={() => setView('consumer')} />
      </AppShell.Footer>

      <ScanModal opened={modal === 'scan'} onClose={() => setModal(null)} onFound={onScanned} />
      <LoginModal opened={loginOpen} onClose={() => setLoginOpen(false)} />
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <MantineProvider theme={theme}>
    <Notifications position="top-center" />
    <App />
  </MantineProvider>
)
