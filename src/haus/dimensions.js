// Dimensions of the house model for the "Abmessungen" display: the outer
// outline of each level (from its exterior walls) and the clear width and
// depth of each room (from the walls around its label). Plain geometry, no
// three.js; walls that are not parallel to the axes are left out.

const MM = (v) => Math.round(v * 1000) / 1000

// Axis-aligned footprint of a wall: [x0, z0, x1, z1], or null when slanted.
function wallRect(w) {
  const [ax, az] = w.start, [bx, bz] = w.end, t = w.thickness / 2
  if (Math.abs(az - bz) < 1e-3) return [Math.min(ax, bx), az - t, Math.max(ax, bx), az + t]
  if (Math.abs(ax - bx) < 1e-3) return [ax - t, Math.min(az, bz), ax + t, Math.max(az, bz)]
  return null
}

// The outer outline of a level: straight edges with their outward normal,
// and the bounding box of each separate building (house, carport…).
export function levelOutline(model, level) {
  const rects = model.walls.filter((w) => w.level === level && w.kind === 'exterior').map(wallRect).filter(Boolean)
  if (!rects.length) return { edges: [], boxes: [] }
  // Coordinate compression: cells between all distinct wall face positions.
  const axis = (i0, i1) => {
    const v = [...new Set(rects.flatMap((r) => [MM(r[i0]), MM(r[i1])]))].sort((a, b) => a - b)
    return [v[0] - 1, ...v, v[v.length - 1] + 1]
  }
  const xs = axis(0, 2), zs = axis(1, 3), nx = xs.length - 1, nz = zs.length - 1
  const solid = new Uint8Array(nx * nz)
  for (let i = 0; i < nx; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2
    for (let j = 0; j < nz; j++) {
      const cz = (zs[j] + zs[j + 1]) / 2
      solid[i * nz + j] = rects.some((r) => cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3]) ? 1 : 0
    }
  }
  // Everything the outside cannot reach is part of a building.
  const outside = new Uint8Array(nx * nz)
  const stack = [0]
  outside[0] = 1
  while (stack.length) {
    const c = stack.pop(), i = Math.floor(c / nz), j = c % nz
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue
      const k = a * nz + b
      if (!outside[k] && !solid[k]) { outside[k] = 1; stack.push(k) }
    }
  }
  const out = (i, j) => i < 0 || j < 0 || i >= nx || j >= nz || outside[i * nz + j] === 1
  // Boundary pieces between outside and inside, merged into straight edges.
  const lines = new Map()
  const piece = (key, from, a, b) => {
    if (!lines.has(key)) lines.set(key, { ...from, parts: [] })
    lines.get(key).parts.push([a, b])
  }
  for (let i = -1; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const l = out(i, j), r = out(i + 1, j)
      if (l !== r) piece(`x${xs[i + 1]}${l ? '-' : '+'}`, { along: 'z', at: xs[i + 1], n: [l ? -1 : 1, 0] }, zs[j], zs[j + 1])
    }
  }
  for (let j = -1; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const l = out(i, j), r = out(i, j + 1)
      if (l !== r) piece(`z${zs[j + 1]}${l ? '-' : '+'}`, { along: 'x', at: zs[j + 1], n: [0, l ? -1 : 1] }, xs[i], xs[i + 1])
    }
  }
  const edges = []
  for (const line of lines.values()) {
    const parts = line.parts.sort((p, q) => p[0] - q[0])
    let [a, b] = parts[0]
    const push = () => edges.push({
      a: line.along === 'x' ? [a, line.at] : [line.at, a],
      b: line.along === 'x' ? [b, line.at] : [line.at, b],
      n: line.n, length: MM(b - a),
    })
    for (const [p, q] of parts.slice(1)) {
      if (p - b < 1e-6) b = q
      else { push(); [a, b] = [p, q] }
    }
    push()
  }
  // Separate buildings: connected inside cells, each with its bounding box.
  const seen = new Uint8Array(nx * nz), boxes = []
  for (let k = 0; k < nx * nz; k++) {
    if (outside[k] || seen[k]) continue
    const box = [Infinity, Infinity, -Infinity, -Infinity], todo = [k]
    seen[k] = 1
    while (todo.length) {
      const c = todo.pop(), i = Math.floor(c / nz), j = c % nz
      box[0] = Math.min(box[0], xs[i]); box[1] = Math.min(box[1], zs[j])
      box[2] = Math.max(box[2], xs[i + 1]); box[3] = Math.max(box[3], zs[j + 1])
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue
        const q = a * nz + b
        if (!outside[q] && !seen[q]) { seen[q] = 1; todo.push(q) }
      }
    }
    boxes.push(box)
  }
  return { edges, boxes }
}

// Clear width (along x) and depth (along z) of a room, measured from its
// label to the nearest wall faces. An axis without walls on both sides
// (a deck, an open corner) is left out, and so is a room that is clearly
// not a rectangle.
export function roomExtent(model, room) {
  const [lx, lz] = room.label
  const rects = model.walls.filter((w) => w.level === room.level).map(wallRect).filter(Boolean)
  // Nearest wall face on each side of the label.
  const above = (dir) => {
    let best = Infinity
    for (const [x0, z0, x1, z1] of rects) {
      if (dir === 'x' && lz > z0 && lz < z1 && x0 >= lx) best = Math.min(best, x0)
      if (dir === 'z' && lx > x0 && lx < x1 && z0 >= lz) best = Math.min(best, z0)
    }
    return best
  }
  const below = (dir) => {
    let best = -Infinity
    for (const [x0, z0, x1, z1] of rects) {
      if (dir === 'x' && lz > z0 && lz < z1 && x1 <= lx) best = Math.max(best, x1)
      if (dir === 'z' && lx > x0 && lx < x1 && z1 <= lz) best = Math.max(best, z1)
    }
    return best
  }
  const result = {}
  const x0 = below('x'), x1 = above('x'), z0 = below('z'), z1 = above('z')
  if (isFinite(x0) && isFinite(x1) && x1 - x0 < 20) result.x = [x0, x1]
  if (isFinite(z0) && isFinite(z1) && z1 - z0 < 20) result.z = [z0, z1]
  // Width x depth far from the room's area: not a rectangle (L-shaped
  // hall…), the rays would only measure part of it.
  if (result.x && result.z && room.area) {
    const ratio = ((x1 - x0) * (z1 - z0)) / room.area
    if (ratio < 0.8 || ratio > 1.2) return {}
  }
  return result
}

// 15.4 -> "15,40" (metres, German decimal comma).
export function metres(v) {
  return v.toFixed(2).replace('.', ',')
}
