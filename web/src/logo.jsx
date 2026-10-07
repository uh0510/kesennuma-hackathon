// 魚籍のしるし：重さの内訳で使っているマグロの形（consumer.jsx の FISH.tuna）を影絵にしたもの
// ヘッダー・ログイン・ラベルの QR の真ん中に、同じ形を使う
import React from 'react'

const BODY = 'M18,80 C30,58 80,40 160,37 C240,35 300,52 338,70 L362,58 L396,22 L384,80 L396,138 L362,102 L338,90 C300,108 240,124 160,123 C80,121 30,102 18,80 Z'
// 背びれ・尻びれ・小さなひれ（胸びれは胴に重なるので入れない）
const FINS = ['M140,39 L172,6 L190,37 Z', 'M250,44 L268,24 L278,48 Z', 'M258,116 L274,140 L284,112 Z',
  'M292,52 L298,42 L302,54 Z', 'M306,58 L312,48 L316,60 Z', 'M320,64 L326,54 L330,66 Z', 'M292,108 L298,118 L302,106 Z', 'M306,102 L312,112 L316,100 Z']
const VB = '10 0 392 150'

// 魚の影絵（色は color、目は eye の色でくり抜いたように見せる）
export function FishMark({ width = 24, color = 'currentColor', eye = 'transparent' }) {
  return (
    <svg viewBox={VB} width={width} height={(width * 150) / 392} aria-hidden style={{ display: 'block' }}>
      {FINS.map((d) => <path key={d} d={d} fill={color} />)}
      <path d={BODY} fill={color} />
      <circle cx="46" cy="74" r="9" fill={eye} />
    </svg>
  )
}

// 角の丸い四角に白い魚（ヘッダー・ログイン）。地の色は見た目（look）ごとに CSS の .logo-tile で決める
export function LogoTile({ size = 32 }) {
  return (
    <div className="logo-tile" style={{ width: size, height: size, borderRadius: size * 0.28 }}>
      <FishMark width={size * 0.8} color="#fff" eye="var(--logo-eye)" />
    </div>
  )
}

// ラベルの QR の真ん中に置く画像（白地に紺の魚）。QR は誤り訂正を H にして使う
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#fff"/>`
  + `<g transform="translate(6 33) scale(0.224)">${FINS.map((d) => `<path d="${d}" fill="#0b2a3a"/>`).join('')}<path d="${BODY}" fill="#0b2a3a"/>`
  + `<circle cx="46" cy="74" r="10" fill="#fff"/></g></svg>`
export const QR_LOGO = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
// QRCodeSVG に渡す設定（size は QR の一辺）
export const qrLogo = (size) => ({ level: 'H', imageSettings: { src: QR_LOGO, width: Math.round(size * 0.24), height: Math.round(size * 0.24), excavate: true } })
