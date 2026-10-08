// 魚の立体（消費者の画面）：魚種ごとのデフォルメの形を、記録した体長の大きさにして人（170cm）と並べる
// 太さは「体長に対して重いか軽いか」（肥満度）で少し変える。ドラッグで回せる（地球儀のように裏側まで）
// three.js は使わず、WebGL を直接使う（画面のファイルを重くしないため）
import React, { useEffect, useRef, useState } from 'react'

// ---- 魚種ごとの形と色 ----
// a・b：体の太さの分布（a が大きいほど尾の付け根が細い、b が小さいほど鼻先が丸い）
// H：いちばん太いところの半分の高さ（体長に対して。実物より太めにしてデフォルメ）、W：幅÷高さ
// kref：その魚のふつうの肥満度（重さg×100÷体長cm³）。これより重ければ太く、軽ければ細く
const TUNA = {
  a: 0.85, b: 0.5, H: 0.17, W: 0.78, kref: 2.0, eye: 0.042,
  back: [0.10, 0.16, 0.32], mid: [0.42, 0.52, 0.64], belly: [0.92, 0.94, 0.96], fin: [0.30, 0.38, 0.56], finlet: [0.96, 0.80, 0.24],
  dorsal2: [[0.33, 0.1]], tail: 0.22,
}
const SPECIES = {
  'クロマグロ': TUNA,
  'ミナミマグロ': { ...TUNA, back: [0.12, 0.17, 0.28] },
  'メバチ': { ...TUNA, H: 0.185, eye: 0.058, back: [0.10, 0.14, 0.36], mid: [0.30, 0.42, 0.66] },
  'キハダ': { ...TUNA, H: 0.155, band: [0.98, 0.80, 0.25], fin: [0.95, 0.78, 0.22], dorsal2: [[0.27, 0.24]] },
  'カツオ': { ...TUNA, H: 0.175, kref: 1.8, back: [0.16, 0.18, 0.40], stripes: true },
  'メカジキ': {
    a: 0.75, b: 0.55, H: 0.13, W: 0.8, kref: 1.3, eye: 0.04,
    back: [0.18, 0.16, 0.28], mid: [0.44, 0.42, 0.55], belly: [0.82, 0.80, 0.88], fin: [0.34, 0.31, 0.46],
    bill: 0.38, sail: true, tail: 0.26,
  },
  'ヨシキリザメ': {
    a: 0.6, b: 0.75, H: 0.11, W: 0.85, kref: 0.55, eye: 0.026,
    back: [0.18, 0.40, 0.76], mid: [0.42, 0.62, 0.88], belly: [0.95, 0.96, 0.98], fin: [0.26, 0.48, 0.82],
    shark: true,
  },
}

// ---- 形を作る道具 ----
function makeMesh() { return { P: [], N: [], C: [], I: [] } }
function vtx(m, p, c) { m.P.push(p[0], p[1], p[2]); m.N.push(0, 0, 0); m.C.push(c[0], c[1], c[2], c[3] ?? 1); return m.P.length / 3 - 1 }
// 面の向きから頂点の向きを出す（面積で重みづけ）。向きの表裏は描くときに直す
function computeNormals(m, from = 0) {
  const { P, N, I } = m
  for (let k = from; k < I.length; k += 3) {
    const [a, b, c] = [I[k] * 3, I[k + 1] * 3, I[k + 2] * 3]
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]]
    const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    for (const i of [a, b, c]) { N[i] += n[0]; N[i + 1] += n[1]; N[i + 2] += n[2] }
  }
}
// 筒（体・人）：rows×cols の網。cols はぐるりと閉じる
function addTube(m, rows, cols, pos, col) {
  const from = m.I.length
  const base = m.P.length / 3
  for (let i = 0; i <= rows; i++) for (let j = 0; j < cols; j++) { const th = (j / cols) * Math.PI * 2; vtx(m, pos(i / rows, th), col(i / rows, th)) }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = base + i * cols + j, b = base + i * cols + ((j + 1) % cols), c = a + cols, d = b + cols
    m.I.push(a, c, b, b, c, d)
  }
  computeNormals(m, from)
}
function addSphere(m, c, r, color, seg = 16, squash = [1, 1, 1]) {
  addTube(m, seg, seg * 2, (u, th) => {
    const ph = u * Math.PI
    return [c[0] + r * squash[0] * Math.cos(ph) * -1, c[1] + r * squash[1] * Math.sin(ph) * Math.sin(th), c[2] + r * squash[2] * Math.sin(ph) * Math.cos(th)]
  }, () => color)
}
// ひれ：外形の点を中心から扇形に張る
function addFan(m, center, pts, color) {
  const from = m.I.length
  const c = vtx(m, center, color)
  const ids = pts.map((p) => vtx(m, p, color))
  for (let k = 0; k < ids.length - 1; k++) m.I.push(c, ids[k], ids[k + 1])
  computeNormals(m, from)
}
const mix = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k)
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }

