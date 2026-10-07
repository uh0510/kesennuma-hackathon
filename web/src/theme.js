// 見た目の切り替え
// 'sea'＝気仙沼の海（海の青・朱の検印・明朝の見出し） / 'classic'＝黒（Apple 風。前からの見た目）
// 選んだものは端末に覚える。URL の ?look=classic でも切り替えられる（デモで見比べる用）
import { useEffect, useState } from 'react'

const KEY = 'gyoseki-look'
export const LOOKS = ['sea', 'classic']

function initial() {
  const q = new URLSearchParams(location.search).get('look')
  if (LOOKS.includes(q)) return q
  try { const v = localStorage.getItem(KEY); if (LOOKS.includes(v)) return v } catch { /* 保存できない端末でも動かす */ }
  return 'sea'
}

let look = initial()
const subs = new Set()
const apply = (v) => { document.documentElement.dataset.look = v }
apply(look)

export function setLook(v) {
  if (!LOOKS.includes(v)) return
  look = v
  try { localStorage.setItem(KEY, v) } catch { /* 覚えられなくても切り替えはする */ }
  apply(v)
  subs.forEach((f) => f(v))
}

export function useLook() {
  const [v, set] = useState(look)
  useEffect(() => { subs.add(set); set(look); return () => { subs.delete(set) } }, [])
  return [v, setLook]
}

// CSS の変数の値（地図の線の色など、JS で色を渡す所で使う）
export const cssVar = (el, name, fallback) => (el ? getComputedStyle(el).getPropertyValue(name).trim() : '') || fallback
