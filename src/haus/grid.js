// "Raster": a 1 m grid laid on the (graded) ground, every 5 m line bolder,
// with the coordinates written at the 5 m crossings. Coordinates are the
// model's metres: x along the house, z across, height 0 = EG floor. So a spot
// can be read off the view, or named in a message ("x −18, z 4").
import * as THREE from 'three'

const num = (v, d) => (v < -1e-9 ? '−' : '') + Math.abs(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })
// for the screen: "x −18,20 · z 4,50 · Höhe −1,10 m"
export function pointText(x, z, y) {
  return `x ${num(x, 2)} · z ${num(z, 2)}` + (Number.isFinite(y) ? ` · Höhe ${num(y, 2)} m` : '')
}
// for copying into a message: plain numbers with a dot
export function pointPlain(x, z, y) {
  return `x ${x.toFixed(2)}, z ${z.toFixed(2)}` + (Number.isFinite(y) ? `, Höhe ${y.toFixed(2)}` : '')
}

function inside(poly, x, z) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c } return c }

// the house plus everything in the garden and terrain design, 12 m around it, on whole 5 m
export function gridExtent(D) {
  const xs = [], zs = []
  const add = p => { if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) { xs.push(p[0]); zs.push(p[1]) } }
  for (const p of D.terrain?.cutout || []) add(p)
  for (const g of [...(D.garden || []), ...(D.grading || [])]) { for (const p of g.outline || g.points || []) add(p); if (Number.isFinite(g.x)) add([g.x, g.z]) }
  if (!xs.length) { xs.push(-10, 10); zs.push(-10, 10) }
  const pad = 12, lo = v => Math.max(-60, Math.floor((v - pad) / 5) * 5), hi = v => Math.min(60, Math.ceil((v + pad) / 5) * 5)
  return [lo(Math.min(...xs)), hi(Math.max(...xs)), lo(Math.min(...zs)), hi(Math.max(...zs))]
}

const LABEL_W = 88   // label width on screen, CSS pixels
function label(text) {
  const c = document.createElement('canvas'); c.width = 220; c.height = 52; const g = c.getContext('2d')
  g.font = '600 30px Barlow, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.lineJoin = 'round'
  g.strokeStyle = 'rgba(255,255,255,0.92)'; g.fillStyle = '#1d2420'; g.strokeText(text, 110, 27); g.fillText(text, 110, 27)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); sp.renderOrder = 8
  return sp
}

// H(x, z): ground height; cutout: the house outline (no ground there)
export function buildGrid({ H, cutout, extent, phone }) {
  const [x0, x1, z0, z1] = extent, step = phone ? 0.5 : 0.25, lift = 0.05
  const ok = (x, z) => Number.isFinite(H(x, z)) && !(cutout?.length > 2 && inside(cutout, x, z))
  const minor = [], major = []
  const line = (fixed, a0, a1, alongX) => {
    const out = fixed % 5 === 0 ? major : minor
    for (let a = a0; a < a1 - 1e-9; a += step) {
      const b = Math.min(a1, a + step), [xa, za, xb, zb] = alongX ? [a, fixed, b, fixed] : [fixed, a, fixed, b]
      if (ok(xa, za) && ok(xb, zb)) out.push(xa, H(xa, za) + lift, za, xb, H(xb, zb) + lift, zb)
    }
  }
  for (let x = x0; x <= x1; x++) line(x, z0, z1, false)
  for (let z = z0; z <= z1; z++) line(z, x0, x1, true)
  const group = new THREE.Group(); group.name = 'grid'
  const add = (arr, opacity) => { if (!arr.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false })); l.renderOrder = 4; group.add(l) }
  add(minor, 0.4); add(major, 0.95)
  const labels = []
  for (let x = x0; x <= x1; x += 5) for (let z = z0; z <= z1; z += 5) {
    if (!ok(x, z)) continue
    const sp = label(`x ${num(x, 0)} · z ${num(z, 0)}`); sp.position.set(x, H(x, z) + 1.2, z)
    sp.userData.every = x % 20 === 0 && z % 20 === 0 ? 20 : x % 10 === 0 && z % 10 === 0 ? 10 : 5
    group.add(sp); labels.push(sp)
  }
  return { group, labels }
}

// keep the labels the same size on screen, and show only every 10 or 20 m when they would overlap
export function updateGridLabels(labels, camera, target, viewH) {
  const mpp = 2 * camera.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, viewH)   // metres per pixel
  const show = [5, 10, 20].find(s => s / mpp > LABEL_W * 1.15) ?? 40
  const w = LABEL_W * mpp
  for (const sp of labels) { sp.visible = sp.userData.every >= show; sp.scale.set(w, w * 52 / 220, 1) }
}
