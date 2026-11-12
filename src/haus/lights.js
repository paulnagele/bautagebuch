// Light fittings in the house model (model.lights), drawn as simple shapes.
// Each entry: { id, level, room, type, name, note, at: [x, z] | from: [x, z], to: [x, z], y?, drop?, size?, n? }
//   pendant  hangs `drop` m below the ceiling (default 0.9); with from/to it is a linear pendant
//   spot     ceiling downlight / ceiling light, `size` = diameter (default 0.1)
//   track    ceiling track from → to with `n` spots
//   strip    LED line from → to at height `y` above the floor (under cabinets, indirect, steps)
//   wall     wall light at height `y` (default 1.8)
//   step     small step light at height `y` (default 0.3)
// `y` is always metres above the level's floor; spots, tracks and pendants default to the ceiling.
// After sunset (date and time picked in the viewer) the fittings glow, with one soft fill light per room.
import * as THREE from 'three'

export const LIGHT_TYPES = { pendant: 'Pendelleuchte', spot: 'Spot / Deckenleuchte', track: 'Stromschiene', strip: 'LED-Linie', wall: 'Wandleuchte', step: 'Stufenlicht' }

function haloTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, 'rgba(255,214,150,1)'); r.addColorStop(0.25, 'rgba(255,190,110,0.55)'); r.addColorStop(1, 'rgba(255,170,80,0)')
  g.fillStyle = r; g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}