// ---- 魚（体長 1 の単位で作り、あとで大きさをかける）----
// x：尾の付け根 0 → 鼻先 1、y：上、z：幅
function buildFish(m, S, girth) {
  const tm = S.a / (S.a + S.b)
  const peak = tm ** S.a * (1 - tm) ** S.b
  const R = S.H * girth
  const h = (t) => R * (Math.max(t, 0) ** S.a * Math.max(1 - t, 0) ** S.b) / peak
  const w = (t) => h(t) * S.W
  const color = (t, th) => {
    const yn = Math.sin(th)
    let c = mix(S.belly, mix(S.mid, S.back, smooth(0.35, 0.75, yn)), smooth(-0.25, 0.2, yn))
    if (S.band) c = mix(c, S.band, Math.max(0, 1 - Math.abs(yn - 0.12) / 0.1) * smooth(0.25, 0.4, t) * (1 - smooth(0.85, 0.95, t)) * 0.8)
    if (S.stripes && yn < -0.05) c = mix(c, [0.25, 0.27, 0.40], (Math.cos(yn * 26) > 0.55 ? 0.7 : 0) * smooth(0.2, 0.35, t) * (1 - smooth(0.8, 0.9, t)))
    if (S.shark && t > 0.93) c = mix(c, S.back, 0.3)
    return c
  }
  // 体
  addTube(m, 72, 36, (t, th) => [t, h(t) * Math.sin(th) + (S.shark ? (1 - t) * -0.01 : 0), w(t) * Math.cos(th)], color)

  const top = (t) => h(t) - 0.006
  // 背びれ・しりびれ：付け根（t1〜t2）の背に沿った点と、先の点から作る
  const fin = (t1, t2, tips, dir, c) => {
    const pts = []
    for (let k = 0; k <= 6; k++) { const t = t2 - ((t2 - t1) * k) / 6; pts.push([t, dir * top(t), 0]) }
    // 付け根を前→後ろへたどり、先の点を後ろ→前へたどって閉じる
    for (const [tx, dy] of [...tips].sort((p, q) => p[0] - q[0])) pts.push([tx, dir * (top(tx) + dy), 0])
    pts.push(pts[0])
    addFan(m, [(t1 + t2) / 2, dir * (top((t1 + t2) / 2) - 0.02), 0], pts, c)
  }
  // 胸びれ：横腹から後ろへ、少し下・外へ
  const pect = (t0, len, wid, droop) => {
    for (const side of [1, -1]) {
      const o = [t0, -h(t0) * 0.25, side * w(t0) * 0.92]
      const U = [-1, -droop, side * 0.18]
      const V = [0, 1, side * 0.25]
      const at = (u, v) => o.map((x, i) => x + U[i] * u + V[i] * v)
      addFan(m, at(0.0, 0), [at(0, wid), at(len * 0.45, wid * 0.8), at(len, 0.0), at(len * 0.5, -wid * 0.5), at(0, -wid)], S.fin)
    }
  }

  if (S.shark) {
    fin(0.5, 0.62, [[0.47, 0.13]], 1, S.fin)
    fin(0.2, 0.24, [[0.18, 0.04]], 1, S.fin)
    fin(0.18, 0.22, [[0.16, 0.035]], -1, S.fin)
    pect(0.72, 0.26, 0.05, 0.55)
    // 尾びれ（上が長い）
    addFan(m, [0.02, 0, 0], [[0.03, 0.02, 0], [-0.08, 0.1, 0], [-0.24, 0.2, 0], [-0.16, 0.08, 0], [-0.1, 0.0, 0], [-0.12, -0.04, 0], [-0.07, -0.09, 0], [0.03, -0.02, 0]], S.fin)
  } else {
    if (S.sail) fin(0.66, 0.8, [[0.7, 0.24], [0.64, 0.12]], 1, S.fin)
    else {
      fin(0.52, 0.66, [[0.6, 0.12], [0.55, 0.09]], 1, S.fin)
      // 第2背びれ・しりびれ（後ろへ反る）
      for (const dir of [1, -1]) fin(0.36, 0.44, S.dorsal2, dir, S.fin)
      // 小離鰭（黄色い小さなひれ）
      for (let k = 0; k < 6; k++) {
        const t = 0.1 + k * 0.04
        for (const dir of [1, -1]) fin(t, t + 0.022, [[t - 0.012, 0.03]], dir, S.finlet)
      }
      // 腹びれ
      fin(0.68, 0.73, [[0.63, 0.05]], -1, S.fin)
    }
    pect(S.sail ? 0.78 : 0.74, S.sail ? 0.22 : 0.17, 0.035, 0.35)
    // 尾びれ（三日月形）
    const s = S.tail
    addFan(m, [0.02, 0, 0], [[0.03, 0.025, 0], [-0.04, s * 0.45, 0], [-0.14, s * 1.05, 0], [-0.1, s * 0.5, 0], [-0.06, 0, 0], [-0.1, -s * 0.5, 0], [-0.14, -s * 1.05, 0], [-0.04, -s * 0.45, 0], [0.03, -0.025, 0]], S.fin)
  }
  // 吻（メカジキの剣）：平たい円錐
  if (S.bill) {
    const r0 = h(0.985)
    addTube(m, 12, 16, (u, th) => [0.985 + u * S.bill, (1 - u) * r0 * 0.55 * Math.sin(th) + 0.01 * (1 - u), (1 - u) * r0 * 1.1 * Math.cos(th)], () => S.back)
  }
  // 目（白目・黒目・光）
  const te = S.shark ? 0.9 : S.bill ? 0.9 : 0.88
  const the = 0.32
  for (const side of [1, -1]) {
    const sy = h(te) * Math.sin(the), sz = w(te) * Math.cos(the) * side
    const out = [0.25, Math.sin(the), Math.cos(the) * side]
    const e = S.eye
    const c = [te, sy * 0.9, sz * 0.9]
    addSphere(m, c, e, S.shark ? [0.15, 0.16, 0.2] : [0.97, 0.97, 0.95], 10)
    if (!S.shark) addSphere(m, c.map((x, i) => x + out[i] * e * 0.45), e * 0.66, [0.05, 0.06, 0.09], 10)
    addSphere(m, c.map((x, i) => x + out[i] * e * (S.shark ? 0.8 : 0.95) + [0.0, e * 0.3, 0][i]), e * 0.2, [1, 1, 1], 6)
  }
  return { tailX: S.shark ? -0.24 : -0.14, noseX: 1 + (S.bill ?? 0), forkX: S.shark ? -0.1 : -0.06, h }
}

