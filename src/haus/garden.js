// The outdoor design of a house version (model key `garden`): surfaces such
// as lawn or paving, lines such as hedges, fences and paths, and objects
// such as trees, shrubs, raised beds or a shed. Everything stands on the
// (graded) terrain, so it follows the ground unless an entry gives its own
// height. Coordinates are metres like the rest of the model (x along the
// house, z across, y height, 0 = EG floor).
//
//   { type: 'area', surface: 'lawn', outline: [[x, z], …], holes?, top?, thickness? }
//       top given: a raised surface (deck, terrace slab) reaching down to the ground
//   { type: 'line', kind: 'hedge' | 'fence' | 'wall' | 'edging' | 'path', points: [[x, z], …],
//     width?, height?, surface? (path), material? ('metal' | 'wood', fence) }
//   { type: 'tree', x, z, height?, crown? (diameter), shape? ('round' | 'conic' | 'columnar'), species? }
//   { type: 'shrub', x, z, height?, crown? }
//   { type: 'object', kind: 'raisedbed' | 'shed' | 'bench' | 'table' | 'box', x, z, size? [w, d, h], rot? (degrees) }
//
// Every entry may have id, name, note and color (overrides the default).
// buildGarden() returns a group of meshes; each mesh carries
// userData { kind: 'garden', data: entry, walk: 'ground' | 'block' | undefined }.
import * as THREE from 'three'
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js'

export const SURFACES = {
  lawn: { label: 'Rasen', color: '#78a050', tile: 2 },
  meadow: { label: 'Wiese', color: '#93ad62', tile: 3 },
  paving: { label: 'Pflaster', color: '#a8a196', tile: 1 },
  slabs: { label: 'Platten', color: '#c4beb2', tile: 1.2 },
  gravel: { label: 'Kies', color: '#cdc4b0', tile: 1 },
  wood: { label: 'Holz', color: '#a27b52', tile: 1.4 },
  bed: { label: 'Beet', color: '#6d5541', tile: 1 },
  mulch: { label: 'Rindenmulch', color: '#7b5b3e', tile: 1 },
  concrete: { label: 'Beton', color: '#c6c2ba', tile: 2 },
  asphalt: { label: 'Asphalt', color: '#6e6e6c', tile: 2 },
  water: { label: 'Wasser', color: '#3f93b8', tile: 4 },
}
export const LINES = {
  hedge: { label: 'Hecke', width: 0.6, height: 1.6, color: '#4f7340' },
  fence: { label: 'Zaun', width: 0.04, height: 1.2, color: '#5b5f60' },
  wall: { label: 'Gartenmauer', width: 0.25, height: 1, color: '#b5aea3' },
  edging: { label: 'Einfassung', width: 0.08, height: 0.12, color: '#a9a59d' },
  path: { label: 'Weg', width: 1, height: 0 },
}
export const OBJECTS = {
  raisedbed: { label: 'Hochbeet', size: [2, 1, 0.8], color: '#9a7650' },
  shed: { label: 'Gartenhütte', size: [3, 2.5, 2.3], color: '#8b6a48' },
  bench: { label: 'Bank', size: [1.6, 0.55, 0.45], color: '#9a7650' },
  table: { label: 'Gartentisch', size: [1.8, 0.9, 0.75], color: '#9a7650' },
  box: { label: 'Objekt', size: [1, 1, 1], color: '#b8b2a6' },
}
export const TREE_SHAPES = { round: 'Laubbaum', conic: 'Nadelbaum', columnar: 'Säulenbaum' }

