// "Gestalten": edit the outdoor design (model key `garden`, see garden.js)
// right in the 3D view, made for touch first.
//
// - Hinzufügen: pick a plant, object, surface or line. Plants and objects
//   are set with one tap on the ground; surfaces and lines are drawn by
//   tapping their corner points, then "Fertig".
// - Tap an item to select it: drag it to move it, drag its corner points,
//   drag the small mid points to add a corner, change size, kind and name
//   in the card at the bottom.
// - Gelände (model key `grading`): level and sloped areas, retaining walls
//   and the pool can be selected and changed the same way (outline, height,
//   Böschung, slope ends). The terrain and the cut/fill volumes are rebuilt
//   after each change; while dragging only the outline follows.
// - Raster shows the 1 m grid with coordinates; tapping empty ground and
//   dragging a corner show where you are (x, z, height), and a selected
//   corner can be typed in as numbers.
// - Rückgängig steps back; "Fertig" leaves the mode. Changes are a preview
//   until they are saved as a version (like the JSON editor).
//
// mountGardenEditor(o) wires itself to the viewer through `o` and returns
// { enter, exit, refresh, get active }.
import * as THREE from 'three'
import { SURFACES, LINES, OBJECTS, gardenInfo } from './garden.js'
import { pointText } from './grid.js'

const PLANTS = [
  { key: 'tree', label: 'Laubbaum', make: () => ({ type: 'tree', shape: 'round', height: 6, crown: 4.5 }) },
  { key: 'fruit', label: 'Obstbaum', make: () => ({ type: 'tree', shape: 'round', species: 'Obstbaum', height: 4, crown: 3.5 }) },
  { key: 'conifer', label: 'Nadelbaum', make: () => ({ type: 'tree', shape: 'conic', height: 10, crown: 4 }) },
  { key: 'column', label: 'Säulenbaum', make: () => ({ type: 'tree', shape: 'columnar', height: 6, crown: 1.5 }) },
  { key: 'shrub', label: 'Strauch', make: () => ({ type: 'shrub', height: 1.2, crown: 1.2 }) },
  { key: 'bigshrub', label: 'Großer Strauch', make: () => ({ type: 'shrub', height: 2.2, crown: 2.5 }) },
]
const OBJECT_KEYS = ['raisedbed', 'shed', 'bench', 'table']
const AREA_KEYS = ['lawn', 'meadow', 'paving', 'slabs', 'gravel', 'wood', 'bed', 'mulch', 'water']
const LINE_KEYS = ['path', 'hedge', 'fence', 'wall', 'edging']
const PREFIX = { area: 'A', line: 'L', tree: 'T', shrub: 'B', object: 'O', level: 'G', slope: 'G', wall: 'W', pool: 'P' }
const GRADING = new Set(['level', 'slope', 'wall', 'pool'])
const GRADING_LABEL = { level: 'Ebene Fläche', slope: 'Schräge Fläche', wall: 'Stützmauer', pool: 'Pool' }
const isGrading = g => GRADING.has(g?.type)
function polyInside(poly, x, z) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c } return c }
function polyArea(poly) { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]); return Math.abs(a / 2) }
const fmt = (v, d = 2) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const snap = (v, s = 0.1) => Math.round(v / s) * s
const r2 = v => Math.round(v * 100) / 100
const r3 = v => Math.round(v * 1000) / 1000

