// 消費者画面の「改ざんチェック」：見る人が自分で記録の数字を書き換えて、その場で見破られるのを確かめる
// 書き換えは画面の中の写しで行う（実際の記録は変わらない）
//   重さを書き換える         → 記録のつながりが切れ、ブロックチェーンの控えとも合わない
//   つながりも作り直す       → データベースの中では辻褄が合うが、ブロックチェーンの控えと合わない
import React, { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { IconLink, IconMinus, IconPlus } from '@tabler/icons-react'
import { eventHash } from './lib/hash.js'
import { latestHashOnChain, explorerTx } from './api.js'
import { shortHash } from './model.js'
import { EV_LABEL } from './i18n.jsx'
import { useLook } from './theme.js'

const createdAt = (e) => new Date(e.created_at).toISOString()
const hashOf = (x, prevHash) => eventHash({ itemId: x.item_id, type: x.type, actor: x.actor, payload: x.payload, prevHash, createdAt: createdAt(x) })

// 書き換える記録：元の魚の、重さのある最初の記録（ふつうは水揚げ）
function pickTarget(groups) {
  for (let gi = 0; gi < groups.length; gi++) {
    const ei = groups[gi].events.findIndex((e) => Number(e.payload?.weight_kg) > 0)
    if (ei >= 0) return { gi, ei }
  }
  return { gi: 0, ei: 0 }
}

// 写しで指紋を計算し直し、記録どうし・ブロックチェーンの値と照らし合わせる
async function check(groups, target, tamper, latest) {
  const copy = groups.map((g) => g.events.map((e) => ({ ...e, payload: structuredClone(e.payload ?? {}) })))
  if (tamper) {
    const x = copy[target.gi][target.ei]
    if (tamper.kg != null) x.payload.weight_kg = tamper.kg
    else x.payload.detail = `${x.payload.detail ?? ''}*`
    // つながりも作り直す：書き換えた記録から先の指紋を差し替える
    if (tamper.rehash) {
      let prev = target.ei > 0 ? copy[target.gi][target.ei - 1].hash : null
      for (const y of copy[target.gi].slice(target.ei)) { y.hash = await hashOf(y, prev); prev = y.hash }
    }
  }
  const rows = []
  const ends = []
  for (let gi = 0; gi < copy.length; gi++) {
    let prev = null
    const computed = []
    for (const x of copy[gi]) { const h = await hashOf(x, prev); computed.push(h); prev = h }
    rows.push(computed.map((h, ei) => ({ hash: h, ok: h === copy[gi][ei].hash })))
    // ブロックチェーンの値：最後の記録の指紋（書き込み中なら、届いている記録の指紋）と比べる
    const on = latest[gi]
    const j = on ? groups[gi].events.findIndex((e) => e.hash.toLowerCase() === on) : -1
    ends.push(on === undefined ? { status: 'error' } : !on ? { status: 'none' }
      : { status: j >= 0 && computed[j] === on ? 'ok' : 'ng', onchain: on, computed: computed[j >= 0 ? j : computed.length - 1], pending: j >= 0 && j < computed.length - 1 })
  }
  return { rows, ends }
}

export function ProofLab({ chain, t, lang, when }) {
  const reduce = useReducedMotion()
  const [look] = useLook()
  const groups = useMemo(() => chain.map((c) => ({ item: c, events: [...c.rawEvents].sort((a, b) => a.id - b.id), tx: Object.fromEntries(c.events.map((e) => [e.id, e.tx])) })), [chain])
  const target = useMemo(() => pickTarget(groups), [groups])
  const targetEv = groups[target.gi]?.events[target.ei]
  const baseKg = Number(targetEv?.payload?.weight_kg) > 0 ? Number(targetEv.payload.weight_kg) : null
  const total = groups.reduce((n, g) => n + g.events.length, 0)

  const [kg, setKg] = useState('') // 入力中の重さ（文字のまま持つ）
  const [touched, setTouched] = useState(false) // 重さのない記録を書き換えたか
  const [rehash, setRehash] = useState(false)
  const [latest, setLatest] = useState(null)
  const [res, setRes] = useState(null)

  useEffect(() => { setKg(baseKg == null ? '' : String(baseKg)); setTouched(false); setRehash(false) }, [groups, baseKg])
  // ブロックチェーンの値は1回だけ読む
  useEffect(() => {
    let live = true
    Promise.all(groups.map((g) => latestHashOnChain(g.item.id).catch(() => undefined))).then((v) => live && setLatest(v))
    return () => { live = false }
  }, [groups])

  const kgNum = Number(kg)
  const edited = baseKg != null ? kg !== '' && Number.isFinite(kgNum) && kgNum !== baseKg : touched
  const tamper = edited ? { kg: baseKg != null ? kgNum : null, rehash } : null
  useEffect(() => {
    if (!latest) return
    let live = true
    check(groups, target, tamper, latest).then((r) => live && setRes(r))
    return () => { live = false }
  }, [groups, target, latest, edited, kgNum, rehash])

  const reset = () => { setKg(baseKg == null ? '' : String(baseKg)); setTouched(false); setRehash(false) }
  const step = (d) => setKg((v) => String(Math.max(0, Math.round(((Number(v) || baseKg) + d) * 10) / 10)))

  const rowsOk = res?.rows.every((r) => r.every((x) => x.ok))
  const chainNg = res?.ends.some((x) => x.status === 'ng')
  const chainOk = res?.ends.every((x) => x.status === 'ok')
  const verdict = !res ? 'wait' : rowsOk && chainOk ? 'ok' : !rowsOk || chainNg ? 'ng' : 'none'
  const title = { wait: t.labWait, ok: t.labOk, ng: edited ? t.labCaught : t.labSuspect, none: t.labNoChain }[verdict]
  const chainStatus = !res ? null : chainOk ? 'ok' : chainNg ? 'ng' : 'na'
  const chainNote = res?.ends.some((x) => x.pending) ? t.labPending : res?.ends.some((x) => x.status === 'none') ? t.labNone : res?.ends.some((x) => x.status === 'error') ? t.labError : null
  const evName = (e) => (EV_LABEL[e.type] ? (lang === 'en' ? EV_LABEL[e.type].en : EV_LABEL[e.type].ja) : e.type === 'process' ? t.evProcess : e.type === 'activate' ? t.evActivate : e.type)

  return (
    <div className="lab">
      <div className="lab-card">
        <div className="lab-try">
          <div className="lab-try-label">{t.labTry}</div>
          {baseKg != null ? (
            <div className="lab-field">
              <span className="lab-field-name">{t.labField(targetEv ? evName(targetEv) : '')}</span>
              <div className="lab-stepper" data-edited={edited || undefined}>
                <button type="button" aria-label="−1 kg" onClick={() => step(-1)}><IconMinus size={16} /></button>
                <input type="number" inputMode="decimal" min="0" step="0.1" value={kg} aria-label={t.labField(targetEv ? evName(targetEv) : '')}
                  onChange={(e) => setKg(e.target.value)} />
                <span className="lab-unit">kg</span>
                <button type="button" aria-label="+1 kg" onClick={() => step(1)}><IconPlus size={16} /></button>
              </div>
            </div>
          ) : (
            <button type="button" className="lab-btn" disabled={touched} onClick={() => setTouched(true)}>{t.labTouch}</button>
          )}
          {edited && (
            <div className="lab-actions">
              <button type="button" className="lab-btn" disabled={rehash} onClick={() => setRehash(true)}>{t.labRehash}</button>
              <button type="button" className="lab-btn ghost" onClick={reset}>{t.labReset}</button>
            </div>
          )}
          <p className="lab-note">{t.labLocal}</p>
        </div>

        <div className="lab-verdict" data-v={verdict} aria-live="polite">
          {/* 印を押し直す（判定が変わるたびに上から押される） */}
          <motion.span key={`${verdict}${edited}${rehash}`} className="lab-stamp-wrap" aria-hidden
            initial={reduce || verdict === 'wait' ? false : { scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 22 }}>
            <span className="lab-stamp">{verdict === 'ok' ? (look === 'sea' ? '検' : '✓') : verdict === 'wait' ? '…' : '!'}</span>
          </motion.span>
          <div className="lab-verdict-body">
            <b>{title}</b>
            <dl className="lab-checks">
              <div data-s={!res ? undefined : rowsOk ? 'ok' : 'ng'}><dt>{t.labLink}</dt><dd>{!res ? '…' : rowsOk ? t.labLinkOk : t.labLinkNg}</dd></div>
              <div data-s={chainStatus ?? undefined}><dt>{t.labChain}</dt><dd>{!res ? '…' : chainOk ? t.labMatch : chainNg ? t.labMismatch : t.labNoChain}</dd></div>
            </dl>
            {chainNote && <small>{chainNote}</small>}
          </div>
        </div>
      </div>

      <details className="lab-details">
        <summary>{t.labDetails(total)}</summary>
        <div className="lab-chain">
          {groups.map((g, gi) => (
            <div key={g.item.id} className="lab-group">
              <div className="lab-item">{g.item.name}<code>{g.item.id}</code></div>
              {g.events.map((e, ei) => {
                const r = res?.rows[gi][ei]
                const isTarget = edited && target.gi === gi && target.ei === ei
                return (
                  <div key={e.id} className="lab-row" data-s={r ? (r.ok ? 'ok' : 'ng') : undefined} data-edited={isTarget || undefined}>
                    <span className="lab-dot" aria-hidden />
                    <div className="lab-body">
                      <div className="lab-head"><b>{evName(e)}</b><span>{when(e.created_at)}</span></div>
                      {isTarget && tamper.kg != null && <div className="lab-edit">{t.labWeight} {baseKg} kg → <b>{tamper.kg} kg</b></div>}
                      <div className="lab-hash">
                        <code>{shortHash(r?.hash ?? e.hash)}</code>
                        {r && !r.ok && <span className="lab-bad">{t.labMismatch}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
              <ChainEnd end={res?.ends[gi]} tx={g.tx[g.events.at(-1)?.id]} t={t} />
            </div>
          ))}
        </div>
      </details>
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
          {s === 'ng' && <span className="lab-bad">{t.labMismatch}</span>}
          {s === 'none' && <span className="lab-na">{t.labNone}</span>}
          {s === 'error' && <span className="lab-na">{t.labError}</span>}
          {tx && <a className="hb-tx" href={explorerTx(tx)} target="_blank" rel="noreferrer"><IconLink size={12} /> {t.viewOnChain}</a>}
        </div>
      </div>
    </div>
  )
}