// 人（170cm）：つるりとした人形
function buildPerson(m, x, color) {
  const prof = [[0, 0.02], [0.02, 0.13], [0.7, 0.11], [0.8, 0.15], [1.2, 0.19], [1.33, 0.14], [1.4, 0.06], [1.42, 0.05]]
  const r = (y) => { for (let k = 1; k < prof.length; k++) if (y <= prof[k][0]) { const [y0, r0] = prof[k - 1], [y1, r1] = prof[k]; return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0) } return 0.05 }
  addTube(m, 30, 24, (u, th) => { const y = u * 1.42; return [x + r(y) * Math.cos(th), y, r(y) * 0.72 * Math.sin(th)] }, () => color)
  addSphere(m, [x, 1.56, 0], 0.14, color, 14)
}

// 影（床に落ちるぼかし）
function addShadow(m, cx, cz, rx, rz, a) {
  const c = vtx(m, [cx, 0.002, cz], [0, 0, 0, a])
  const n = 40
  const ids = []
  for (let k = 0; k <= n; k++) { const th = (k / n) * Math.PI * 2; ids.push(vtx(m, [cx + rx * Math.cos(th), 0.002, cz + rz * Math.sin(th)], [0, 0, 0, 0])) }
  for (let k = 0; k < n; k++) m.I.push(c, ids[k], ids[k + 1])
}

