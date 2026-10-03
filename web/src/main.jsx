import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import {
  MantineProvider, createTheme, AppShell, Group, Stack, Text, Title, Button, SegmentedControl,
  Paper, Badge, Table, Timeline, TextInput, PasswordInput, NumberInput, Select, Modal, ThemeIcon, Alert, Tabs,
  SimpleGrid, Card, Box, ScrollArea, Code, Center, NavLink, Divider, UnstyledButton, Anchor, Breadcrumbs, Loader,
} from '@mantine/core'
import { Notifications, notifications } from '@mantine/notifications'
import {
  IconFish, IconSearch, IconPlus, IconCut, IconQrcode, IconShieldCheck, IconHistory, IconBinaryTree2,
  IconInfoCircle, IconLock, IconArrowUp, IconSailboat, IconAnchor, IconGavel, IconPackage, IconTruck,
  IconSnowflake, IconPencil, IconCornerDownRight, IconUserSearch, IconDatabase, IconAlertTriangle,
  IconTag, IconLogin, IconLogout, IconLink,
} from '@tabler/icons-react'
import { QRCodeSVG } from 'qrcode.react'
import { Html5Qrcode } from 'html5-qrcode'
import {
  supabase, chainEnabled, signIn, signOut, fetchMe, fetchAll,
  registerIndividual, appendEvent, processItem, activateQr, verifyItem,
} from './api.js'
import { checkWeight, childIds } from './lib/rules.js'

const theme = createTheme({
  primaryColor: 'sea',
  colors: { sea: ['#e6f6f5', '#ccebe8', '#9cd6d1', '#68c0b9', '#3fada5', '#25a098', '#13958d', '#0d7f78', '#0d6b68', '#03524f'] },
  primaryShade: 8,
  fontFamily: "'BIZ UDPGothic', 'Hiragino Sans', 'Yu Gothic UI', sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', monospace",
  headings: { fontFamily: "'BIZ UDPGothic', sans-serif", fontWeight: '700' },
  defaultRadius: 'md',
  fontSizes: { xs: '13px', sm: '15px', md: '17px', lg: '19px', xl: '22px' },
  components: { Button: { defaultProps: { size: 'md' } }, TextInput: { defaultProps: { size: 'md' } }, PasswordInput: { defaultProps: { size: 'md' } }, NumberInput: { defaultProps: { size: 'md' } }, Select: { defaultProps: { size: 'md' } } },
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

// 日付は日本時間で表示する
const ymd = (s) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(s))
const mdhm = (s) => new Date(s).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const shortHash = (h) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : '')
const addDays = (s, n) => ymd(new Date(new Date(s).getTime() + n * 86400000))
const qrUrl = (id) => `${location.origin}${location.pathname}?id=${encodeURIComponent(id)}`
const errMsg = (e) => notifications.show({ color: 'red', title: 'できませんでした', message: e.message ?? String(e), autoClose: 8000 })

// DB の行を、画面で使う形（親子・表示用の項目・履歴）に組み立てる
function buildItems({ items, events, ships, products, businesses }) {
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
      events: evs.map((e) => ({ id: e.id, t: mdhm(e.created_at), type: e.type, who: biz[e.actor]?.name ?? '—', detail: e.payload?.detail ?? '', hash: e.hash, tx: e.tx_hash })),
    }
  }
  for (const it of Object.values(out)) if (it.parent && out[it.parent]) out[it.parent].children.push(it.id)
  return out
}

const ancestors = (items, id) => { const a = []; let c = items[id]; while (c?.parent) { c = items[c.parent]; a.unshift(c) } return a }
const rootOf = (items, id) => ancestors(items, id)[0] ?? items[id]

