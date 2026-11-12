// Facade decoration on the outer plaster skin (D.facade, optional):
//   trim:      colour of surrounds, bands and quoins (default '#efe9dc')
//   surrounds: { width 0.14, depth 0.03, sill true, doors true }   flat plaster frames round exterior windows/doors
//   bands:     [{ y, height 0.2, depth 0.04 }]                      string courses round the level whose skin holds y
//   quoins:    { levels ['EG','DG'], long 0.45, short 0.28, height 0.3, depth 0.025 }   corner blocks on convex corners
//   socle:     'stone'          masonry texture on the KG skin (see viewer.js)
//   roofTiles: 'coppi'          barrel tiles (see viewer.js)
// Everything is merged into one mesh per level so phones stay fast.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

function insideOf(poly, x, z) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
  }
  return c
}

// Outer face of an exterior wall: which side (+1/-1 along the wall normal n = (-uz, ux)) and how far the
// plaster skin sits beyond the wall's centre line (half the wall + insulation lying on that face).
export function wallSkin(D, w) {
  const [ax, az] = w.start, [bx, bz] = w.end, L = Math.hypot(bx - ax, bz - az)
  if (L < 1e-3) return null
  const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, half = w.thickness / 2
  for (const ins of D.insulation || []) {
    if (ins.level !== w.level || !(ins.outline?.length >= 3)) continue
    const P = ins.outline
    for (let i = 0; i < P.length; i++) {
      const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length], el = Math.hypot(x1 - x0, z1 - z0)
      if (el < 1e-3 || Math.abs(((x1 - x0) * ux + (z1 - z0) * uz) / el) < 0.99) continue
      for (const side of [1, -1]) {
        const fx = ax + side * nx * half, fz = az + side * nz * half
        const ex = (x1 - x0) / el, ez = (z1 - z0) / el
        if (Math.abs((fx - x0) * -ez + (fz - z0) * ex) > 0.03) continue
        // the wall must overlap this edge
        const s0 = (fx - x0) * ex + (fz - z0) * ez, s1 = s0 + L * (ux * ex + uz * ez)
        if (Math.max(s0, s1) < 0.05 || Math.min(s0, s1) > el - 0.05) continue
        // outside = away from the outline's interior
        const mx = fx + side * nx * 0.05, mz = fz + side * nz * 0.05
        if (insideOf(P, mx, mz)) continue
        return { side, offset: half + ins.thickness }
      }
    }
  }
  return null
}