// 1尾の魚：体長（m）・重さ（kg）から作り、鼻先を上にして立てる（尾びれの先が床）
function standingFish(species, lengthM, kg) {
  const S = SPECIES[species] ?? TUNA
  const k = kg > 0 ? (kg * 1000 * 100) / (lengthM * 100) ** 3 : S.kref
  const girth = Math.min(1.25, Math.max(0.8, Math.sqrt(k / S.kref)))
  const mesh = makeMesh()
  const f = buildFish(mesh, S, girth)
  // 体長は鼻先から尾の切れ込みまで（メカジキは剣を除く）
  const s = lengthM / (1 - f.forkX)
  const base = 0.02
  const { P, N } = mesh
  let r = 0
  for (let i = 0; i < P.length; i += 3) {
    const [x, y, z] = [P[i], P[i + 1], P[i + 2]]
    P[i] = -y * s; P[i + 1] = (x - f.tailX) * s + base; P[i + 2] = z * s
    const [nx, ny] = [N[i], N[i + 1]]
    N[i] = -ny; N[i + 1] = nx
    r = Math.max(r, Math.hypot(P[i], P[i + 2]))
  }
  return { mesh, r, forkY: (f.forkX - f.tailX) * s + base, noseY: (1 - f.tailX) * s + base, topY: (f.noseX - f.tailX) * s + base }
}

// 場面：物差し｜人｜魚と体長の寸法線（何尾でも横に並べる）。人・魚はそれぞれその場で回る
// list：[{ species, lengthM, kg, label }]
function buildScene(list) {
  const person = makeMesh()
  buildPerson(person, 0, [0.74, 0.78, 0.83])
  const ground = makeMesh()
  addShadow(ground, 0, 0, 0.26, 0.22, 0.55)
  const rulerX = -0.6
  const objs = [{ mesh: person, x: 0 }]
  const dims = []
  // 1尾なら体長の文字は寸法線の横、2尾以上なら魚の上
  const beside = list.length === 1
  let cursor = 0.19 + 0.3
  let top = 1.7
  for (const it of list) {
    const f = standingFish(it.species, it.lengthM, it.kg)
    const x = cursor + f.r
    objs.push({ mesh: f.mesh, x })
    addShadow(ground, x, 0, Math.max(0.18, f.r * 0.55), Math.max(0.14, f.r * 0.4), 0.55)
    const dimX = x + f.r + 0.12
    dims.push({ x, left: x - f.r, dimX, forkY: f.forkY, noseY: f.noseY, topY: f.topY })
    cursor = dimX + (beside ? 0.75 : 0.35)
    top = Math.max(top, f.topY + (beside ? 0 : 0.25))
  }
  const left = rulerX - 0.3, right = cursor
  // 物差しの目盛りは 50cm 単位で切り上げ。いちばん上の「cm」の文字まで入る高さにする
  const maxCm = Math.ceil((Math.max(1.7, ...dims.map((d) => d.topY)) * 100) / 50) * 50
  const height = Math.max(top, maxCm / 100) + 0.2
  return {
    ground, objs, beside,
    cx: (left + right) / 2, cy: height / 2, half: (right - left) / 2, depth: Math.max(0.25, ...dims.map((d) => d.x - d.left)), height,
    ruler: { x: rulerX, maxCm, personX: 0.19, dims },
  }
}