// Returns { groups: { level: Group }, pickables, setEvening(on), dispose() }
export function buildLights(D, levels, { roomFill = true } = {}) {
  const groups = {}, pickables = [], halos = [], fills = [], disposables = []
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 0.25, roughness: 0.4 })
  const body = new THREE.MeshStandardMaterial({ color: 0x2b2f31, roughness: 0.5, metalness: 0.3 })
  const cord = new THREE.MeshBasicMaterial({ color: 0x222222 })
  const haloTex = haloTexture()
  disposables.push(lamp, body, cord, haloTex)
  const halo = (x, y, z, s) => {
    const m = new THREE.SpriteMaterial({ map: haloTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    const sp = new THREE.Sprite(m); sp.position.set(x, y, z); sp.scale.set(s, s, 1); sp.visible = false; sp.renderOrder = 5
    halos.push(sp); disposables.push(m); return sp
  }
  const roomLights = {}
  for (const l of D.lights || []) {
    const lvl = levels[l.level]; if (!lvl) continue
    if (!groups[l.level]) { groups[l.level] = new THREE.Group(); groups[l.level].name = 'lights-' + l.level }
    const g = new THREE.Group(), ceil = lvl.floor + (lvl.clearHeight ?? 2.6), Y = (v, d) => lvl.floor + (v ?? d)
    const mesh = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o }
    const seg = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1]; return { len: Math.hypot(dx, dz), ang: Math.atan2(dz, dx), mx: (a[0] + b[0]) / 2, mz: (a[1] + b[1]) / 2 } }
    let cx, cz, cy, power = 1
    switch (l.type) {
      case 'pendant': {
        const drop = l.drop ?? 0.9, by = Y(l.y, (lvl.clearHeight ?? 2.6) - drop)
        if (l.from && l.to) {
          const s = seg(l.from, l.to), bar = mesh(new THREE.BoxGeometry(s.len, 0.05, 0.08), lamp, s.mx, by, s.mz); bar.rotation.y = -s.ang
          for (const f of [0.15, 0.85]) mesh(new THREE.CylinderGeometry(0.004, 0.004, ceil - by, 4), cord, l.from[0] + (l.to[0] - l.from[0]) * f, (ceil + by) / 2, l.from[1] + (l.to[1] - l.from[1]) * f)
          ;[cx, cy, cz] = [s.mx, by, s.mz]; power = 1.6; g.add(halo(cx, by - 0.05, cz, s.len * 1.2))
        } else {
          const r = (l.size ?? 0.3) / 2;[cx, cz] = l.at; cy = by
          const shade = mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), lamp, cx, by, cz); shade.material = lamp
          mesh(new THREE.CylinderGeometry(0.004, 0.004, ceil - by, 4), cord, cx, (ceil + by) / 2, cz)
          g.add(halo(cx, by - 0.02, cz, r * 5))
        }
        break
      }
      case 'spot': {
        const r = (l.size ?? 0.1) / 2;[cx, cz] = l.at; cy = Y(l.y, lvl.clearHeight ?? 2.6) - 0.01
        mesh(new THREE.CylinderGeometry(r, r, 0.02, 16), lamp, cx, cy, cz); g.add(halo(cx, cy - 0.04, cz, Math.max(0.35, r * 6))); power = 0.6
        break
      }
      case 'track': {
        const s = seg(l.from, l.to), y = Y(l.y, lvl.clearHeight ?? 2.6) - 0.02, n = l.n ?? 4
        const rail = mesh(new THREE.BoxGeometry(s.len, 0.035, 0.035), body, s.mx, y, s.mz); rail.rotation.y = -s.ang
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n, x = l.from[0] + (l.to[0] - l.from[0]) * f, z = l.from[1] + (l.to[1] - l.from[1]) * f
          mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12), body, x, y - 0.09, z)
          mesh(new THREE.CircleGeometry(0.03, 12), lamp, x, y - 0.151, z).rotation.x = Math.PI / 2
          g.add(halo(x, y - 0.17, z, 0.4))
        }
        ;[cx, cy, cz] = [s.mx, y, s.mz]; power = 0.5 * n
        break
      }
      case 'strip': {
        const s = seg(l.from, l.to), y = Y(l.y, 1.4)
        const st = mesh(new THREE.BoxGeometry(s.len, 0.015, 0.025), lamp, s.mx, y, s.mz); st.rotation.y = -s.ang
        const n = Math.max(1, Math.round(s.len / 0.5))
        for (let i = 0; i < n; i++) { const f = (i + 0.5) / n; g.add(halo(l.from[0] + (l.to[0] - l.from[0]) * f, y - 0.02, l.from[1] + (l.to[1] - l.from[1]) * f, 0.45)) }
        ;[cx, cy, cz] = [s.mx, y, s.mz]; power = 0.25 * s.len
        break
      }
      case 'wall': case 'step': {
        const wall = l.type === 'wall', y = Y(l.y, wall ? 1.8 : 0.3);[cx, cz] = l.at; cy = y
        mesh(wall ? new THREE.BoxGeometry(0.12, 0.12, 0.12) : new THREE.BoxGeometry(0.08, 0.05, 0.08), lamp, cx, y, cz)
        g.add(halo(cx, y, cz, wall ? 0.6 : 0.3)); power = wall ? 0.5 : 0.1
        break
      }
      default: continue
    }
    g.traverse(o => { if (o.isMesh) { o.userData = { kind: 'light', data: l }; pickables.push(o) } })
    groups[l.level].add(g)
    if (l.room && cx != null) {
      const k = l.level + '|' + l.room, r = roomLights[k] ??= { level: l.level, x: 0, z: 0, n: 0, p: 0, y: ceil - 0.35 }
      // a spot with its own height marks a lower ceiling (e.g. the carport roof), so the fill light goes below it
      if (l.type === 'spot' && l.y != null) r.y = Math.min(r.y, cy - 0.35)
      r.x += cx; r.z += cz; r.n++; r.p += power
    }
  }
  if (roomFill) {
    for (const r of Object.values(roomLights)) {
      const pl = new THREE.PointLight(0xffc98a, 0, 7, 1.6); pl.visible = false; pl.position.set(r.x / r.n, r.y, r.z / r.n)
      pl.userData.on = Math.min(7, 1.5 + r.p * 0.8); groups[r.level].add(pl); fills.push(pl)
    }
  }
  return {
    groups, pickables,
    setEvening(on) {
      lamp.emissiveIntensity = on ? 2.2 : 0.25
      for (const h of halos) h.visible = on
      for (const f of fills) { f.intensity = on ? f.userData.on : 0; f.visible = on }
    },
    dispose() { for (const d of disposables) d.dispose?.() },
  }
}