// 1件の改ざん検証（記録が増えたら計算し直す）
function useVerify(item) {
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

function VerifyBadge({ item }) {
  const r = useVerify(item)
  if (!r) return <Badge size="md" color="gray" variant="light" leftSection={<Loader size={10} />}>照合中</Badge>
  if (!r.ok) return <Badge size="md" color="red" variant="light" leftSection={<IconAlertTriangle size={14} />}>記録が一致しません</Badge>
  return <Badge size="md" color="sea" variant="light" leftSection={<IconShieldCheck size={14} />}>記録 {item.events.length}件・書き換えなし{r.onchain ? '' : '（チェーン未接続）'}</Badge>
}

function KindBadge({ kind, size = 'sm' }) {
  return kind === 'ind'
    ? <Badge size={size} color="indigo" variant="light" leftSection={<IconFish size={12} />}>個体</Badge>
    : <Badge size={size} color="orange" variant="light" leftSection={<IconPackage size={12} />}>加工品</Badge>
}

// 系譜ツリー
function TreeNode({ items, id, current, onPick, depth = 0 }) {
  const it = items[id]
  const active = id === current
  return (
    <Box>
      <UnstyledButton onClick={() => onPick(id)} w="100%" py={8} px="sm" pl={12 + depth * 28}
        style={{ borderRadius: 8, background: active ? 'var(--mantine-color-sea-0)' : undefined, outline: active ? '2px solid var(--mantine-color-sea-8)' : undefined }}>
        <Group gap="sm" wrap="nowrap">
          {depth > 0 && <IconCornerDownRight size={18} color="var(--mantine-color-gray-6)" />}
          <KindBadge kind={it.kind} />
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={700} truncate>{it.name}　{it.kg} kg</Text>
            <Text size="xs" ff="monospace" c="dimmed" truncate>{it.id}</Text>
          </div>
        </Group>
      </UnstyledButton>
      {it.children.map((c) => <TreeNode key={c} items={items} id={c} current={current} onPick={onPick} depth={depth + 1} />)}
    </Box>
  )
}

// ---- 管理画面（ID中心） ----
function Manager({ items, db, sel, setSel, reload, guard }) {
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(null) // 'add' | 'process' | 'register' | 'scan'
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('info')
  const roots = Object.values(items).filter((x) => !x.parent && (x.id.includes(q.toUpperCase()) || x.name.includes(q)))
  const it = items[sel] ?? roots[0]

  // 書き込み → 読み直し → 通知
  const run = async (fn, done) => {
    setBusy(true)
    try { const r = await fn(); await reload(); setModal(null); done?.(r) } catch (e) { errMsg(e) } finally { setBusy(false) }
  }
  const open = (m) => guard(() => setModal(m))

  const list = (
    <Card withBorder padding="md" style={{ gridColumn: 'span 3' }}>
      <Stack gap="sm">
        <Text fw={700}>個体一覧</Text>
        <TextInput placeholder="IDか魚種で探す" leftSection={<IconSearch size={18} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label="検索" />
        <Button variant="light" leftSection={<IconQrcode size={18} />} onClick={() => setModal('scan')}>QRを読んで開く</Button>
        <Divider />
        <ScrollArea.Autosize mah={560}>
          <Stack gap={4}>
            {roots.map((r) => (
              <NavLink key={r.id} active={it && rootOf(items, it.id).id === r.id} onClick={() => { setSel(r.id); setTab('info') }} variant="light"
                label={<Text fw={700} size="sm">{r.name}　{r.kg} kg</Text>}
                description={<Text size="xs" ff="monospace">{r.id}</Text>}
                rightSection={r.children.length ? <Badge size="xs" color="orange" variant="light">加工品 {r.children.length}</Badge> : null}
                style={{ borderRadius: 8 }} />
            ))}
            {roots.length === 0 && <Text size="sm" c="dimmed">まだ個体がありません</Text>}
          </Stack>
        </ScrollArea.Autosize>
        <Button leftSection={<IconPlus size={18} />} onClick={() => open('register')}>水揚げした個体を登録</Button>
      </Stack>
    </Card>
  )

  const modals = (
    <>
      <RegisterModal opened={modal === 'register'} onClose={() => setModal(null)} busy={busy} items={items} ships={db.ships}
        onSave={(f) => run(() => registerIndividual(f), () => { setSel(f.itemId); setTab('info'); notifications.show({ title: '個体IDを発行しました', message: f.itemId, color: 'sea' }) })} />
      <ScanModal opened={modal === 'scan'} onClose={() => setModal(null)}
        onFound={(id) => {
          if (!items[id]) return notifications.show({ color: 'red', message: `ID ${id} は登録されていません` })
          setModal(null); setSel(id); setTab('info'); notifications.show({ message: `QRを読み取りました：${items[id].name}`, color: 'sea' })
        }} />
      {it && <>
        <AddInfoModal opened={modal === 'add'} onClose={() => setModal(null)} item={it} busy={busy}
          onSave={(type, detail) => run(() => appendEvent(it.id, type, detail), (r) => { setTab('log'); notifications.show({ title: '追記しました', message: r.txHash ? 'チェーンに指紋を残しました' : `${it.id} に記録を追加しました`, color: 'sea' }) })} />
        <ProcessModal key={it.id + (modal === 'process')} opened={modal === 'process'} onClose={() => setModal(null)} item={it} items={items} products={db.products} busy={busy}
          onSave={(f) => run(() => processItem({ parent: it, ...f }), () => { setTab('tree'); notifications.show({ title: '子IDを発行しました', message: `${f.childIds.length}件の加工品に親ID ${it.id} を紐づけました`, color: 'sea' }) })} />
      </>}
    </>
  )

  if (!it) {
    return (
      <SimpleGrid cols={{ base: 1, lg: 12 }} spacing="lg" maw={1400} mx="auto">
        {list}
        <Card withBorder padding="xl" style={{ gridColumn: 'span 9' }}>
          <Center mih={240}><Stack align="center" gap="xs"><IconFish size={40} color="var(--mantine-color-gray-5)" /><Text c="dimmed">左の「水揚げした個体を登録」から始めてください</Text></Stack></Center>
        </Card>
        {modals}
      </SimpleGrid>
    )
  }

  const anc = ancestors(items, it.id)
  const root = rootOf(items, it.id)
  return (
    <SimpleGrid cols={{ base: 1, lg: 12 }} spacing="lg" maw={1400} mx="auto">
      {list}

      {/* 右：詳細 */}
      <Stack gap="lg" style={{ gridColumn: 'span 9' }}>
        {anc.length > 0 && (
          <Alert color="indigo" variant="light" icon={<IconArrowUp />} title="元の個体をたどる">
            <Breadcrumbs separator="›">
              {anc.map((a) => <Anchor key={a.id} size="sm" onClick={() => setSel(a.id)}>{a.kind === 'ind' ? '個体' : '加工品'}：{a.name}</Anchor>)}
              <Text size="sm" fw={700}>{it.name}</Text>
            </Breadcrumbs>
          </Alert>
        )}
        <Card withBorder padding="lg">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Stack gap={6}>
              <Group gap="xs"><KindBadge kind={it.kind} size="md" /><VerifyBadge item={it} /></Group>
              <Title order={2}>{it.name}　{it.kg} kg</Title>
              <Group gap="xs"><Text size="sm" c="dimmed">ID</Text><Code fz="md">{it.id}</Code></Group>
              {it.parent && <Group gap="xs"><Text size="sm" c="dimmed">親ID</Text><Anchor ff="monospace" size="sm" onClick={() => setSel(it.parent)}>{it.parent}</Anchor></Group>}
              <Group mt="sm">
                <Button leftSection={<IconPlus size={18} />} variant="outline" onClick={() => open('add')}>情報を追記</Button>
                <Button leftSection={<IconCut size={18} />} onClick={() => open('process')}>加工して子IDを発行</Button>
              </Group>
            </Stack>
            <Stack align="center" gap={4} visibleFrom="sm">
              <Paper withBorder p="xs" style={{ opacity: it.qr === 'active' ? 1 : 0.45 }}><QRCodeSVG value={qrUrl(it.id)} size={104} /></Paper>
              {it.qr === 'active'
                ? <Badge color="sea" variant="light">QR 有効</Badge>
                : <Button size="xs" variant="light" leftSection={<IconTag size={14} />} loading={busy}
                    onClick={() => guard(() => run(() => activateQr(it.id), () => notifications.show({ title: 'QRを有効にしました', message: 'このQRは2回目の有効化ができません', color: 'sea' })))}>
                    貼ったので有効化
                  </Button>}
            </Stack>
          </Group>
        </Card>

        <Card withBorder padding="lg">
          <Tabs value={tab} onChange={setTab}>
            <Tabs.List mb="md">
              <Tabs.Tab value="info" leftSection={<IconInfoCircle size={18} />}>紐づく情報</Tabs.Tab>
              <Tabs.Tab value="log" leftSection={<IconHistory size={18} />}>追記の履歴</Tabs.Tab>
              <Tabs.Tab value="tree" leftSection={<IconBinaryTree2 size={18} />}>親子関係</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="info">
              <SimpleGrid cols={{ base: 1, md: it.kind === 'prod' ? 2 : 1 }} spacing="lg">
                <div>
                  <Text fw={700} mb="xs">{it.kind === 'ind' ? 'この個体の情報' : 'この加工品の情報'}</Text>
                  <Table withTableBorder verticalSpacing="sm" fz="sm">
                    <Table.Tbody>
                      {it.attrs.map(([k, v]) => (
                        <Table.Tr key={k}><Table.Td c="dimmed" w={160} bg="gray.0">{k}</Table.Td><Table.Td>{v}</Table.Td></Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </div>
                {it.kind === 'prod' && (
                  <div>
                    <Group gap="xs" mb="xs"><Text fw={700}>元の個体から引き継ぐ情報</Text><Badge size="sm" color="grape" variant="light">自動で引き継ぎ</Badge></Group>
                    <Table withTableBorder verticalSpacing="sm" fz="sm">
                      <Table.Tbody>
                        <Table.Tr><Table.Td c="dimmed" w={160} bg="grape.0">元の個体ID</Table.Td><Table.Td><Anchor ff="monospace" size="sm" onClick={() => setSel(root.id)}>{root.id}</Anchor></Table.Td></Table.Tr>
                        {root.attrs.filter(([k]) => !k.startsWith('重量')).map(([k, v]) => (
                          <Table.Tr key={k}><Table.Td c="dimmed" bg="grape.0">{k}</Table.Td><Table.Td>{v}</Table.Td></Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </div>
                )}
              </SimpleGrid>
            </Tabs.Panel>

            <Tabs.Panel value="log">
              <Alert color="gray" variant="light" icon={<IconLock />} mb="md">記録は<b>追記だけ</b>できます。間違いは消さずに「訂正」として新しい記録を足します。各記録の指紋（ハッシュ）はブロックチェーンに残ります。</Alert>
              <Timeline active={it.events.length} bulletSize={34} lineWidth={3}>
                {it.events.map((e) => {
                  const T = EVENT_TYPES[e.type] ?? EVENT_TYPES.fix
                  return (
                    <Timeline.Item key={e.id} bullet={<T.icon size={18} />} title={<Group gap="xs"><Text fw={700}>{T.label}</Text><Text size="xs" c="dimmed">{e.t}</Text></Group>}>
                      <Text size="sm">{e.detail}</Text>
                      <Group gap="xs" mt={4}>
                        <Text size="xs" c="dimmed">{e.who}</Text><Code fz="xs">{shortHash(e.hash)}</Code>
                        {e.tx && <Anchor size="xs" href={`https://amoy.polygonscan.com/tx/${e.tx}`} target="_blank"><Group gap={2}><IconLink size={12} />チェーン</Group></Anchor>}
                      </Group>
                    </Timeline.Item>
                  )
                })}
              </Timeline>
            </Tabs.Panel>

            <Tabs.Panel value="tree">
              <Text size="sm" c="dimmed" mb="sm">元の個体から、加工でどう分かれたかを表示します。押すとその記録を開きます。</Text>
              <Paper withBorder p="sm"><TreeNode items={items} id={root.id} current={it.id} onPick={setSel} /></Paper>
            </Tabs.Panel>
          </Tabs>
        </Card>
      </Stack>
      {modals}
    </SimpleGrid>
  )
}

function AddInfoModal({ opened, onClose, item, busy, onSave }) {
  const [type, setType] = useState('storage')
  const [detail, setDetail] = useState('')
  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>情報を追記：{item.name}</Text>} centered size="lg">
      <Stack>
        <Code>{item.id}</Code>
        <Select label="記録の種類" value={type} onChange={setType} allowDeselect={false}
          data={[{ value: 'auction', label: 'せり結果' }, { value: 'storage', label: '冷凍・保管' }, { value: 'ship', label: '出荷' }, { value: 'fix', label: '訂正（前の記録を正す）' }]} />
        <TextInput label="内容" placeholder="例：冷凍庫Bへ移動、−50℃" value={detail} onChange={(e) => setDetail(e.currentTarget.value)} />
        <Alert color="gray" variant="light" icon={<IconLock />}>保存すると、この記録は消せません。記録する事業者はログイン中の事業者になります。</Alert>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>やめる</Button><Button disabled={!detail} loading={busy} onClick={() => { onSave(type, detail); setDetail('') }}>追記する</Button></Group>
      </Stack>
    </Modal>
  )
}

function ProcessModal({ opened, onClose, item, items, products, busy, onSave }) {
  const choices = products.filter((p) => p.species === item.species)
  const [productId, setProductId] = useState(choices[0]?.id ?? null)
  const [customName, setCustomName] = useState(`${item.name} 加工品`)
  const [count, setCount] = useState(item.kind === 'ind' ? 4 : 2)
  const [w, setW] = useState(item.kind === 'ind' ? 20 : 0.4)
  const product = choices.find((p) => p.id === productId)
  const n = Number(count) || 0
  const weights = Array.from({ length: n }, () => Number(w) || 0)
  const check = checkWeight({
    parentKg: item.kg, childrenKg: item.children.map((c) => items[c].kg), newKg: weights,
    yieldMin: product?.yield_min != null ? Number(product.yield_min) : null, yieldMax: product?.yield_max != null ? Number(product.yield_max) : null,
  })
  const ids = childIds(item.id, item.kind === 'ind', item.children.length, n)
  const name = product?.name ?? customName
  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>加工して子IDを発行</Text>} centered size="lg">
      <Stack>
        <Paper withBorder p="sm" bg="gray.0"><Text size="xs" c="dimmed">親ID</Text><Code>{item.id}</Code><Text size="sm" mt={4}>{item.name}　{item.kg} kg（登録済みの子 {item.children.length}件）</Text></Paper>
        {choices.length > 0
          ? <Select label="加工品" data={choices.map((p) => ({ value: p.id, label: p.name }))} value={productId} onChange={setProductId} allowDeselect={false} />
          : <TextInput label="加工品の名前" value={customName} onChange={(e) => setCustomName(e.currentTarget.value)} />}
        <SimpleGrid cols={2}>
          <NumberInput label="いくつに分けるか" min={1} max={20} value={count} onChange={setCount} />
          <NumberInput label="1つあたりの重さ（kg）" min={0.1} decimalScale={2} value={w} onChange={setW} />
        </SimpleGrid>
        <Text size="sm" c="dimmed">合計 {check.total.toFixed(1)} kg ／ 親の {(check.ratio * 100).toFixed(0)}%</Text>
        {check.issues.map((i) => (
          <Alert key={i.message} color={i.level === 'error' ? 'red' : i.level === 'warning' ? 'yellow' : 'blue'} variant="light" icon={<IconAlertTriangle />}>{i.message}</Alert>
        ))}
        <Alert color="indigo" variant="light" icon={<IconBinaryTree2 />}>子ID {n}件（{ids[0]} …）を発行し、すべてに親IDを持たせます。漁船・海域などは親から自動で引き継ぎます。</Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button leftSection={<IconCut size={18} />} loading={busy} disabled={!check.ok || n < 1 || !name}
            onClick={() => onSave({ childIds: ids, productId: product?.id ?? null, name, weights })}>{n}件を発行</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function RegisterModal({ opened, onClose, busy, items, ships, onSave }) {
  const [shipId, setShipId] = useState(null)
  const [species, setSpecies] = useState('メカジキ')
  const [area, setArea] = useState(AREAS[0])
  const [period, setPeriod] = useState('')
  const [kg, setKg] = useState(110)
  const ship = ships.find((s) => s.id === (shipId ?? ships[0]?.id))
  // ID：KSN-魚種コード-水揚げ日(YYMMDD)-連番
  const today = new Date().toISOString()
  const prefix = `KSN-${SPECIES_CODES[species]}-${ymd(today).replaceAll('-', '').slice(2)}-`
  const seq = Object.keys(items).filter((id) => id.startsWith(prefix) && !id.slice(prefix.length).includes('-')).length + 1
  const itemId = prefix + String(seq).padStart(3, '0')
  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>水揚げした個体を登録（個体IDを発行）</Text>} centered size="lg">
      <Stack>
        <SimpleGrid cols={2}>
          <Select label="漁船" data={ships.map((s) => ({ value: s.id, label: s.name }))} value={ship?.id ?? null} onChange={setShipId} allowDeselect={false} />
          <Select label="魚種" data={Object.keys(SPECIES_CODES)} value={species} onChange={setSpecies} allowDeselect={false} />
          <Select label="漁獲海域" data={AREAS} value={area} onChange={setArea} allowDeselect={false} />
          <NumberInput label="重量（kg）" min={0.1} decimalScale={1} value={kg} onChange={setKg} />
        </SimpleGrid>
        <TextInput label="漁獲期間" placeholder="例：9/20〜10/1" value={period} onChange={(e) => setPeriod(e.currentTarget.value)} />
        {ship && (
          <Paper withBorder p="sm" bg="indigo.0">
            <Group gap="xs" mb={4}><IconDatabase size={16} /><Text size="sm" fw={700}>船マスタから自動で入る項目</Text></Group>
            <Text size="sm">登録番号 {ship.reg_no} ／ 許可番号 {ship.permit_no ?? '—'} ／ 漁法 {ship.gear}</Text>
          </Paper>
        )}
        <Text size="sm" c="dimmed">発行するID：<Code>{itemId}</Code></Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>やめる</Button>
          <Button loading={busy} disabled={!ship || !(Number(kg) > 0)}
            onClick={() => onSave({ itemId, species, weightKg: Number(kg), shipId: ship.id, catchArea: area, period, landedAt: today })}>個体IDを発行</Button>
        </Group>
      </Stack>
    </Modal>
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
    }, 50) // Modal の中身が描画されてから始める
    return () => { clearTimeout(t); if (scanner?.isScanning) scanner.stop().catch(() => {}) }
  }, [opened])
  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>QRを読んで開く</Text>} centered>
      <Stack>
        <Box id="qr-reader" style={{ minHeight: camErr ? 0 : 240 }} />
        {camErr && <Alert color="yellow" variant="light" icon={<IconAlertTriangle />}>カメラを使えませんでした。IDを入力してください。</Alert>}
        <Group align="flex-end">
          <TextInput style={{ flex: 1 }} label="IDを入力" placeholder="KSN-SWO-261003-001" value={manual} onChange={(e) => setManual(e.currentTarget.value)} />
          <Button disabled={!manual} onClick={() => onFound(toId(manual).trim().toUpperCase())}>開く</Button>
        </Group>
      </Stack>
    </Modal>
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
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>事業者としてログイン</Text>} centered>
      <Stack>
        <Text size="sm" c="dimmed">記録するにはログインが必要です。消費者の画面はログインなしで見られます。</Text>
        <TextInput label="メールアドレス" value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoComplete="username" />
        <PasswordInput label="パスワード" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>やめる</Button><Button loading={busy} disabled={!email || !password} onClick={submit}>ログイン</Button></Group>
      </Stack>
    </Modal>
  )
}