// small seeded random, so textures and tree colours look the same on every build
function rand(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hashId(str) { let h = 2166136261; for (const ch of String(str ?? '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

function canvasTex(draw, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function speckle(g, n, size, colors, r) { for (let i = 0; i < n; i++) { g.fillStyle = colors[i % colors.length]; const s = size * (0.5 + r()); g.fillRect(r() * 128, r() * 128, s, s); } }
// one texture tile = SURFACES[surface].tile metres
function surfaceTexture(surface, base) {
  const r = rand(hashId(surface));
  return canvasTex((g, S) => {
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    switch (surface) {
      case 'lawn': case 'meadow':
        speckle(g, 900, 2, ['rgba(0,40,0,0.18)', 'rgba(255,255,200,0.10)'], r);
        if (surface === 'meadow') speckle(g, 40, 2.5, ['rgba(255,255,255,0.8)', 'rgba(250,220,60,0.8)'], r);
        break;
      case 'paving':   // 20 x 10 cm stones in rows, staggered
        for (let row = 0; row < 10; row++) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, row * 12.8, S, 1.4);
          for (let x = (row % 2) * 12.8; x < S; x += 25.6) g.fillRect(x, row * 12.8, 1.4, 12.8); }
        speckle(g, 300, 1.5, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.06)'], r);
        break;
      case 'slabs':    // 60 x 40 cm slabs on a 1.2 m tile
        g.fillStyle = 'rgba(0,0,0,0.22)';
        for (let x = 0; x < S; x += S / 2) g.fillRect(x, 0, 1.2, S);
        for (let y = 0; y < S; y += S / 3) g.fillRect(0, y, S, 1.2);
        speckle(g, 200, 1.5, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.07)'], r);
        break;
      case 'gravel': speckle(g, 1400, 2, ['rgba(0,0,0,0.16)', 'rgba(255,255,255,0.25)', 'rgba(120,100,80,0.2)'], r); break;
      case 'wood':     // boards 14 cm wide along x
        g.fillStyle = 'rgba(0,0,0,0.3)'; for (let y = 0; y < S; y += S / 10) g.fillRect(0, y, S, 1.2);
        speckle(g, 120, 3, ['rgba(60,30,0,0.08)'], r);
        break;
      case 'bed': speckle(g, 700, 2.5, ['rgba(0,0,0,0.18)', 'rgba(255,230,200,0.08)'], r); speckle(g, 25, 6, ['rgba(80,120,60,0.85)'], r); break;
      case 'mulch': speckle(g, 900, 3, ['rgba(40,20,0,0.25)', 'rgba(200,150,100,0.18)'], r); break;
      case 'water': speckle(g, 80, 6, ['rgba(255,255,255,0.08)'], r); break;
      default: speckle(g, 600, 1.5, ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.06)'], r);
    }
  })
}

export function polygonArea(poly) { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]); return Math.abs(a / 2); }
export function lineLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }

// outline of a path of width w along points (mitred corners, limited on sharp bends)
function strip(points, w) {
  const hw = w / 2, left = [], right = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const n = (q, s) => { const dx = s[0] - q[0], dz = s[1] - q[1], L = Math.hypot(dx, dz) || 1; return [-dz / L, dx / L]; };
    const n1 = n(i ? a : p, i ? p : b), n2 = n(i < points.length - 1 ? p : a, i < points.length - 1 ? b : p);
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1]; const mL = Math.hypot(mx, mz) || 1; mx /= mL; mz /= mL;
    const k = hw / Math.max(0.35, mx * n1[0] + mz * n1[1]);
    left.push([p[0] + mx * k, p[1] + mz * k]); right.push([p[0] - mx * k, p[1] - mz * k]);
  }
  return left.concat(right.reverse());
}