// ---- 行列 ----
const persp = (fy, asp, n, f) => { const t = 1 / Math.tan(fy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0] }
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o }
const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1] }
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1] }
const trans = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const mat3 = (m) => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]

const VS = `attribute vec3 aP; attribute vec3 aN; attribute vec4 aC;
uniform mat4 uMV; uniform mat4 uPr; uniform mat3 uN;
varying vec3 vN; varying vec4 vC; varying vec3 vP;
void main() { vec4 p = uMV * vec4(aP, 1.0); vP = p.xyz; vN = uN * aN; vC = aC; gl_Position = uPr * p; }`
// 描き方：段のついた陰（アニメ調）＋縁の光
const FS = `precision mediump float;
varying vec3 vN; varying vec4 vC; varying vec3 vP;
uniform float uLit; uniform vec3 uRim;
void main() {
  if (uLit < 0.5) { gl_FragColor = vC; return; }
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 L = normalize(vec3(0.35, 0.85, 0.55));
  vec3 V = normalize(-vP);
  float d = dot(n, L) * 0.5 + 0.5;
  float toon = 0.5 + smoothstep(0.38, 0.46, d) * 0.32 + smoothstep(0.7, 0.76, d) * 0.18;
  float spec = smoothstep(0.93, 0.97, dot(n, normalize(L + V))) * 0.3;
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.5;
  gl_FragColor = vec4(vC.rgb * toon + spec + uRim * rim, 1.0);
}`

