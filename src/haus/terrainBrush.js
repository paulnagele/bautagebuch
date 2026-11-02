// Gelände-Pinsel: shape the ground by painting over it (heben, senken,
// ebnen, glätten), like a brush in a paint program.
//
// A brush layer is one entry of the model's `grading` list:
//   { type: 'brush', id: 'G-3', cell: 0.25, cells: { "i,j": cm, … } }
// It adds a height offset (in cm) at the grid point (i·cell, j·cell); between
// grid points the offset is interpolated. Layers apply in list order like the
// other terrain edits, so a level area drawn later wins over earlier brushing,
// and brushing after it shapes the result again (a new layer at the end).
//
// While a stroke runs, the layer's offsets live in a Map of floats (so small
// steps per frame add up) and are written back as whole cm when the finger lifts.

export const CELL = 0.25
const live = new WeakMap()   // layer → Map(key → metres) while a stroke runs
const BIAS = 32768
export const keyOf = (i, j) => (i + BIAS) * 65536 + (j + BIAS)
const ijOf = k => [Math.floor(k / 65536) - BIAS, (k % 65536) - BIAS]

function parse(layer) {
  const m = new Map()
  for (const [k, v] of Object.entries(layer.cells || {})) {
    const [i, j] = k.split(',').map(Number); if (Number.isInteger(i) && Number.isInteger(j) && Number.isFinite(v) && v) m.set(keyOf(i, j), v / 100)
  }
  return m
}
export function startLive(layer) { const m = parse(layer); live.set(layer, m); return m }
// the stroke ended: back to whole cm in the layer; returns the number of cells left
export function endLive(layer) {
  const m = live.get(layer); if (!m) return Object.keys(layer.cells || {}).length
  live.delete(layer)
  const out = {}, keys = [...m.keys()].sort((a, b) => a - b)
  for (const k of keys) { const cm = Math.round(m.get(k) * 100); if (cm) { const [i, j] = ijOf(k); out[`${i},${j}`] = cm } }
  layer.cells = out
  return keys.length ? Object.keys(out).length : 0
}

// height offset of one layer as a function (x, z) → metres
export function brushFn(layer) {
  const S = layer.cell || CELL, m = live.get(layer) || parse(layer), isLive = live.has(layer)
  if (!m.size && !isLive) return null
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity
  if (!isLive) for (const k of m.keys()) { const [i, j] = ijOf(k); if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j }
  return (x, z) => {
    const fx = x / S, fz = z / S, i = Math.floor(fx), j = Math.floor(fz)
    if (!isLive && (i < i0 - 1 || i > i1 || j < j0 - 1 || j > j1)) return 0
    const tx = fx - i, tz = fz - j, g = (a, b) => m.get(keyOf(a, b)) || 0
    return (g(i, j) * (1 - tx) + g(i + 1, j) * tx) * (1 - tz) + (g(i, j + 1) * (1 - tx) + g(i + 1, j + 1) * tx) * tz
  }
}
// [x0, x1, z0, z1] of the cells a layer changes, or null
export function brushBounds(layer) {
  const S = layer.cell || CELL, m = live.get(layer) || parse(layer); if (!m.size) return null
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity
  for (const k of m.keys()) { const [i, j] = ijOf(k); if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j }
  return [i0 * S, i1 * S, j0 * S, j1 * S]
}

export const MODES = [
  { key: 'raise', label: 'Heben' },
  { key: 'lower', label: 'Senken' },
  { key: 'flatten', label: 'Ebnen' },
  { key: 'smooth', label: 'Glätten' },
]

// one step of the brush at (px, pz): radius R in m, strength 1..10, dt in s.
// H(x, z) is the current ground (including this layer), skip(x, z) protects spots (pool, house).
export function dab(layer, { mode, px, pz, R, strength, dt, target, H, skip }) {
  const m = live.get(layer); if (!m) return
  const S = layer.cell || CELL, s = strength / 4
  const rate = 0.05 * strength   // heben/senken: metres per second in the middle of the brush
  const i0 = Math.ceil((px - R) / S), i1 = Math.floor((px + R) / S), j0 = Math.ceil((pz - R) / S), j1 = Math.floor((pz + R) / S)
  const blur = Math.max(0.5, R * 0.35)
  const upd = []
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = i * S, z = j * S, d = Math.hypot(x - px, z - pz); if (d > R) continue
    if (skip?.(x, z)) continue
    const q = 1 - (d / R) ** 2, w = q * q, k = keyOf(i, j), cur = m.get(k) || 0
    let delta = 0
    if (mode === 'raise') delta = rate * dt * w
    else if (mode === 'lower') delta = -rate * dt * w
    else if (mode === 'flatten') { if (Number.isFinite(target)) delta = (target - H(x, z)) * Math.min(1, 5 * s * dt * w) }
    else if (mode === 'smooth') {
      let a = 0; for (let n = 0; n < 8; n++) { const t = n * Math.PI / 4; a += H(x + blur * Math.cos(t), z + blur * Math.sin(t)) }
      delta = (a / 8 - H(x, z)) * Math.min(1, 4 * s * dt * w)
    }
    if (delta) upd.push([k, Math.max(-10, Math.min(10, cur + delta))])
  }
  for (const [k, v] of upd) m.set(k, v)   // after the loop, so smoothing reads the ground before this step
}