// a flat polygon laid on the ground: triangulated, split into small triangles, each corner lifted to the terrain
function drapedGeometry(outline, holes, H, lift, maxEdge, tile) {
  const v2 = p => new THREE.Vector2(p[0], p[1]);
  let contour = outline.map(v2); if (THREE.ShapeUtils.isClockWise(contour)) contour = contour.reverse();
  const hs = (holes || []).filter(h => h?.length >= 3).map(h => { let a = h.map(v2); if (!THREE.ShapeUtils.isClockWise(a)) a = a.reverse(); return a; });
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs), pts = contour.concat(...hs);
  const flat = [];
  for (const t of tris) for (const i of t) flat.push(pts[i].x, 0, pts[i].y);
  let geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
  geo = new TessellateModifier(maxEdge, 14).modify(geo);
  const P = geo.attributes.position.array, uv = new Float32Array(P.length / 3 * 2);
  for (let k = 0; k < P.length; k += 3) {
    const x = P[k], z = P[k + 2]; P[k + 1] = H(x, z) + lift;
    uv[k / 3 * 2] = x / tile; uv[k / 3 * 2 + 1] = -z / tile;
  }
  // triangles as seen from above must be counter-clockwise, so the normals point up
  for (let k = 0; k < P.length; k += 9) {
    const ax = P[k + 3] - P[k], az = P[k + 5] - P[k + 2], bx = P[k + 6] - P[k], bz = P[k + 8] - P[k + 2];
    if (az * bx - ax * bz < 0) { for (let c = 0; c < 3; c++) { const t = P[k + 3 + c]; P[k + 3 + c] = P[k + 6 + c]; P[k + 6 + c] = t; }
      const u = k / 3 * 2; for (let c = 0; c < 2; c++) { const t = uv[u + 2 + c]; uv[u + 2 + c] = uv[u + 4 + c]; uv[u + 4 + c] = t; } }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

// pieces of at most `step` metres along a polyline, for things that follow the ground
function pieces(points, step) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n, ax + (bx - ax) * (k + 1) / n, az + (bz - az) * (k + 1) / n]);
  }
  return out;
}