function start(canvas, overlay, scene, opts) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false })
  const g2 = overlay.getContext('2d')
  if (!gl || !g2) return null
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s }
  const prog = gl.createProgram()
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  gl.useProgram(prog)
  const loc = (n) => gl.getAttribLocation(prog, n)
  const U = Object.fromEntries(['uMV', 'uPr', 'uN', 'uLit', 'uRim'].map((n) => [n, gl.getUniformLocation(prog, n)]))
  const upload = (m) => {
    const mk = (data, target = gl.ARRAY_BUFFER) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b }
    return { p: mk(new Float32Array(m.P)), n: mk(new Float32Array(m.N)), c: mk(new Float32Array(m.C)), i: mk(new Uint16Array(m.I), gl.ELEMENT_ARRAY_BUFFER), count: m.I.length }
  }
  const ground = upload(scene.ground)
  const objs = scene.objs.map((o) => ({ ...upload(o.mesh), x: o.x }))
  const bind = (b) => {
    for (const [name, buf, size] of [['aP', b.p, 3], ['aN', b.n, 3], ['aC', b.c, 4]]) {
      const l = loc(name); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0)
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.i)
  }
  gl.enable(gl.DEPTH_TEST)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.uniform3fv(U.uRim, opts.rim)

  const view = { yaw: 0.6, pitch: 0.1 }
  let raf = 0, last = performance.now(), idleAt = 0, dragging = null, visible = true
  const fov = (30 * Math.PI) / 180
  function draw(now) {
    raf = 0
    const dt = Math.min(0.05, (now - last) / 1000); last = now
    if (!dragging && !opts.reduce && now > idleAt) view.yaw += dt * 0.5
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const cw = canvas.clientWidth, ch = canvas.clientHeight
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr)
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; overlay.width = w; overlay.height = h }
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    const asp = w / h
    const fx = 2 * Math.atan(Math.tan(fov / 2) * asp)
    // 横・縦にはみ出さない距離（回して手前に来た分も見込む）
    const dist = Math.max(scene.half / Math.tan(fx / 2), (scene.height * 0.55) / Math.tan(fov / 2)) + scene.depth
    const pr = persp(fov, asp, dist * 0.2, dist * 3)
    const base = mul(trans(0, 0, -dist), mul(rotX(view.pitch), trans(-scene.cx, -scene.cy, 0)))
    gl.uniformMatrix4fv(U.uPr, false, pr)
    // 影は先に、奥行きを書かずに重ねる
    gl.uniform1f(U.uLit, 0); gl.enable(gl.BLEND); gl.depthMask(false)
    gl.uniformMatrix4fv(U.uMV, false, base); gl.uniformMatrix3fv(U.uN, false, mat3(rotX(view.pitch)))
    bind(ground); gl.drawElements(gl.TRIANGLES, ground.count, gl.UNSIGNED_SHORT, 0)
    gl.uniform1f(U.uLit, 1); gl.disable(gl.BLEND); gl.depthMask(true)
    const spin = rotY(view.yaw)
    gl.uniformMatrix3fv(U.uN, false, mat3(mul(rotX(view.pitch), spin)))
    for (const o of objs) {
      gl.uniformMatrix4fv(U.uMV, false, mul(base, mul(trans(o.x, 0, 0), spin)))
      bind(o); gl.drawElements(gl.TRIANGLES, o.count, gl.UNSIGNED_SHORT, 0)
    }
    drawRuler(g2, mul(pr, base), cw, ch, dpr)
    if (visible && (!opts.reduce || dragging)) raf = requestAnimationFrame(draw)
  }

  // 物差しと寸法線（立体の上に重ねる平面の絵）
  function drawRuler(g, m, cw, ch, dpr) {
    const at = (x, y) => {
      const X = m[0] * x + m[4] * y + m[12], Y = m[1] * x + m[5] * y + m[13], W = m[3] * x + m[7] * y + m[15]
      return [((X / W + 1) / 2) * cw, ((1 - Y / W) / 2) * ch]
    }
    const r = scene.ruler
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, cw, ch)
    g.font = `600 12px ${opts.font}`
    g.lineWidth = 1
    // 物差し：10cm ごとに目盛り、50cm ごとに数字
    g.strokeStyle = opts.ink; g.fillStyle = opts.ink
    const [x0, y0] = at(r.x, 0)
    const [, yTop] = at(r.x, r.maxCm / 100)
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, yTop); g.stroke()
    g.textAlign = 'right'; g.textBaseline = 'middle'
    for (let cm = 0; cm <= r.maxCm; cm += 10) {
      const [x, y] = at(r.x, cm / 100)
      const big = cm % 50 === 0
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (big ? 10 : 5), y); g.stroke()
      if (big) g.fillText(String(cm), x - 6, y)
    }
    g.textAlign = 'center'; g.textBaseline = 'bottom'
    g.fillText('cm', x0, yTop - 8)
    // 点線（左右の端を世界の座標で）と、その上の文字
    const line = (y, xFrom, xTo, color, label) => {
      const [a, ya] = at(xFrom, y)
      const [b] = at(xTo, y)
      g.strokeStyle = color; g.fillStyle = color
      g.setLineDash([4, 4]); g.beginPath(); g.moveTo(a, ya); g.lineTo(b, ya); g.stroke(); g.setLineDash([])
      if (label) { g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(label, a + 14, ya - 4) }
    }
    // 人の背の高さ
    // 文字は描くたびに読む（言語を切り替えても立体を作り直さない）
    const text = opts.text.current
    line(1.7, r.x, r.personX, opts.ink, text.person)
    // 魚の体長：尾の切れ込み〜鼻先の寸法線（魚ごと）
    for (const [i, d] of r.dims.entries()) {
      const label = text.fish[i] ?? ''
      g.lineWidth = 1
      line(d.forkY, d.left, d.dimX + 0.06, opts.accent)
      line(d.noseY, d.left, d.dimX + 0.06, opts.accent)
      const [dx, dy0] = at(d.dimX, d.forkY)
      const [, dy1] = at(d.dimX, d.noseY)
      g.strokeStyle = opts.accent; g.fillStyle = opts.accent; g.lineWidth = 1.5
      g.beginPath(); g.moveTo(dx, dy0); g.lineTo(dx, dy1); g.stroke()
      for (const [y, k] of [[dy0, -1], [dy1, 1]]) { g.beginPath(); g.moveTo(dx - 4, y + k * 6); g.lineTo(dx, y); g.lineTo(dx + 4, y + k * 6); g.stroke() }
      g.font = `700 ${scene.beside ? 14 : 12}px ${opts.font}`
      // 横に入らないとき（スマホ）は、寸法線に沿って縦に書く
      if (scene.beside && dx + 10 + g.measureText(label).width <= cw - 4) { g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, dx + 10, (dy0 + dy1) / 2) }
      else if (scene.beside) { g.save(); g.translate(dx + 8, (dy0 + dy1) / 2); g.rotate(Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(label, 0, 0); g.restore() }
      else { const [lx, ly] = at(d.x, d.topY); g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(label, lx, ly - 8) }
    }
  }

  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(draw) } }

  // ドラッグで回す。指では横だけ（縦はページのスクロールに残す）
  const down = (e) => { dragging = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture?.(e.pointerId); kick() }
  const move = (e) => {
    if (!dragging || dragging.id !== e.pointerId) return
    view.yaw += (e.clientX - dragging.x) * 0.012
    if (e.pointerType === 'mouse') view.pitch = Math.max(-0.35, Math.min(0.75, view.pitch + (e.clientY - dragging.y) * 0.006))
    dragging.x = e.clientX; dragging.y = e.clientY
    if (opts.reduce) kick()
  }
  const up = () => { dragging = null; idleAt = performance.now() + 2500 }
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  // 見えていないときは止める
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick() })
  io.observe(canvas)
  const ro = new ResizeObserver(() => kick())
  ro.observe(canvas)
  kick()
  const stop = () => {
    cancelAnimationFrame(raf); io.disconnect(); ro.disconnect()
    canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up)
    // 描画の土台（WebGL）は捨てない：同じキャンバスで作り直すとき（見た目の切り替えなど）に使えなくなるため
  }
  stop.redraw = kick
  return stop
}

