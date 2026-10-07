// 消費者画面の「記録の証明」：その場で指紋を計算し直し、ブロックチェーンの値と照らし合わせる
// 書き換えの体験は画面の中の写しで行う（実際の記録は変わらない）
//   ① 中身だけを書き換える → その記録から先の指紋が合わなくなる
//   ② 指紋まで作り直す   → データベースの中では辻褄が合うが、ブロックチェーンの値と合わない
import React, { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { IconLink } from '@tabler/icons-react'
import { eventHash } from './lib/hash.js'
import { latestHashOnChain, explorerTx } from './api.js'
import { shortHash } from './model.js'
import { EV_LABEL } from './i18n.jsx'
import { useLook } from './theme.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const createdAt = (e) => new Date(e.created_at).toISOString()

// 書き換える記録：元の魚の、重さのある最初の記録（ふつうは水揚げ）
function pickTarget(groups) {
  for (let gi = 0; gi < groups.length; gi++) {
    const ei = groups[gi].events.findIndex((e) => Number(e.payload?.weight_kg) > 0)
    if (ei >= 0) return { gi, ei }
  }
  return { gi: 0, ei: 0 }
}

export function ProofLab({ chain, t, lang, when }) {
  const reduce = useReducedMotion()
  const [look] = useLook()
  const groups = chain.map((c) => ({ item: c, events: [...c.rawEvents].sort((a, b) => a.id - b.id), tx: Object.fromEntries(c.events.map((e) => [e.id, e.tx])) }))
  const total = groups.reduce((n, g) => n + g.events.length, 0)
  // rows[gi][ei]：null＝未計算 / { hash, ok }。ends[gi]：ブロックチェーンとの照合
  const blank = () => ({ rows: groups.map((g) => g.events.map(() => null)), ends: groups.map(() => null) })
  const [state, setState] = useState(blank)
  const [mode, setMode] = useState(null) // null / 'check' / 'edit' / 'rehash'
  const [running, setRunning] = useState(false)
  const [edit, setEdit] = useState(null) // 書き換えた記録 { gi, ei, from, to }
  const onchain = useRef(null)
  const run = useRef(0)

  // ブロックチェーンの値は1回だけ読む
  const loadOnchain = () => {
    if (!onchain.current) onchain.current = Promise.all(groups.map((g) => latestHashOnChain(g.item.id).catch(() => undefined)))
    return onchain.current
  }
  useEffect(() => () => { run.current++ }, [])

  async function start(m) {
    const my = ++run.current
    setMode(m); setRunning(true); setState(blank())
    // 写し（実際の記録には触らない）
    const copy = groups.map((g) => g.events.map((e) => ({ ...e, payload: structuredClone(e.payload ?? {}) })))
    let info = null
    if (m !== 'check') {
      const { gi, ei } = pickTarget(groups)
      const e = copy[gi][ei]
      const from = Number(e.payload.weight_kg)
      if (from > 0) { e.payload.weight_kg = Math.round((from + 20) * 10) / 10; info = { gi, ei, from, to: e.payload.weight_kg } }
      else { e.payload.detail = `${e.payload.detail ?? ''}*`; info = { gi, ei } }
      // ② 指紋まで作り直す：書き換えた記録から先の指紋を計算し直して差し替える
      if (m === 'rehash') {
        let prev = ei > 0 ? copy[gi][ei - 1].hash : null
        for (let i = ei; i < copy[gi].length; i++) {
          const x = copy[gi][i]
          x.hash = await eventHash({ itemId: x.item_id, type: x.type, actor: x.actor, payload: x.payload, prevHash: prev, createdAt: createdAt(x) })
          prev = x.hash
        }
      }
    }
    setEdit(info)
    const latest = await loadOnchain()
    const step = reduce ? 0 : Math.max(60, Math.min(220, 2400 / Math.max(1, total)))
    for (let gi = 0; gi < copy.length; gi++) {
      let prev = null
      const computed = []
      for (let ei = 0; ei < copy[gi].length; ei++) {
        const x = copy[gi][ei]
        const h = await eventHash({ itemId: x.item_id, type: x.type, actor: x.actor, payload: x.payload, prevHash: prev, createdAt: createdAt(x) })
        computed.push(h); prev = h
        if (run.current !== my) return
        setState((s) => { const rows = s.rows.map((r) => [...r]); rows[gi][ei] = { hash: h, ok: h === x.hash }; return { ...s, rows } })
        if (step) await wait(step)
      }
      // ブロックチェーンの値：最後の記録の指紋（書き込み中なら、届いている記録の指紋）と比べる
      const on = latest[gi]
      const j = on ? groups[gi].events.findIndex((e) => e.hash.toLowerCase() === on) : -1
      const end = on === undefined ? { status: 'error' } : !on ? { status: 'none' }
        : { status: j >= 0 && computed[j] === on ? 'ok' : 'ng', onchain: on, computed: computed[j >= 0 ? j : computed.length - 1], pending: j >= 0 && j < computed.length - 1 }
      if (run.current !== my) return
      setState((s) => { const ends = [...s.ends]; ends[gi] = end; return { ...s, ends } })
      if (step) await wait(step * 2)
    }
    setRunning(false)
  }

  const reset = () => { run.current++; setMode(null); setRunning(false); setEdit(null); setState(blank()) }
  const done = mode && !running
  const rowsOk = state.rows.every((r) => r.every((x) => x?.ok))
  const endsOk = state.ends.every((x) => x?.status === 'ok')
  const verdict = !done ? null
    : rowsOk && endsOk ? 'ok'
      : !rowsOk ? 'broken'
        : state.ends.some((x) => x?.status === 'ng') ? 'chain'
          : 'none'
  const evName = (e) => (EV_LABEL[e.type] ? (lang === 'en' ? EV_LABEL[e.type].en : EV_LABEL[e.type].ja) : e.type === 'process' ? t.evProcess : e.type === 'activate' ? t.evActivate : e.type)

  return (
    <div className="lab">
      <div className="lab-actions">
        <button type="button" className="lab-btn primary" disabled={running} onClick={() => start('check')}>{t.labCheck}</button>
        <button type="button" className="lab-btn" disabled={running} onClick={() => start('edit')}>{t.labEdit}</button>
        <button type="button" className="lab-btn" disabled={running} onClick={() => start('rehash')}>{t.labRehash}</button>
        {mode && <button type="button" className="lab-btn ghost" disabled={running} onClick={reset}>{t.labReset}</button>}
      </div>
      <p className="lab-note">{mode === 'edit' ? t.labEditNote : mode === 'rehash' ? t.labRehashNote : t.labNote}</p>

      <div className="lab-chain">
        {groups.map((g, gi) => (
          <div key={g.item.id} className="lab-group">
            <div className="lab-item">{g.item.name}<code>{g.item.id}</code></div>
            {g.events.map((e, ei) => {
              const r = state.rows[gi][ei]
              const edited = edit && edit.gi === gi && edit.ei === ei
              return (
                <div key={e.id} className="lab-row" data-s={r ? (r.ok ? 'ok' : 'ng') : undefined} data-edited={edited || undefined}>
                  <span className="lab-dot" aria-hidden />
                  <div className="lab-body">
                    <div className="lab-head"><b>{evName(e)}</b><span>{when(e.created_at)}</span></div>
                    {edited && edit.to != null && <div className="lab-edit">{t.labWeight} {edit.from} kg → <b>{edit.to} kg</b>（{t.labEdited}）</div>}
                    <div className="lab-hash">
                      <code>{shortHash(r?.hash ?? e.hash)}</code>
                      {r && !r.ok && <span className="lab-bad">{t.labMismatch}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
            <ChainEnd end={state.ends[gi]} tx={g.tx[g.events.at(-1)?.id]} t={t} />
          </div>
        ))}
      </div>

      {verdict && (
        <motion.div className="lab-verdict" data-v={verdict} initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <span className="lab-stamp" aria-hidden>{verdict === 'ok' ? (look === 'sea' ? '検' : t.labStampOk) : '!'}</span>
          <div>
            <b>{t.labVerdict[verdict]}</b>
            <small>{verdict === 'ok' ? t.labVerdictOkSub(total) : mode === 'check' ? t.labVerdictRealSub : t.labVerdictSub[verdict]}</small>
          </div>
        </motion.div>
      )}
    </div>
  )
}

function ChainEnd({ end, tx, t }) {
  const s = end?.status
  return (
    <div className="lab-row lab-end" data-s={s === 'ok' ? 'ok' : s === 'ng' ? 'ng' : s ? 'na' : undefined}>
      <span className="lab-dot" aria-hidden />
      <div className="lab-body">
        <div className="lab-head"><b>{t.labChain}</b>{end?.pending && <span>{t.labPending}</span>}</div>
        <div className="lab-hash">
          {s === 'ng' && <><code className="lab-calc">{t.labCalc} {shortHash(end.computed)}</code><span className="lab-bad">≠</span></>}
          {end?.onchain && <code className="lab-on">{s === 'ng' ? `${t.labOnchain} ` : ''}{shortHash(end.onchain)}</code>}
          {s === 'ok' && <span className="lab-good">{t.labMatch}</span>}
          {s === 'ng' && <span className="lab-bad">{t.labChainMismatch}</span>}
          {s === 'none' && <span className="lab-na">{t.labNone}</span>}
          {s === 'error' && <span className="lab-na">{t.labError}</span>}
          {tx && <a className="hb-tx" href={explorerTx(tx)} target="_blank" rel="noreferrer"><IconLink size={12} /> {t.viewOnChain}</a>}
        </div>
      </div>
    </div>
  )
}