// opts: { H: ground height (x, z) → y, prism: (outline, holes, topFn, bottomFn, uvFn) → geometry, phone }
export function buildGarden(items, opts) {
  const { H, prism, phone } = opts;
  const group = new THREE.Group(); group.name = 'garden';
  const cache = new Map();
  const mat = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
  const plain = (color, extra = {}) => mat('c' + color + JSON.stringify(extra), () => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra }));
  const surfaceMat = (surface, color, lifted) => mat(`s:${surface}:${color}:${lifted}`, () => {
    const water = surface === 'water';
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: surfaceTexture(surface, color), roughness: water ? 0.1 : 1, metalness: water ? 0.1 : 0,
      transparent: water, opacity: water ? 0.8 : 1, side: THREE.DoubleSide,
      polygonOffset: !lifted, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  });
  const add = (mesh, item, walk) => { mesh.castShadow = walk !== 'surface'; mesh.receiveShadow = true;
    mesh.userData = { kind: 'garden', data: item, walk: walk === 'surface' ? undefined : walk }; group.add(mesh); return mesh; };
  const maxEdge = phone ? 0.6 : 0.35, step = phone ? 1.5 : 0.75;
  const boxAlong = (ax, az, bx, bz, w, bottom, top, m) => {
    const L = Math.hypot(bx - ax, bz - az), b = new THREE.Mesh(new THREE.BoxGeometry(L, top - bottom, w), m);
    b.position.set((ax + bx) / 2, (top + bottom) / 2, (az + bz) / 2); b.rotation.y = Math.atan2(-(bz - az), bx - ax); return b;
  };

  for (const it of items || []) {
    try {
      if (it.type === 'area' && it.outline?.length >= 3) {
        const S = SURFACES[it.surface] || SURFACES.lawn, color = it.color || S.color;
        if (typeof it.top === 'number') {
          const th = it.thickness ?? 0.12, top = it.top;
          const geo = prism(it.outline, it.holes, () => top, (x, z) => Math.min(top - th, H(x, z) - 0.05), (x, y, z) => [x / S.tile, -z / S.tile]);
          add(new THREE.Mesh(geo, surfaceMat(it.surface, color, true)), it, 'ground');
        } else {
          const lift = it.surface === 'water' ? 0.04 : 0.03;
          add(new THREE.Mesh(drapedGeometry(it.outline, it.holes, H, lift, maxEdge, S.tile), surfaceMat(it.surface, color, false)), it, 'surface');
        }
      } else if (it.type === 'line' && it.points?.length >= 2) {
        const L = LINES[it.kind] || LINES.hedge, w = it.width ?? L.width, h = it.height ?? L.height;
        if (it.kind === 'path') {
          const surface = it.surface || 'gravel', S = SURFACES[surface] || SURFACES.gravel;
          add(new THREE.Mesh(drapedGeometry(strip(it.points, w), [], H, 0.035, maxEdge, S.tile), surfaceMat(surface, it.color || S.color, false)), it, 'surface');
          continue;
        }
        if (it.kind === 'fence') {
          const wood = it.material === 'wood', post = plain(wood ? '#7b5535' : '#3f4345'), color = it.color || (wood ? '#9a7650' : L.color);
          const panel = wood ? plain(color) : plain(color, { transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
          const posts = [];
          for (let i = 1; i < it.points.length; i++) { const [ax, az] = it.points[i - 1], [bx, bz] = it.points[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2.5));
            for (let k = i === 1 ? 0 : 1; k <= n; k++) posts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
          for (const [x, z] of posts) { const y = H(x, z), p = new THREE.Mesh(new THREE.BoxGeometry(0.08, h + 0.3, 0.08), post); p.position.set(x, y - 0.3 + (h + 0.3) / 2, z); add(p, it, 'block'); }
          for (const [ax, az, bx, bz] of pieces(it.points, step)) { const g = Math.min(H(ax, az), H(bx, bz)), y = (H(ax, az) + H(bx, bz)) / 2;
            add(boxAlong(ax, az, bx, bz, w, g + 0.06, y + h - 0.04, panel), it, 'block'); }
          continue;
        }
        const m = plain(it.color || L.color, it.kind === 'hedge' ? { flatShading: true } : {});
        for (const [ax, az, bx, bz] of pieces(it.points, step)) {
          const ga = H(ax, az), gb = H(bx, bz), bottom = Math.min(ga, gb) - 0.1, top = (ga + gb) / 2 + h;
          const b = add(boxAlong(ax, az, bx, bz, w, bottom, top, m), it, 'block');
          if (it.kind === 'hedge') b.scale.x = 1 + w * 0.5 / Math.max(0.2, Math.hypot(bx - ax, bz - az));   // overlap, so the hedge has no gaps on bends
        }
      } else if (it.type === 'tree' && Number.isFinite(it.x) && Number.isFinite(it.z)) {
        const h = it.height ?? 6, d = it.crown ?? Math.max(1.5, h * 0.6), shape = TREE_SHAPES[it.shape] ? it.shape : 'round', y = H(it.x, it.z);
        const crownH = shape === 'conic' ? h * 0.8 : shape === 'columnar' ? h * 0.75 : Math.min(h * 0.65, d * 1.1);
        const v = (hashId(it.id ?? `${it.x},${it.z}`) % 1000) / 1000;
        const color = it.color || new THREE.Color().setHSL(shape === 'conic' ? 0.3 : 0.24 + 0.05 * v, 0.4, shape === 'conic' ? 0.22 : 0.3 + 0.05 * v);
        const trunkH = h - crownH * 0.85, tr = 0.05 + 0.012 * h;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(tr * 0.8, tr, trunkH + 0.3, 8), plain('#5a4532'));
        trunk.position.set(it.x, y - 0.3 + (trunkH + 0.3) / 2, it.z); add(trunk, it, 'block');
        const geo = shape === 'conic' ? new THREE.ConeGeometry(d / 2, crownH, 9) : new THREE.IcosahedronGeometry(1, 1);
        const crown = new THREE.Mesh(geo, plain(color, { flatShading: true }));
        crown.position.set(it.x, y + h - crownH / 2, it.z);
        if (shape !== 'conic') crown.scale.set(d / 2, crownH / 2, d / 2);
        crown.rotation.y = v * Math.PI; add(crown, it);
      } else if (it.type === 'shrub' && Number.isFinite(it.x) && Number.isFinite(it.z)) {
        const h = it.height ?? 1.2, d = it.crown ?? h, y = H(it.x, it.z);
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), plain(it.color || '#5d8048', { flatShading: true }));
        m.scale.set(d / 2, h / 2, d / 2); m.position.set(it.x, y + h / 2 - 0.05, it.z); add(m, it, 'block');
      } else if (it.type === 'object' && Number.isFinite(it.x) && Number.isFinite(it.z)) {
        const O = OBJECTS[it.kind] || OBJECTS.box, [W, D, Ht] = it.size || O.size, color = it.color || O.color;
        const g = new THREE.Group(); g.position.set(it.x, it.base ?? H(it.x, it.z), it.z); g.rotation.y = (it.rot ?? 0) * Math.PI / 180;
        const part = (w, hh, d, m, x, y, z, walk = 'block') => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m); b.position.set(x, y, z);
          b.castShadow = b.receiveShadow = true; b.userData = { kind: 'garden', data: it, walk }; g.add(b); return b; };
        const wood = plain(color);
        if (it.kind === 'raisedbed') {
          const t = 0.05;
          for (const s of [-1, 1]) { part(W, Ht + 0.1, t, wood, 0, (Ht - 0.1) / 2, s * (D / 2 - t / 2)); part(t, Ht + 0.1, D - 2 * t, wood, s * (W / 2 - t / 2), (Ht - 0.1) / 2, 0); }
          part(W - 2 * t, 0.04, D - 2 * t, mat('soil', () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: surfaceTexture('bed', SURFACES.bed.color), roughness: 1 })), 0, Ht - 0.08, 0);
        } else if (it.kind === 'shed') {
          const wallH = Ht * 0.78;
          part(W, wallH + 0.2, D, wood, 0, (wallH - 0.2) / 2, 0);
          const roofM = plain(it.roofColor || '#4b4f52'), half = D / 2 + 0.15, rise = Ht - wallH, slope = Math.hypot(half, rise), a = Math.atan2(rise, half);
          for (const s of [-1, 1]) { const r = part(W + 0.3, 0.04, slope, roofM, 0, wallH + rise / 2, s * half / 2); r.rotation.x = s * a; }
          const gable = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, rise)]);
          for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.ShapeGeometry(gable), plain(color, { side: THREE.DoubleSide })); m.rotation.y = Math.PI / 2; m.position.set(s * W / 2, wallH, 0);
            m.userData = { kind: 'garden', data: it }; g.add(m); }
          part(0.9, 1.9, 0.03, plain('#5e4630'), 0, 0.95, D / 2 + 0.01);
        } else if (it.kind === 'bench') {
          part(W, 0.05, D * 0.75, wood, 0, Ht, 0.05 * D); part(W, 0.4, 0.04, wood, 0, Ht + 0.25, -D / 2 + 0.04);
          for (const s of [-1, 1]) part(0.06, Ht, D * 0.7, plain('#3f4345'), s * (W / 2 - 0.12), Ht / 2, 0);
        } else if (it.kind === 'table') {
          part(W, 0.04, D, wood, 0, Ht - 0.02, 0);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(0.06, Ht - 0.04, 0.06, wood, sx * (W / 2 - 0.1), (Ht - 0.04) / 2, sz * (D / 2 - 0.1));
        } else part(W, Ht, D, wood, 0, Ht / 2, 0);
        group.add(g);
      }
    } catch (e) { console.warn('Garten-Eintrag übersprungen', it?.id, e); }
  }
  return group;
}