export function buildFacade(D, { levels, roofTop, facadeSide }) {
  const F = D.facade
  const out = {}
  if (!F) return out
  const trimMat = new THREE.MeshStandardMaterial({ color: F.trim || '#efe9dc', roughness: 0.85, side: THREE.DoubleSide })
  const parts = {}
  const m4 = new THREE.Matrix4()
  // add a box (size sx along u, sy up, sz along n) centred at (u, y, zn) in a frame (origin o, u axis, n axis)
  const addBox = (lv, o, u, n, cu, cy, cz, sx, sy, sz) => {
    if (sx <= 0.005 || sy <= 0.005 || sz <= 0.002) return
    const g = new THREE.BoxGeometry(sx, sy, sz)
    g.translate(cu, cy, cz)
    m4.set(u[0], 0, n[0], o[0], 0, 1, 0, 0, u[1], 0, n[1], o[1], 0, 0, 0, 1)
    g.applyMatrix4(m4)
    const ng = g.toNonIndexed()
    if (m4.determinant() < 0) {   // mirrored frame: restore the triangle winding so faces point outwards
      for (const name of ['position', 'normal', 'uv']) {
        const a = ng.getAttribute(name), s = a.itemSize, arr = a.array
        for (let i = 0; i < a.count; i += 3) for (let c = 0; c < s; c++) { const j = (i + 1) * s + c, k = (i + 2) * s + c, tmp = arr[j]; arr[j] = arr[k]; arr[k] = tmp }
      }
    }
    ;(parts[lv] ||= []).push(ng)
    g.dispose()
  }

  // surrounds round openings in exterior walls
  if (F.surrounds) {
    const S = F.surrounds, sw = S.width ?? 0.14, sd = S.depth ?? 0.03
    for (const w of D.walls) {
      if (w.kind !== 'exterior' || !w.openings?.length) continue
      const lvl = levels[w.level]; if (!lvl) continue
      const [ax, az] = w.start, [bx, bz] = w.end, L = Math.hypot(bx - ax, bz - az); if (L < 1e-3) continue
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux
      const skin = wallSkin(D, w) || { side: facadeSide(w, nx, nz), offset: w.thickness / 2 }
      const n = [nx * skin.side, nz * skin.side], u = [ux, uz], zc = skin.offset + sd / 2
      for (const o of w.openings) {
        const isDoor = o.type === 'door'
        if (isDoor && S.doors === false) continue
        const u0 = Math.max(0.02, o.at - o.width / 2), u1 = Math.min(L - 0.02, o.at + o.width / 2)
        const h0 = lvl.floor + o.sill, h1 = lvl.floor + o.sill + o.height
        // keep frames under the roof (DG windows in gables and dormers)
        const px = ax + ux * (u0 + u1) / 2 + n[0] * skin.offset, pz = az + uz * (u0 + u1) / 2 + n[1] * skin.offset
        const rt = Math.max(roofTop(px, pz), roofTop(ax + ux * (u0 + u1) / 2, az + uz * (u0 + u1) / 2)); if (Number.isFinite(rt) && h1 + sw > rt - 0.05) continue
        // u runs along the wall; with the normal flipped, the frame is mirrored, which a box doesn't mind
        const cu = (u0 + u1) / 2, wd = u1 - u0
        const bottom = isDoor ? Math.max(h0, w.base) : h0
        addBox(w.level, [ax, az], u, n, cu, h1 + sw / 2, zc, wd + 2 * sw, sw, sd)                    // head
        addBox(w.level, [ax, az], u, n, u0 - sw / 2, (bottom + h1) / 2, zc, sw, h1 - bottom, sd)       // jambs
        addBox(w.level, [ax, az], u, n, u1 + sw / 2, (bottom + h1) / 2, zc, sw, h1 - bottom, sd)
        if (!isDoor && S.sill !== false) addBox(w.level, [ax, az], u, n, cu, h0 - 0.04, skin.offset + (sd + 0.04) / 2, wd + 2 * sw + 0.08, 0.08, sd + 0.04)
      }
    }
  }

  // edges of a skin outline with outward normals and convex flags
  const edgesOf = (ins) => {
    const P = ins.outline, n = P.length
    let area = 0; for (let i = 0; i < n; i++) { const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % n]; area += x1 * z2 - x2 * z1 }
    const sgn = Math.sign(area)
    const dir = (i) => { const [x1, z1] = P[i % n], [x2, z2] = P[(i + 1) % n], L = Math.hypot(x2 - x1, z2 - z1); return [(x2 - x1) / L, (z2 - z1) / L, L] }
    const convex = (i) => { const [ax, az] = dir((i + n - 1) % n), [bx, bz] = dir(i); return Math.sign(ax * bz - az * bx) === sgn }
    return P.map((p, i) => {
      const [ux, uz, L] = dir(i)
      let nx = uz, nz = -ux
      if (!insideOf(P, p[0] + ux * L / 2 - nx * 0.05, p[1] + uz * L / 2 - nz * 0.05)) { nx = -nx; nz = -nz }
      return { o: p, u: [ux, uz], n: [nx, nz], L, c0: convex(i), c1: convex((i + 1) % n) }
    })
  }

  // string courses
  for (const b of F.bands || []) {
    const bh = b.height ?? 0.2, bd = b.depth ?? 0.04
    const ins = (D.insulation || []).find((i) => i.outline?.length >= 3 && b.y >= i.base && (typeof i.top !== 'number' || b.y + bh <= i.top))
    if (!ins) continue
    const t = ins.thickness
    for (const e of edgesOf(ins)) {
      const u0 = e.c0 ? -(t + bd) : t, u1 = e.L + (e.c1 ? t + bd : -t)
      if (u1 - u0 < 0.05) continue
      addBox(ins.level, e.o, e.u, e.n, (u0 + u1) / 2, b.y + bh / 2, t + bd / 2, u1 - u0, bh, bd)
    }
  }

  // quoins on convex corners
  if (F.quoins) {
    const Q = F.quoins, qh = Q.height ?? 0.3, qd = Q.depth ?? 0.025, ql = Q.long ?? 0.45, qs = Q.short ?? 0.28, gap = 0.025
    const lvIds = Q.levels || ['EG', 'DG']
    const skins = (D.insulation || []).filter((i) => lvIds.includes(i.level) && i.outline?.length >= 3)
    const y0 = Math.min(...skins.map((i) => i.base))
    for (const ins of skins) {
      const t = ins.thickness, E = edgesOf(ins), n = E.length
      for (let i = 0; i < n; i++) {
        if (!E[i].c0) continue
        const a = E[i], p = E[(i + n - 1) % n]     // corner at a.o between edge p (ending) and edge a (starting)
        const cx = a.o[0] + (a.n[0] + p.n[0]) * t, cz = a.o[1] + (a.n[1] + p.n[1]) * t
        let top = typeof ins.top === 'number' ? ins.top : roofTop(cx + (a.n[0] + p.n[0]) * 0.05, cz + (a.n[1] + p.n[1]) * 0.05)
        if (!Number.isFinite(top)) continue
        top -= 0.05
        const yStart = ins.base
        const k0 = Math.round((yStart - y0) / qh)
        for (let k = k0, y = yStart; y + qh * 0.6 < top; k++, y += qh) {
          const h = Math.min(qh, top - y) - gap
          const la = k % 2 ? qs : ql, lp = k % 2 ? ql : qs
          // on edge a, from the corner (u = -t - qd) outwards
          addBox(ins.level, a.o, a.u, a.n, -t - qd + la / 2, y + gap / 2 + h / 2, t + qd / 2, la, h, qd)
          // on edge p, its end is at u = p.L + t (+ qd)
          addBox(ins.level, p.o, p.u, p.n, p.L + t + qd - lp / 2, y + gap / 2 + h / 2, t + qd / 2, lp, h, qd)
        }
      }
    }
  }

  for (const [lv, list] of Object.entries(parts)) {
    const geo = mergeGeometries(list)
    list.forEach((g) => g.dispose())
    const mesh = new THREE.Mesh(geo, trimMat)
    mesh.castShadow = mesh.receiveShadow = true
    mesh.userData = { kind: 'facade', data: F }
    out[lv] = mesh
  }
  return out
}