export function mountGardenEditor(o) {
  const { $, camera, controls, renderer, scene, stage, phone } = o
  const bar = $('gtool'), hint = $('ghint'), card = $('gcard'), undoBtn = $('gundo'), viewBtn = $('gview')
  const overlay = new THREE.Group(); overlay.renderOrder = 20; overlay.visible = false; scene.add(overlay)
  const dotGeo = new THREE.SphereGeometry(1, 16, 12)
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true })
  const dotRing = new THREE.MeshBasicMaterial({ color: 0x2d6a55, depthTest: false, transparent: true })
  const midMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.75 })
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true })
  const ed = { active: false, mode: 'select', tool: null, sel: null, pts: [], undo: [], lastChange: 0, drag: null, down: null, handles: [], vertex: -1, top: false, picker: false }

  const garden = () => { const D = o.getData(); if (!Array.isArray(D.garden)) D.garden = []; return D.garden }
  const grading = () => { const D = o.getData(); if (!Array.isArray(D.grading)) D.grading = []; return D.grading }
  const listOf = g => (isGrading(g) ? grading() : garden())
  const tidy = () => { const D = o.getData(); for (const k of ['garden', 'grading']) if (Array.isArray(D[k]) && !D[k].length) delete D[k] }
  const accent = () => new THREE.Color(o.accent() || '#2d6a55')

  // ---------- changes and undo ----------
  function touch() {   // call before a change; one undo step per gesture (changes within 0.7 s belong together)
    const now = performance.now()
    if (now - ed.lastChange > 700) { const D = o.getData(); ed.undo.push(JSON.stringify({ garden: D.garden ?? [], grading: D.grading ?? [] })); if (ed.undo.length > 60) ed.undo.shift() }
    ed.lastChange = now; undoBtn.disabled = !ed.undo.length
  }
  // garden changes rebuild only the garden; terrain changes rebuild the whole model (terrain, pool, walls, garden on top),
  // so while dragging only the outline follows (final = false) and the model catches up when the finger lifts
  function changed(full = false, terrain = isGrading(ed.sel)) {
    if (terrain) { if (full) o.rebuildAll(); else drawOverlay(); o.kick(600); return }   // rebuildAll ends in refresh()
    o.rebuild(); highlight(); drawOverlay(); if (full) renderCard(); o.kick(600)
  }
  function settle() { o.onChange() }   // after a gesture: JSON editor, "ungespeicherte Änderung"
  undoBtn.addEventListener('click', () => {
    if (!ed.undo.length) return
    const prev = JSON.parse(ed.undo.pop()), D = o.getData()
    const terrain = JSON.stringify(prev.grading) !== JSON.stringify(D.grading ?? [])
    const key = isGrading(ed.sel) ? 'grading' : 'garden', selIdx = ed.sel ? (D[key] || []).indexOf(ed.sel) : -1
    D.garden = prev.garden; D.grading = prev.grading; ed.sel = selIdx >= 0 ? D[key][selIdx] ?? null : null; ed.vertex = -1
    ed.lastChange = 0; undoBtn.disabled = !ed.undo.length
    tidy(); if (terrain) o.rebuildAll(); else changed(true, false); settle()
  })

  function newId(type) {
    const D = o.getData(), p = PREFIX[type] || 'G', used = new Set([...(D.garden || []), ...(D.grading || [])].map(g => g.id)); let n = 1
    while (used.has(`${p}-${n}`)) n++
    return `${p}-${n}`
  }

  // ---------- picking ----------
  function ndcOf(e) { const r = renderer.domElement.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1) }
  function screenOf(x, y, z) { const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3(x, y, z).project(camera); return [(v.x + 1) / 2 * r.width + r.left, (1 - v.y) / 2 * r.height + r.top, v.z] }
  // where the finger points on the ground; over the house (no terrain there) it falls back to a level plane at the last ground height
  let lastGroundY = null
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pray = new THREE.Raycaster(), hitV = new THREE.Vector3()
  function groundPoint(e, fallback = false) {
    const ndc = ndcOf(e), p = o.terrainHit(ndc)
    if (p) { lastGroundY = p.y; return [p.x, p.z] }
    if (!fallback || lastGroundY == null) return null
    plane.constant = -lastGroundY; pray.setFromCamera(ndc, camera)
    return pray.ray.intersectPlane(plane, hitV) ? [hitV.x, hitV.z] : null
  }
  function handleAt(e) {   // nearest corner or mid handle within reach of the finger
    const reach = e.pointerType === 'touch' ? 30 : 14; let best = null
    for (const h of ed.handles) { const [sx, sy, sz] = screenOf(h.x, h.y, h.z); if (sz > 1) continue
      const d = Math.hypot(sx - e.clientX, sy - e.clientY); if (d < reach && (!best || d < best.d)) best = { ...h, d } }
    return best
  }

  // everything under the finger, top first: garden items, walls and pool, then the terrain areas the point lies in
  function candidatesAt(e) {
    const ndc = ndcOf(e), out = [], D = o.getData()
    const g = o.gardenHit(ndc); if (g) out.push(g)
    const w = o.gradingHit(ndc); if (w) out.push(w)
    const p = o.terrainHit(ndc)
    if (p) for (const a of [...(D.grading || [])].reverse()) if ((a.type === 'level' || a.type === 'slope') && a.outline?.length >= 3 && polyInside(a.outline, p.x, p.z)) out.push(a)
    return [...new Set(out)]
  }

  // snapping: 10 cm grid, or onto the house outline and other items' corners nearby
  function snapPoint(x, z, skip) {
    const reach = phone ? 0.4 : 0.3; let best = null
    const consider = (px, pz) => { const d = Math.hypot(px - x, pz - z); if (d < reach && (!best || d < best[0])) best = [d, px, pz] }
    const cut = o.cutout()
    if (cut?.length) for (let i = 0; i < cut.length; i++) {
      const a = cut[i], b = cut[(i + 1) % cut.length]; consider(a[0], a[1])
      const vx = b[0] - a[0], vz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1)))
      const d = Math.hypot(a[0] + t * vx - x, a[1] + t * vz - z); if (d < reach * 0.6 && (!best || d < best[0])) best = [d, r2(a[0] + t * vx), r2(a[1] + t * vz)]
    }
    const D = o.getData()
    for (const g of [...(D.garden || []), ...(D.grading || [])]) { if (g === skip) continue; for (const p of g.outline || g.points || []) consider(p[0], p[1]) }
    return best ? [best[1], best[2]] : [r2(snap(x)), r2(snap(z))]
  }

  // ---------- overlay: handles of the selected item, points while drawing ----------
  function dot(x, y, z, size, mat) { const m = new THREE.Mesh(dotGeo, mat); m.position.set(x, y, z); m.scale.setScalar(size); m.renderOrder = 21; overlay.add(m); return m }
  function dotSize() { return Math.max(0.12, camera.position.distanceTo(controls.target) * (phone ? 0.014 : 0.009)) }
  function drawOverlay() {
    overlay.clear(); ed.handles = []
    const s = dotSize(), H = o.ground
    const polyline = (pts, closed) => {
      if (pts.length < 2) return
      const v = pts.map(p => new THREE.Vector3(p[0], H(p[0], p[1]) + 0.08, p[1])); if (closed) v.push(v[0].clone())
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), lineMat); l.renderOrder = 20; overlay.add(l)
    }
    if (ed.mode === 'draw') {
      polyline(ed.pts, ed.tool.closed && ed.pts.length > 2)
      ed.pts.forEach((p, i) => { dot(p[0], H(p[0], p[1]) + 0.08, p[1], s * (i === ed.pts.length - 1 ? 1.3 : 1), i === ed.pts.length - 1 ? dotRing : dotMat) })
    } else if (ed.sel) {
      const g = ed.sel, pts = g.type === 'pool' ? null : g.outline || g.points
      if (g.type === 'pool' && g.outline?.length) {
        const cx = g.outline.reduce((a, p) => a + p[0], 0) / g.outline.length, cz = g.outline.reduce((a, p) => a + p[1], 0) / g.outline.length
        polyline(g.outline, true); dot(cx, g.top + 0.1, cz, s * 1.2, dotRing); ed.handles.push({ kind: 'move', x: cx, y: g.top + 0.1, z: cz })
      }
      if (g.type === 'slope' && g.from && g.to) {   // the two ends that set the slope: arrow from "Anfang" to "Ende"
        const a = new THREE.Vector3(g.from[0], g.from[2] + 0.15, g.from[1]), b = new THREE.Vector3(g.to[0], g.to[2] + 0.15, g.to[1])
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat); l.renderOrder = 20; overlay.add(l)
        dot(a.x, a.y, a.z, s * 0.9, dotRing); ed.handles.push({ kind: 'from', x: a.x, y: a.y, z: a.z })
        dot(b.x, b.y, b.z, s * 1.15, dotRing); ed.handles.push({ kind: 'to', x: b.x, y: b.y, z: b.z })
      }
      if (pts) {
        const closed = !!g.outline; polyline(pts, closed)
        pts.forEach((p, i) => { const y = H(p[0], p[1]) + 0.08; dot(p[0], y, p[1], s * (i === ed.vertex ? 1.35 : 1), i === ed.vertex ? dotRing : dotMat); ed.handles.push({ kind: 'vertex', i, x: p[0], y, z: p[1] }) })
        const n = closed ? pts.length : pts.length - 1
        for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, y = H(mx, mz) + 0.08
          dot(mx, y, mz, s * 0.6, midMat); ed.handles.push({ kind: 'mid', i: i + 1, x: mx, y, z: mz }) }
      } else if (Number.isFinite(g.x)) {
        const y = H(g.x, g.z) + 0.08; dot(g.x, y, g.z, s * 1.2, dotRing); ed.handles.push({ kind: 'move', x: g.x, y, z: g.z })
      }
    }
    o.kick(300)
  }
  controls.addEventListener('change', () => { if (ed.active && (ed.sel || ed.mode === 'draw')) { const s = dotSize(); overlay.children.forEach(m => { if (m.isMesh) m.scale.setScalar(s * (m.material === midMat ? 0.6 : m.material === dotRing ? 1.3 : 1)) }) } })

  function highlight() {   // selected item glows (its own material copies, the cache stays clean)
    if (!ed.sel) return
    const glow = m => { m.material = m.material.clone(); m.material.emissive = accent(); m.material.emissiveIntensity = 0.35 }
    if (isGrading(ed.sel)) { o.gradingMeshes().forEach(m => { if ((m.userData.ref ?? m.userData.data) === ed.sel) glow(m) }); return }
    o.gardenGroup()?.traverse(m => { if (m.isMesh && m.userData.data === ed.sel) glow(m) })
  }

  // ---------- card at the bottom: picker, drawing, selected item ----------
  function setHint(t) { hint.textContent = t; hint.hidden = !t }
  function renderCard() {
    if (ed.picker) {
      const chips = (title, list) => `<div class="glabel">${title}</div><div class="gchips">${list.map(([k, l]) => `<button type="button" class="chip" data-tool="${k}">${esc(l)}</button>`).join('')}</div>`
      card.innerHTML = `<div class="ghead"><b>Hinzufügen</b><button type="button" class="sheetx" data-act="close" aria-label="Schließen">×</button></div>` +
        chips('Pflanzen', PLANTS.map(p => ['p:' + p.key, p.label])) +
        chips('Objekte', OBJECT_KEYS.map(k => ['o:' + k, OBJECTS[k].label])) +
        chips('Flächen', AREA_KEYS.map(k => ['a:' + k, SURFACES[k].label])) +
        chips('Linien', LINE_KEYS.map(k => ['l:' + k, k === 'path' ? 'Weg' : LINES[k].label])) +
        chips('Gelände', [['g:level', 'Ebene Fläche'], ['g:slope', 'Schräge Fläche'], ['g:wall', 'Stützmauer']])
      card.hidden = false; return
    }
    if (ed.mode === 'place') {
      card.innerHTML = `<div class="ghead"><b>${esc(ed.tool.label)} setzen</b></div><div class="grow"><button type="button" class="btn" data-act="cancel">Abbrechen</button></div>`
      card.hidden = false; return
    }
    if (ed.mode === 'draw') {
      const need = ed.tool.closed ? 3 : 2, n = ed.pts.length
      card.innerHTML = `<div class="ghead"><b>${esc(ed.tool.label)} zeichnen</b><span class="gmeta">${n} ${n === 1 ? 'Punkt' : 'Punkte'}</span></div>
        <div class="grow"><button type="button" class="btn" data-act="cancel">Abbrechen</button><button type="button" class="btn" data-act="back" ${n ? '' : 'disabled'}>Letzten Punkt weg</button>
        <button type="button" class="btn primary" data-act="finish" ${n >= need ? '' : 'disabled'}>Fertig</button></div>`
      card.hidden = false; return
    }
    const g = ed.sel
    if (!g) { card.hidden = true; card.innerHTML = ''; return }
    if (isGrading(g)) { renderGradingCard(g); return }
    const info = gardenInfo(g), meta = info.rows.find(r => r[0] === 'Fläche' || r[0] === 'Länge')
    const slider = (key, label, min, max, step, val, unit = 'm') => `<label class="gfield"><span>${label}</span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${Number(val).toLocaleString('de-DE')} ${unit}</output></label>`
    const select = (key, label, opts, val) => `<label class="gfield"><span>${label}</span><select data-k="${key}">${opts.map(([k, l]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`
    let fields = ''
    if (g.type === 'tree') {
      fields += select('shape', 'Form', [['round', 'Laubbaum'], ['conic', 'Nadelbaum'], ['columnar', 'Säulenbaum']], g.shape || 'round')
      fields += slider('height', 'Höhe', 1, 25, 0.5, g.height ?? 6) + slider('crown', 'Krone', 0.5, 15, 0.5, g.crown ?? Math.max(1.5, (g.height ?? 6) * 0.6))
    } else if (g.type === 'shrub') {
      fields += slider('height', 'Höhe', 0.3, 5, 0.1, g.height ?? 1.2) + slider('crown', 'Breite', 0.3, 6, 0.1, g.crown ?? g.height ?? 1.2)
    } else if (g.type === 'object') {
      const [W, D, Ht] = g.size || (OBJECTS[g.kind] || OBJECTS.box).size
      fields += slider('rot', 'Drehung', 0, 355, 5, g.rot ?? 0, '°') + slider('w', 'Breite', 0.3, 8, 0.1, W) + slider('d', 'Tiefe', 0.3, 8, 0.1, D)
      if (g.kind === 'shed' || g.kind === 'box') fields += slider('h', 'Höhe', 0.3, 4, 0.1, Ht)
    } else if (g.type === 'area') {
      fields += select('surface', 'Belag', AREA_KEYS.concat(['concrete', 'asphalt']).map(k => [k, SURFACES[k].label]), g.surface || 'lawn')
      fields += `<label class="gfield"><span>Höhe</span><input type="number" inputmode="decimal" step="0.05" data-k="top" value="${typeof g.top === 'number' ? g.top : ''}" placeholder="folgt dem Gelände"></label>`
    } else if (g.type === 'line') {
      fields += select('kind', 'Art', LINE_KEYS.map(k => [k, k === 'path' ? 'Weg' : LINES[k].label]), g.kind || 'hedge')
      const L = LINES[g.kind] || LINES.hedge
      if (g.kind === 'path') fields += select('surface', 'Belag', ['gravel', 'paving', 'slabs', 'wood', 'concrete', 'mulch', 'lawn'].map(k => [k, SURFACES[k].label]), g.surface || 'gravel') + slider('width', 'Breite', 0.3, 4, 0.1, g.width ?? L.width)
      else fields += slider('height', 'Höhe', 0.05, 3, 0.05, g.height ?? L.height) + (g.kind === 'hedge' || g.kind === 'wall' ? slider('width', 'Breite', 0.1, 2, 0.05, g.width ?? L.width) : '')
      if (g.kind === 'fence') fields += select('material', 'Material', [['metal', 'Metall'], ['wood', 'Holz']], g.material || 'metal')
    }
    const pts = g.outline || g.points, minPts = g.outline ? 3 : 2
    card.innerHTML = `<div class="ghead"><b>${esc(info.title)}</b>${meta ? `<span class="gmeta">${esc(meta[1])}</span>` : ''}<button type="button" class="sheetx" data-act="deselect" aria-label="Auswahl aufheben">×</button></div>
      <div class="gfields">${vertexFields(g)}${fields}<label class="gfield"><span>Name</span><input type="text" maxlength="60" data-k="name" value="${esc(g.name)}" placeholder="optional"></label></div>
      <div class="grow">${pts && ed.vertex >= 0 && pts.length > minPts ? '<button type="button" class="btn" data-act="delpoint">Punkt löschen</button>' : ''}
        <button type="button" class="btn" data-act="copy">Kopie</button><button type="button" class="btn danger" data-act="delete">Löschen</button></div>`
    card.hidden = false
  }

  // the selected corner point as numbers (x, z), so it can be set exactly
  function vertexFields(g) {
    const pts = g.type === 'pool' ? null : g.outline || g.points
    if (!pts || ed.vertex < 0 || !pts[ed.vertex]) return ''
    const [x, z] = pts[ed.vertex]
    return `<div class="gfield"><span>Punkt ${ed.vertex + 1}</span><div class="gxy">
      <label>x <input type="number" inputmode="decimal" step="0.1" data-k="vx" value="${x}" aria-label="Punkt ${ed.vertex + 1}, x in m"></label>
      <label>z <input type="number" inputmode="decimal" step="0.1" data-k="vz" value="${z}" aria-label="Punkt ${ed.vertex + 1}, z in m"></label></div></div>`
  }

  // terrain card: heights as numbers with ±5 cm buttons (exact values matter here), applied when changed
  function renderGradingCard(g) {
    const num = (key, label, val, placeholder = '') => `<div class="gfield"><span>${label}</span><div class="gnum">
      <button type="button" class="btn" data-act="nudge" data-k="${key}" data-d="-0.05" aria-label="${label} 5 cm tiefer">−</button>
      <input type="number" inputmode="decimal" step="0.05" data-k="${key}" value="${val ?? ''}" placeholder="${placeholder}" aria-label="${label} in m">
      <button type="button" class="btn" data-act="nudge" data-k="${key}" data-d="0.05" aria-label="${label} 5 cm höher">+</button></div></div>`
    const slider = (key, label, min, max, step, val, show) => `<label class="gfield"><span>${label}</span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${show}</output></label>`
    const batter = v => (v <= 0.05 ? 'senkrecht' : `1 : ${fmt(v, 1)}`)
    let fields = '', meta = '', notes = []
    const center = pts => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
    if (g.type === 'level' || g.type === 'slope') {
      meta = fmt(polyArea(g.outline), 1) + ' m²'
      if (g.type === 'level') fields += num('height', 'Höhe', g.height)
      else {
        fields += num('from', 'Höhe Anfang', g.from?.[2]) + num('to', 'Höhe Ende', g.to?.[2])
        const L = Math.hypot(g.to[0] - g.from[0], g.to[1] - g.from[1]); if (L > 0.1) notes.push(`Gefälle ${fmt(Math.abs(g.to[2] - g.from[2]) / L * 100, 1)} % auf ${fmt(L, 1)} m`)
      }
      const b = g.batter ?? 1.5; fields += slider('batter', 'Böschung', 0, 4, 0.1, b, batter(b))
      const [cx, cz] = center(g.outline), y0 = o.groundOrig(cx, cz); if (Number.isFinite(y0)) notes.push(`Bestand in der Mitte etwa ${fmt(y0)} m`)
    } else if (g.type === 'wall') {
      let L = 0; for (let i = 1; i < g.points.length; i++) L += Math.hypot(g.points[i][0] - g.points[i - 1][0], g.points[i][1] - g.points[i - 1][1]); meta = fmt(L, 1) + ' m'
      fields += num('top', 'Oberkante', g.top, 'automatisch') + slider('thickness', 'Stärke', 0.15, 0.6, 0.05, g.thickness ?? 0.25, fmt(g.thickness ?? 0.25) + ' m')
    } else if (g.type === 'pool') {
      fields += num('top', 'Beckenrand', g.top) + slider('depth', 'Tiefe', 0.6, 2.5, 0.05, g.depth ?? 1.5, fmt(g.depth ?? 1.5) + ' m')
    }
    const v = o.cutfill(); if (v) notes.push(`Gelände gesamt: Abtrag ${fmt(v.cut, 1)} m³ · Auftrag ${fmt(v.fill, 1)} m³`)
    const pts = g.outline || g.points, minPts = g.outline ? 3 : 2
    card.innerHTML = `<div class="ghead"><b>${esc(g.name || GRADING_LABEL[g.type])}</b>${meta ? `<span class="gmeta">${esc(meta)}</span>` : ''}<button type="button" class="sheetx" data-act="deselect" aria-label="Auswahl aufheben">×</button></div>
      <div class="gfields">${vertexFields(g)}${fields}<label class="gfield"><span>Name</span><input type="text" maxlength="80" data-k="name" value="${esc(g.name)}" placeholder="optional"></label></div>
      ${notes.map(n => `<div class="gnote">${esc(n)}</div>`).join('')}
      <div class="grow">${g.type !== 'pool' && pts && ed.vertex >= 0 && pts.length > minPts ? '<button type="button" class="btn" data-act="delpoint">Punkt löschen</button>' : ''}
        ${g.type !== 'pool' ? '<button type="button" class="btn" data-act="copy">Kopie</button>' : ''}<button type="button" class="btn danger" data-act="delete">Löschen</button></div>`
    card.hidden = false
  }
  function setGrading(g, k, raw) {   // one terrain field from the card; returns false if the value isn't a number
    if (k === 'name') { if (String(raw).trim()) g.name = raw; else delete g.name; return true }
    const n = parseFloat(String(raw).replace(',', '.'))
    if (k === 'top' && g.type === 'wall' && !String(raw).trim()) { delete g.top; return true }
    if (!Number.isFinite(n)) return false
    if (k === 'from' || k === 'to') g[k] = [g[k][0], g[k][1], r3(n)]
    else if (k === 'batter') g.batter = n <= 0.05 ? 0.01 : r2(n)
    else g[k] = r3(n)
    return true
  }

  card.addEventListener('click', e => {
    const t = e.target.closest('[data-tool],[data-act]'); if (!t) return
    if (t.dataset.tool) { startTool(t.dataset.tool); return }
    const act = t.dataset.act, D = o.getData()
    if (act === 'close') { ed.picker = false; renderCard(); setHint(defaultHint()) }
    else if (act === 'cancel') { ed.mode = 'select'; ed.tool = null; ed.pts = []; drawOverlay(); renderCard(); setHint(defaultHint()) }
    else if (act === 'back') { ed.pts.pop(); drawOverlay(); renderCard() }
    else if (act === 'finish') finishDraw()
    else if (act === 'deselect') selectItem(null)
    else if (act === 'nudge' && isGrading(ed.sel)) {
      const g = ed.sel, k = t.dataset.k, cur = k === 'from' || k === 'to' ? g[k][2] : g[k] ?? (k === 'top' ? NaN : 0)
      const base = Number.isFinite(cur) ? cur : (o.ground(...(g.points?.[0] || [0, 0])) + 0.05)
      touch(); setGrading(g, k, base + Number(t.dataset.d)); changed(true); settle()
    }
    else if (act === 'delete' && ed.sel) { const terrain = isGrading(ed.sel), L = listOf(ed.sel); touch(); L.splice(L.indexOf(ed.sel), 1); ed.sel = null; tidy(); changed(true, terrain); if (!terrain) renderCard(); settle(); setHint(defaultHint()) }
    else if (act === 'copy' && ed.sel) {
      touch(); const c = structuredClone(ed.sel); c.id = newId(c.type)
      const mv = p => [r2(p[0] + 1), r2(p[1] + 1)]
      if (c.outline) c.outline = c.outline.map(mv); if (c.points) c.points = c.points.map(mv); if (Number.isFinite(c.x)) { c.x = r2(c.x + 1); c.z = r2(c.z + 1) }
      if (c.from) c.from = [r2(c.from[0] + 1), r2(c.from[1] + 1), c.from[2]]; if (c.to) c.to = [r2(c.to[0] + 1), r2(c.to[1] + 1), c.to[2]]
      listOf(c).push(c); ed.sel = c; ed.vertex = -1; changed(true); settle()
    } else if (act === 'delpoint' && ed.sel && ed.vertex >= 0) {
      touch(); (ed.sel.outline || ed.sel.points).splice(ed.vertex, 1); ed.vertex = -1; changed(true); settle()
    }
  })
  card.addEventListener('input', e => {
    const k = e.target.dataset.k, g = ed.sel; if (!k || !g || k === 'vx' || k === 'vz') return
    if (isGrading(g)) {   // terrain: show the slider value now, apply on release ("change")
      const out = e.target.parentElement.querySelector('output'), v = +e.target.value
      if (out) out.textContent = k === 'batter' ? (v <= 0.05 ? 'senkrecht' : `1 : ${fmt(v, 1)}`) : fmt(v) + ' m'
      if (k === 'name') { touch(); setGrading(g, k, e.target.value) }
      return
    }
    const v = e.target.value; touch()
    if (k === 'name') { if (v.trim()) g.name = v; else delete g.name; o.kick(); return }
    if (k === 'top') { const n = parseFloat(String(v).replace(',', '.')); if (Number.isFinite(n)) g.top = n; else delete g.top }
    else if (['shape', 'surface', 'kind', 'material'].includes(k)) g[k] = v
    else if (['w', 'd', 'h'].includes(k)) { const s = (g.size || (OBJECTS[g.kind] || OBJECTS.box).size).slice(); s['wdh'.indexOf(k)] = +v; g.size = s }
    else g[k] = +v
    const out = e.target.parentElement.querySelector('output'); if (out) out.textContent = `${Number(v).toLocaleString('de-DE')} ${k === 'rot' ? '°' : 'm'}`
    changed(e.target.tagName === 'SELECT')
  })
  card.addEventListener('change', e => {
    const k = e.target.dataset.k, g = ed.sel
    if ((k === 'vx' || k === 'vz') && g) {
      const pts = g.outline || g.points, n = parseFloat(String(e.target.value).replace(',', '.'))
      if (!pts?.[ed.vertex] || !Number.isFinite(n)) { renderCard(); return }
      touch(); const p = pts[ed.vertex].slice(); p[k === 'vx' ? 0 : 1] = r2(n); pts[ed.vertex] = p
      changed(true); if (isGrading(g)) renderCard(); settle(); showPoint(p[0], p[1]); return
    }
    if (k && k !== 'name' && isGrading(g)) { touch(); if (setGrading(g, k, e.target.value)) changed(true); else renderCard() }
    settle()
  })

  // ---------- tools ----------
  function startTool(key) {
    const [grp, k] = key.split(':'); ed.picker = false; ed.sel = null; ed.vertex = -1
    if (grp === 'p') { const p = PLANTS.find(x => x.key === k); ed.tool = { type: 'point', label: p.label, make: p.make }; ed.mode = 'place' }
    else if (grp === 'o') { ed.tool = { type: 'point', label: OBJECTS[k].label, make: () => ({ type: 'object', kind: k, rot: 0 }) }; ed.mode = 'place' }
    else if (grp === 'g') { ed.tool = { type: k, closed: k !== 'wall', label: GRADING_LABEL[k], make: pts => makeGrading(k, pts) }; ed.mode = 'draw'; ed.pts = [] }
    else if (grp === 'a') { ed.tool = { type: 'area', closed: true, label: SURFACES[k].label, make: pts => ({ type: 'area', surface: k, outline: pts }) }; ed.mode = 'draw'; ed.pts = [] }
    else { ed.tool = { type: 'line', label: k === 'path' ? 'Weg' : LINES[k].label, make: pts => (k === 'path' ? { type: 'line', kind: 'path', surface: 'gravel', width: 1, points: pts } : { type: 'line', kind: k, points: pts }) }; ed.mode = 'draw'; ed.pts = [] }
    o.rebuild(); drawOverlay(); renderCard()
    setHint(ed.mode === 'place' ? 'Tippe auf den Boden, wo es stehen soll.' : ed.tool.closed ? 'Tippe die Eckpunkte der Fläche nacheinander an.' : 'Tippe die Punkte der Linie nacheinander an.')
  }
  // a new terrain area starts at the current ground: level at the height in its middle, a slope along its longer side
  function makeGrading(type, pts) {
    if (type === 'wall') return { type: 'wall', points: pts, thickness: 0.25 }
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs)
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, H = o.ground, h5 = v => Math.round(v / 0.05) * 0.05
    if (type === 'level') return { type: 'level', height: r3(h5(H(cx, cz))), batter: 1.5, outline: pts }
    const alongX = x1 - x0 >= z1 - z0, a = alongX ? [x0, cz] : [cx, z0], b = alongX ? [x1, cz] : [cx, z1]
    return { type: 'slope', batter: 1.5, outline: pts, from: [r2(a[0]), r2(a[1]), r3(h5(H(a[0], a[1])))], to: [r2(b[0]), r2(b[1]), r3(h5(H(b[0], b[1])))] }
  }
  function finishDraw() {
    const need = ed.tool.closed ? 3 : 2; if (ed.pts.length < need) return
    touch(); const item = ed.tool.make(ed.pts.map(p => [r2(p[0]), r2(p[1])])); item.id = newId(item.type)
    listOf(item).push(item); ed.mode = 'select'; ed.tool = null; ed.pts = []; ed.sel = item; ed.vertex = -1
    if (isGrading(item)) o.setCutfill(true)
    changed(true); settle(); setHint(selHint())
  }
  function selectItem(g, more = false) {
    const was = ed.sel; ed.sel = g; ed.vertex = -1
    if (isGrading(was)) o.rebuildAll(); else { o.rebuild(); highlight(); drawOverlay(); renderCard() }   // rebuildAll ends in refresh()
    o.setCutfill(isGrading(g))
    setHint(g ? selHint() + (more ? ' Nochmal tippen wählt, was darunter liegt.' : '') : defaultHint())
  }
  const showPoint = (x, z) => setHint(pointText(x, z, o.ground(x, z)))
  const defaultHint = () => 'Tippe etwas im Garten oder im Gelände an, um es zu bearbeiten.'
  const selHint = () => ed.sel?.type === 'slope' ? 'Ziehen verschiebt. Die zwei Ringe legen Anfang und Ende des Gefälles fest.'
    : ed.sel?.type !== 'pool' && (ed.sel?.outline || ed.sel?.points) ? 'Ziehen verschiebt. Punkte ziehen ändert die Form, die kleinen Punkte fügen Ecken ein.' : 'Ziehen verschiebt.'

  // ---------- pointer: taps place and draw, drags move ----------
  function onDown(e) {
    if (!ed.active || e.button > 0 || ed.drag) return
    ed.down = { x: e.clientX, y: e.clientY, id: e.pointerId }
    if (ed.mode !== 'select' || !ed.sel) return
    const h = handleAt(e), g = ed.sel
    let start = null
    if (h?.kind === 'vertex') { start = { kind: 'vertex', i: h.i }; ed.vertex = h.i }
    else if (h?.kind === 'from' || h?.kind === 'to') start = { kind: h.kind }
    else if (h?.kind === 'mid') { touch(); (g.outline || g.points).splice(h.i, 0, [r2(h.x), r2(h.z)]); start = { kind: 'vertex', i: h.i }; ed.vertex = h.i; changed() }
    else if (h?.kind === 'move' || candidatesAt(e).includes(g)) start = { kind: 'body' }
    if (!start) return
    const g0 = groundPoint(e); if (!g0) return
    start.g0 = g0; start.orig = structuredClone(g); start.moved = false
    ed.drag = start; controls.enabled = false
    try { renderer.domElement.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  let rafPending = false, lastMove = null
  function onMove(e) {
    if (!ed.drag || e.pointerId !== ed.down?.id) return
    lastMove = e; if (rafPending) return; rafPending = true
    requestAnimationFrame(() => {
      rafPending = false; const ev = lastMove, d = ed.drag; if (!d) return
      const p = groundPoint(ev, true); if (!p) return
      if (!d.moved && Math.hypot(ev.clientX - ed.down.x, ev.clientY - ed.down.y) < (ev.pointerType === 'touch' ? 8 : 3)) return
      if (!d.moved) { touch(); d.moved = true }
      ed.lastChange = performance.now()
      const g = ed.sel, pts = g.outline || g.points
      if (d.kind === 'vertex') { const [x, z] = snapPoint(p[0], p[1], g); pts[d.i] = [x, z]; showPoint(x, z) }
      else if (d.kind === 'from' || d.kind === 'to') { const [x, z] = snapPoint(p[0], p[1], g); g[d.kind] = [x, z, g[d.kind][2]] }
      else {
        const dx = snap(p[0] - d.g0[0]), dz = snap(p[1] - d.g0[1]), op = d.orig.outline || d.orig.points
        if (pts) op.forEach((q, i) => { pts[i] = [r2(q[0] + dx), r2(q[1] + dz)] })
        else { g.x = r2(d.orig.x + dx); g.z = r2(d.orig.z + dz) }
        for (const k of ['from', 'to']) if (d.orig[k]) g[k] = [r2(d.orig[k][0] + dx), r2(d.orig[k][1] + dz), d.orig[k][2]]
      }
      changed()
    })
  }
  function onUp(e) {
    if (!ed.active || e.pointerId !== ed.down?.id) return
    const d = ed.drag, tap = Math.hypot(e.clientX - ed.down.x, e.clientY - ed.down.y) < (e.pointerType === 'touch' ? 10 : 4)
    ed.down = null
    if (d) { ed.drag = null; controls.enabled = true
      if (d.moved) { if (isGrading(ed.sel)) changed(true); else renderCard(); settle() } else if (d.kind === 'vertex') { drawOverlay(); renderCard() }
      if (d.kind === 'vertex') { const q = (ed.sel?.outline || ed.sel?.points)?.[d.i]; if (q) showPoint(q[0], q[1]) }
      return }
    if (!tap) return
    if (ed.mode === 'place') {
      const p = groundPoint(e); if (!p) { setHint('Dort ist kein Gelände. Tippe neben das Haus.'); return }
      touch(); const item = ed.tool.make(); item.id = newId(item.type); item.x = r2(snap(p[0])); item.z = r2(snap(p[1]))
      garden().push(item); ed.mode = 'select'; ed.tool = null; ed.sel = item; ed.vertex = -1
      changed(true); settle(); setHint(selHint()); return
    }
    if (ed.mode === 'draw') {
      const p = groundPoint(e); if (!p) return
      const q = snapPoint(p[0], p[1]); ed.pts.push(q); drawOverlay(); renderCard(); showPoint(q[0], q[1]); return
    }
    if (ed.picker) return
    // tapping the same spot again steps down through what lies there (lawn → terrace → …)
    const c = candidatesAt(e), i = c.indexOf(ed.sel), next = c.length ? c[i >= 0 ? (i + 1) % c.length : 0] : null
    if (next !== ed.sel) selectItem(next, c.length > 1)
    if (!next) { const p = groundPoint(e); if (p) showPoint(p[0], p[1]) }   // empty ground: where is this?
  }
  const offs = []
  const on = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); offs.push(() => t.removeEventListener(type, fn, opt)) }
  on(stage, 'pointerdown', onDown, { capture: true })
  on(window, 'pointermove', onMove)
  on(window, 'pointerup', onUp)
  on(window, 'pointercancel', e => { if (ed.drag && e.pointerId === ed.down?.id) { const t = isGrading(ed.sel) && ed.drag.moved; ed.drag = null; controls.enabled = true; if (t) changed(true); settle() } ed.down = null })

  $('gadd').addEventListener('click', () => { ed.picker = !ed.picker; ed.mode = 'select'; ed.tool = null; ed.pts = []; if (ed.picker && ed.sel) selectItem(null); renderCard(); setHint(ed.picker ? 'Was möchtest du hinzufügen?' : defaultHint()) })
  // "Von oben": straight down over the current spot, high enough to see the garden; "Schräg" goes back
  viewBtn.addEventListener('click', () => {
    ed.top = !ed.top; viewBtn.textContent = ed.top ? 'Schräg' : 'Von oben'
    if (ed.top) {
      ed.camBack = { pos: camera.position.clone(), tgt: controls.target.clone() }
      // same orientation as the "Grundriss" view: portrait phones turned so the long facade runs up the screen
      const t = controls.target, portrait = camera.aspect < 0.8, h = Math.max(45, Math.min(90, camera.position.distanceTo(t) * 1.2)) * (portrait ? 1.3 : 1)
      o.fly(new THREE.Vector3(t.x + (portrait ? 0.01 : 0), t.y + h, t.z + (portrait ? 0 : 0.01)), t.clone())
    } else if (ed.camBack) o.fly(ed.camBack.pos, ed.camBack.tgt)
    else o.view('persp')
  })
  const gridBtn = $('ggrid')
  gridBtn.addEventListener('click', () => o.grid(!o.grid()))
  $('gdone').addEventListener('click', () => exit())

  function enter() {
    if (ed.active) return
    ed.active = true; ed.mode = 'select'; ed.sel = null; ed.pts = []; ed.undo = []; ed.picker = !o.getData().garden?.length; ed.top = false
    undoBtn.disabled = true; viewBtn.textContent = 'Von oben'
    o.host.classList.add('designing'); bar.hidden = false; overlay.visible = true
    o.onEnter(); renderCard(); setHint(ed.picker ? 'Was möchtest du hinzufügen?' : defaultHint()); drawOverlay()
  }
  function exit() {
    if (!ed.active) return
    const terrain = isGrading(ed.sel)
    ed.active = false; ed.drag = null; ed.sel = null; ed.picker = false; ed.mode = 'select'; ed.pts = []; controls.enabled = true
    o.host.classList.remove('designing'); bar.hidden = true; card.hidden = true; overlay.visible = false; overlay.clear()
    if (terrain) o.rebuildAll(); else o.rebuild(); o.onExit()
  }
  // after the whole model was rebuilt (another version, JSON editor): keep the selection if it still exists
  function refresh() {
    if (!ed.active) return
    const D = o.getData(); if (ed.sel && !(D[isGrading(ed.sel) ? 'grading' : 'garden'] || []).includes(ed.sel)) { ed.sel = null; ed.vertex = -1; o.setCutfill(false) }
    highlight(); drawOverlay(); renderCard()
  }
  return { enter, exit, refresh, dispose: () => { offs.forEach(f => f()); scene.remove(overlay) }, get active() { return ed.active } }
}