const f2 = v => (typeof v === 'number' ? v.toFixed(2) : v);
const f1 = v => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
function netArea(it) { return polygonArea(it.outline) - (it.holes || []).reduce((s, h) => s + polygonArea(h), 0); }

// what the panel shows when a garden entry is tapped: { title, rows: [[label, value], …], note }
export function gardenInfo(it) {
  const pos = Number.isFinite(it.x) ? `${f2(it.x)}, ${f2(it.z)}` : null;
  switch (it.type) {
    case 'area': { const S = SURFACES[it.surface] || SURFACES.lawn;
      return { title: it.name || S.label, rows: [['Belag', S.label], ['Fläche', f1(netArea(it)) + ' m²'], ['Höhe', typeof it.top === 'number' ? 'OK ' + f2(it.top) : 'folgt dem Gelände'], ['ID', it.id]], note: it.note }; }
    case 'line': { const L = LINES[it.kind] || LINES.hedge, len = lineLength(it.points), w = it.width ?? L.width;
      return { title: it.name || L.label, rows: [['Art', L.label + (it.kind === 'path' ? ` (${(SURFACES[it.surface] || SURFACES.gravel).label})` : '')], ['Länge', f1(len) + ' m'],
        it.kind === 'path' ? ['Breite', f2(w) + ' m · ' + f1(len * w) + ' m²'] : ['Höhe', f2(it.height ?? L.height) + ' m'], ['ID', it.id]], note: it.note }; }
    case 'tree': { const h = it.height ?? 6;
      return { title: it.name || it.species || TREE_SHAPES[it.shape] || 'Baum', rows: [['Art', it.species || TREE_SHAPES[it.shape] || 'Laubbaum'], ['Höhe', f2(h) + ' m'], ['Krone', f2(it.crown ?? Math.max(1.5, h * 0.6)) + ' m'], ['Lage', pos], ['ID', it.id]], note: it.note }; }
    case 'shrub': return { title: it.name || it.species || 'Strauch', rows: [['Art', it.species || 'Strauch'], ['Höhe', f2(it.height ?? 1.2) + ' m'], ['Lage', pos], ['ID', it.id]], note: it.note };
    case 'object': { const O = OBJECTS[it.kind] || OBJECTS.box, [W, D, Ht] = it.size || O.size;
      return { title: it.name || O.label, rows: [['Art', O.label], ['Maße', `${f2(W)} × ${f2(D)} × ${f2(Ht)} m`], ['Lage', pos], ['ID', it.id]], note: it.note }; }
    default: return { title: it.name || 'Garten', rows: [['ID', it.id]], note: it.note };
  }
}