// ---- 消費者が見る画面 ----
function ConsumerView({ items, sel, setSel }) {
  const all = Object.values(items)
  const leaves = all.filter((x) => x.children.length === 0)
  const cur = items[sel] ? sel : leaves.find((x) => x.kind === 'prod')?.id ?? leaves[0]?.id
  const chain = cur ? [...ancestors(items, cur), items[cur]] : []
  const verify = useVerifyAll(chain)
  if (!cur) return <Center mih={300}><Text c="dimmed">まだ記録がありません</Text></Center>
  const root = chain[0]
  const a = Object.fromEntries(root.attrs)
  return (
    <Stack align="center" gap="md">
      <Select label="QRを読んだ商品（デモ用の切り替え）" w={390} maw="100%" value={cur} onChange={setSel} allowDeselect={false} searchable
        data={all.map((p) => ({ value: p.id, label: `${p.name}（${p.id}）` }))} />
      <Paper w={390} maw="100%" radius={32} shadow="xl" withBorder style={{ overflow: 'hidden', borderWidth: 8, borderColor: '#1b2730' }}>
        <Box p="lg" style={{ background: '#13212B' }}>
          <Text size="xs" c="#B9C6CC">この魚の履歴書 ／ Traceability record</Text>
          <Title order={3} c="white" mt={6}>{items[cur].name}</Title>
          <Text size="sm" c="#DCE6E9">{items[cur].kg} kg</Text>
          {verify === null
            ? <Alert mt="md" color="gray" variant="filled" icon={<Loader size={16} color="white" />} title="記録を照合しています" />
            : verify.ok
              ? <Alert mt="md" color="sea" variant="filled" icon={<IconShieldCheck />} title="記録は書き換えられていません">
                  元の1尾までさかのぼって確認できます{verify.onchain ? '（ブロックチェーンと照合済み）' : '（ブロックチェーンには未接続）'}
                </Alert>
              : <Alert mt="md" color="red" variant="filled" icon={<IconAlertTriangle />} title="記録が一致しません">記録の一部が書き換えられた可能性があります</Alert>}
        </Box>
        <Box p="lg">
          <Paper withBorder p="md" mb="lg" bg="indigo.0">
            <Text size="xs" c="dimmed">元の1尾</Text>
            <Text fw={700}>{a['魚種']}（{root.kg} kg）</Text>
            <Text size="sm">{a['漁船']}・{a['漁法']}</Text>
            <Text size="sm">{a['漁獲海域']}で漁獲 → {a['水揚げ港']}に水揚げ</Text>
          </Paper>
          <Timeline active={chain.length} bulletSize={30} lineWidth={3}>
            {chain.map((c, i) => (
              <Timeline.Item key={c.id} bullet={i === 0 ? <IconFish size={16} /> : <IconPackage size={16} />} title={<Text fw={700} size="sm">{i === 0 ? '水揚げ（個体）' : '加工'}：{c.name}</Text>}>
                <Text size="xs" c="dimmed">{c.attrs.find(([k]) => k === '加工者' || k === '水揚げ港')?.[1]}</Text>
                <Text size="xs" ff="monospace" c="dimmed">{c.id}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Box>
      </Paper>
    </Stack>
  )
}

// 元の1尾から今の商品まで、すべての記録を照合する
function useVerifyAll(chain) {
  const [res, setRes] = useState(null)
  const key = chain.map((c) => `${c.id}:${c.rawEvents.length}`).join('|')
  useEffect(() => {
    if (!chain.length) return
    let alive = true
    setRes(null)
    Promise.all(chain.map((c) => verifyItem(c.rawEvents)))
      .then((rs) => alive && setRes({ ok: rs.every((r) => r.ok), onchain: rs.every((r) => r.onchain) }))
      .catch(() => alive && setRes({ ok: false, onchain: false }))
    return () => { alive = false }
  }, [key])
  return res
}

function App() {
  const qid = new URLSearchParams(location.search).get('id') // QRから開いたとき
  const [db, setDb] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [me, setMe] = useState(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [sel, setSel] = useState(qid)
  const [view, setView] = useState(qid ? 'consumer' : 'manage')

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

  return (
    <AppShell header={{ height: { base: 120, sm: 72 } }} padding="lg">
      <AppShell.Header px="lg" style={{ background: '#13212B', borderBottom: 0 }}>
        <Group h="100%" justify="space-between" wrap="wrap" py="xs">
          <Group gap="sm">
            <ThemeIcon size={40} radius="xl"><IconFish size={22} /></ThemeIcon>
            <div>
              <Text fw={700} c="white" size="lg">浜の履歴書</Text>
              <Text size="xs" c="#B9C6CC">1尾ごとのIDに情報を追記し、加工品は親IDでたどる</Text>
            </div>
          </Group>
          <Group gap="sm">
            <SegmentedControl value={view} onChange={setView} size="md"
              data={[{ value: 'manage', label: <Group gap={6} wrap="nowrap"><IconDatabase size={18} /><span>ID管理（事業者）</span></Group> },
                { value: 'consumer', label: <Group gap={6} wrap="nowrap"><IconUserSearch size={18} /><span>消費者が見る画面</span></Group> }]} />
            {view === 'manage' && (me
              ? <Group gap={6}>
                  <Text size="sm" c="white">{me.business?.name ?? me.email}</Text>
                  <Button size="xs" variant="subtle" color="gray.3" leftSection={<IconLogout size={14} />} onClick={signOut}>ログアウト</Button>
                </Group>
              : <Button size="sm" variant="light" leftSection={<IconLogin size={16} />} onClick={() => setLoginOpen(true)}>ログイン</Button>)}
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main bg="#F3F5F4">
        <Box py="md">
          {loadErr ? <Alert color="red" icon={<IconAlertTriangle />} title="データを読み込めませんでした" maw={720} mx="auto">{loadErr}</Alert>
            : !items ? <Center mih={300}><Loader /></Center>
            : view === 'manage' ? <Manager items={items} db={db} sel={sel} setSel={setSel} reload={reload} guard={guard} />
            : <ConsumerView items={items} sel={sel} setSel={setSel} />}
          {!chainEnabled && view === 'manage' && items && (
            <Text size="xs" c="dimmed" ta="center" mt="lg">ブロックチェーン未接続（記録とハッシュはDBに保存しています）</Text>
          )}
        </Box>
      </AppShell.Main>
      <LoginModal opened={loginOpen} onClose={() => setLoginOpen(false)} />
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <MantineProvider theme={theme}>
    <Notifications position="top-right" />
    <App />
  </MantineProvider>
)
