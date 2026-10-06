// はかり：自分の鍵を持ち、量った重さと日時に署名する（record-event が同じ文で確かめる）
// 鍵はこのブラウザ（はかりの端末）にだけ置く。試作なので localStorage（本番は端末の安全な保管場所に）
import { ethers } from 'ethers'

const KEY = 'gyoseki-scale-key'
const LAST = 'gyoseki-scale-last'
export const scaleMessage = (id, kg, at) => `GYOSEKI-SCALE|${id}|${kg}|${at}`
export const scaleRegisterMessage = (address) => `GYOSEKI-SCALE-REGISTER|${address.toLowerCase()}`
// 量ってから使えるまでの時間（record-event と同じ）
export const SCALE_MAX_AGE = 30 * 60 * 1000

const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* 保存できなくても続ける */ } },
}

// はかりの鍵（なければ作る）
export function scaleWallet() {
  const pk = store.get(KEY)
  if (pk) return new ethers.Wallet(pk)
  const w = ethers.Wallet.createRandom()
  store.set(KEY, w.privateKey)
  return new ethers.Wallet(w.privateKey)
}

// 量った重さに署名する。QR に入れる形（短い名前）で返す
export async function signReading(kg) {
  const w = scaleWallet()
  const id = ethers.hexlify(ethers.randomBytes(8)).slice(2)
  const at = new Date().toISOString()
  const value = Number(kg)
  const reading = { t: 'gyoseki-scale', id, kg: value, at, a: w.address.toLowerCase(), s: await w.signMessage(scaleMessage(id, value, at)) }
  store.set(LAST, JSON.stringify(reading))
  return reading
}

export const signRegister = async () => {
  const w = scaleWallet()
  return { address: w.address.toLowerCase(), sig: await w.signMessage(scaleRegisterMessage(w.address)) }
}

// QR の文字から読む（形が違えば null）。署名が合っているかも、ここで確かめておく（最後はサーバーが確かめる）
export function parseReading(text) {
  try {
    const r = JSON.parse(text)
    if (r?.t !== 'gyoseki-scale') return null
    const signer = ethers.verifyMessage(scaleMessage(r.id, r.kg, r.at), r.s).toLowerCase()
    return signer === String(r.a).toLowerCase() ? r : null
  } catch { return null }
}

// このブラウザのはかりで最後に量った値（30分以内のものだけ）
export function lastReading() {
  const r = parseReading(store.get(LAST) ?? '')
  return r && Date.now() - Date.parse(r.at) <= SCALE_MAX_AGE ? r : null
}

// 記録に送る形（t は送らない）
export const readingBody = (r) => (r ? { id: r.id, kg: r.kg, at: r.at, a: r.a, s: r.s } : null)