// one line for the panel, e.g. "Rasen 120 m² · Pflaster 30 m² · Hecke 25 m · 4 Bäume"
export function gardenSummary(items) {
  const area = new Map(), len = new Map(); let trees = 0, shrubs = 0, objects = 0;
  const addTo = (map, k, v) => map.set(k, (map.get(k) || 0) + v);
  for (const it of items || []) {
    try {
      if (it.type === 'area' && it.outline?.length >= 3) addTo(area, (SURFACES[it.surface] || SURFACES.lawn).label, netArea(it));
      else if (it.type === 'line' && it.points?.length >= 2) {
        if (it.kind === 'path') addTo(area, (SURFACES[it.surface] || SURFACES.gravel).label, lineLength(it.points) * (it.width ?? 1));
        else addTo(len, (LINES[it.kind] || LINES.hedge).label, lineLength(it.points));
      } else if (it.type === 'tree') trees++; else if (it.type === 'shrub') shrubs++; else if (it.type === 'object') objects++;
    } catch { /* skip broken entries */ }
  }
  const parts = [...area].map(([k, v]) => `${k} ${f1(v)} m²`).concat([...len].map(([k, v]) => `${k} ${f1(v)} m`));
  if (trees) parts.push(`${trees} ${trees === 1 ? 'Baum' : 'Bäume'}`);
  if (shrubs) parts.push(`${shrubs} ${shrubs === 1 ? 'Strauch' : 'Sträucher'}`);
  if (objects) parts.push(`${objects} ${objects === 1 ? 'Objekt' : 'Objekte'}`);
  return parts.join(' · ');
}
