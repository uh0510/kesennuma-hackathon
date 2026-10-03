// 不正対策のチェック（画面とサーバーの両方で使う）

// 重量の整合チェック：子の合計が親を超えていないか、歩留まりの範囲内か
// yieldMin / yieldMax は製品マスタの値（例 0.55 / 0.70）。未設定なら範囲チェックはしない
export function checkWeight({ parentKg, childrenKg, newKg, yieldMin, yieldMax }) {
  const total = childrenKg.reduce((a, b) => a + b, 0) + newKg.reduce((a, b) => a + b, 0)
  const ratio = parentKg > 0 ? total / parentKg : 0
  const issues = []
  if (total > parentKg) issues.push({ level: 'error', message: `子の重量の合計（${total.toFixed(1)}kg）が親（${parentKg}kg）を超えています` })
  if (yieldMax != null && ratio > yieldMax) issues.push({ level: 'warning', message: `歩留まり ${(ratio * 100).toFixed(0)}% が上限 ${(yieldMax * 100).toFixed(0)}% を超えています` })
  if (yieldMin != null && ratio < yieldMin && newKg.length > 0) issues.push({ level: 'info', message: `歩留まり ${(ratio * 100).toFixed(0)}%（下限 ${(yieldMin * 100).toFixed(0)}%）。残りがあれば続けて登録してください` })
  return { ok: !issues.some((i) => i.level === 'error'), total, ratio, issues }
}

// 子IDの採番：個体の子は P01…、加工品の子は K01…
export function childIds(parentId, isIndividual, existingCount, n) {
  const prefix = isIndividual ? 'P' : 'K'
  return Array.from({ length: n }, (_, i) => `${parentId}-${prefix}${String(existingCount + i + 1).padStart(2, '0')}`)
}