// fishes：[{ species, lengthCm, kg, label }]
export function Fish3D({ fishes, rim, reduce, label, personLabel }) {
  const ref = useRef(null)
  const over = useRef(null)
  const [ok, setOk] = useState(true)
  // 物差し・寸法線の文字（描くたびにここから読む）
  const text = useRef(null)
  text.current = { person: personLabel, fish: fishes.map((f) => f.label) }
  const running = useRef(null)
  // 文字が変わったら描き直す（自動で回っていないときのため）
  useEffect(() => { running.current?.redraw() }, [personLabel, fishes.map((f) => f.label).join('|')])
  useEffect(() => {
    if (!ref.current || !over.current) return
    const cs = getComputedStyle(ref.current)
    const scene = buildScene(fishes.map((f) => ({ ...f, lengthM: f.lengthCm / 100 })))
    const stop = start(ref.current, over.current, scene, {
      rim, reduce, text, font: cs.fontFamily,
      ink: cs.getPropertyValue('--fg-2').trim() || '#aab', accent: cs.getPropertyValue('--accent').trim() || '#5ccfd8',
    })
    if (!stop) setOk(false)
    running.current = stop
    return stop ?? undefined
  }, [fishes.map((f) => [f.species, f.lengthCm, f.kg].join()).join('|'), rim.join(), reduce])
  if (!ok) return null
  return (
    <div className="fish3d-wrap">
      <canvas ref={ref} className="fish3d" role="img" aria-label={label} />
      <canvas ref={over} className="fish3d-over" aria-hidden />
    </div>
  )
}
