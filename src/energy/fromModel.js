// Areas, volume and windows for the heating demand, worked out from a
// version of the house model (Haus tab). The heated floors are given;
// the building parts around them become rows of the calculation:
// exterior walls, windows and doors per floor and side, the roof or top
// ceiling and the floor at the bottom. A starting point to check, not a
// survey: stairs to unheated floors and other details are left out.

const GRID = 0.1 // m, for areas and volumes under the roof
const STEP = 0.05 // m, along the walls

// Levels that are heated unless chosen otherwise: all but cellars.
export function defaultHeatedLevels(model) {
  return (model.levels ?? []).filter((level) => !isCellar(level)).map((level) => level.id)
}

function isCellar(level) {
  return /keller/i.test(level.name ?? '') || level.id === 'KG'
}

export function deriveFromModel(model, heatedIds) {
  const levels = [...(model.levels ?? [])].sort((a, b) => a.floor - b.floor)
  const heated = levels.filter((level) => heatedIds.includes(level.id))
  if (heated.length === 0) throw new Error('Bitte mindestens ein beheiztes Geschoss wählen.')
  // Heated floors are taken as one block from the lowest to the highest.
  const first = levels.indexOf(heated[0])
  const last = levels.indexOf(heated[heated.length - 1])
  const block = levels.slice(first, last + 1)
  const roof = model.roof ? makeRoof(model.roof) : null
  const toBearing = bearingFrom(model.meta?.northAngleDeg ?? 0)

  const elements = []
  let bgf = 0
  let volume = 0

  block.forEach((level, index) => {
    const outline = levelOutline(model, level.id)
    if (!outline) throw new Error(`Für das Geschoss ${level.name ?? level.id} fehlt der Grundriss im Modell.`)
    const area = polygonArea(outline)
    const below = levels[first - 1]
    const above = levels[last + 1]
    const isTop = index === block.length - 1
    const isBottom = index === 0
    // Gross heights: from the underside of the lowest floor slab, up to
    // the next floor, or under the roof (capped by a top ceiling).
    const bottom = isBottom ? slabBottom(model, level) : level.floor
    const ceiling = isTop ? ceilingSlab(model, level.id) : null
    const underRoof = isTop && !above && roof
    const flatTop = isTop ? (above ? above.floor : ceiling ? ceiling.top : level.floor + (level.clearHeight ?? 2.6)) : block[index + 1].floor
    const topAt = underRoof
      ? (x, z) => Math.min(roof.top(x, z), ceiling ? ceiling.top : Infinity)
      : () => flatTop
    bgf += area

    // Walls, windows and doors, per side.
    const groundLevel = !below && level.floor < -1
    const sides = new Map()
    const edges = outlineEdges(outline)
    for (const edge of edges) {
      const bearing = toBearing(edge.normal)
      const side = sideName(bearing)
      const entry = sides.get(side) ?? { bearing, gross: 0, windows: [], doors: [] }
      entry.gross += wallArea(edge, (x, z) => Math.max(0, topAt(x, z) - bottom))
      sides.set(side, entry)
      edge.side = side
    }
    for (const wall of model.walls ?? []) {
      if (wall.level !== level.id) continue
      for (const opening of wall.openings ?? []) {
        const edge = edgeOf(edges, wall, opening)
        if (!edge) continue
        const glazed = opening.type === 'window' || opening.style === 'glazed' || /schiebe|terrass|balkon|glas/i.test(opening.label ?? '')
        const list = glazed ? sides.get(edge.side).windows : sides.get(edge.side).doors
        list.push({ area: opening.width * opening.height, label: opening.label })
      }
    }
    for (const [side, entry] of sides) {
      const windows = entry.windows.reduce((sum, item) => sum + item.area, 0)
      const doors = entry.doors.reduce((sum, item) => sum + item.area, 0)
      const net = entry.gross - windows - doors
      if (net > 0.05) {
        elements.push({
          name: `${groundLevel ? 'Kellerwand' : 'Außenwand'} ${level.id} ${side}`,
          type: groundLevel ? 'groundWall' : 'wall',
          area: round2(net),
        })
      }
      if (windows > 0) {
        elements.push({
          name: `Fenster ${level.id} ${side} (${entry.windows.length} Stk.)`,
          type: 'window',
          area: round2(windows),
          azimuth: Math.round(entry.bearing),
        })
      }
      if (doors > 0) {
        elements.push({
          name: `${entry.doors.length === 1 ? 'Tür' : 'Türen'} ${level.id} ${side}`,
          type: 'door',
          area: round2(doors),
        })
      }
    }

    // Floor at the bottom of the heated block.
    if (isBottom) {
      elements.push(
        below
          ? { name: `Decke über ${below.id}`, type: 'cellarCeiling', area: round2(area) }
          : { name: `Boden ${level.id}`, type: 'groundFloor', area: round2(area) },
      )
    }

    // Top: roof slopes and the top ceiling under the roof, or a ceiling
    // to an unheated floor above.
    if (isTop && underRoof) {
      const top = roofSurfaces(outline, roof, ceiling, bottom)
      volume += top.volume
      if (top.slope > 0.05) elements.push({ name: `Dachschräge ${level.id}`, type: 'roof', area: round2(top.slope) })
      if (top.flat > 0.05) {
        elements.push({ name: ceiling ? `Oberste Geschossdecke ${level.id}` : `Flachdach ${level.id}`, type: 'topCeiling', area: round2(top.flat) })
      }
    } else {
      volume += area * (flatTop - bottom)
      if (isTop) elements.push({ name: `Decke zu ${above ? above.id : 'Dachraum'}`, type: 'topCeiling', area: round2(area) })
    }
  })

  return {
    elements: elements.map((element) => ({ ...element, source: 'model' })),
    bgf: round2(bgf),
    volume: round2(volume),
  }
}

// The largest floor outline of a level, else its largest structural slab.
function levelOutline(model, levelId) {
  const pick = (items) =>
    items
      .filter((item) => item.level === levelId && Array.isArray(item.outline) && item.outline.length >= 3)
      .sort((a, b) => polygonArea(b.outline) - polygonArea(a.outline))[0]?.outline
  return (
    pick(model.floors ?? []) ??
    pick((model.slabs ?? []).filter((slab) => !slab.material && !slab.ceiling))
  )
}

function slabBottom(model, level) {
  const slab = (model.slabs ?? []).find(
    (item) => item.level === level.id && !item.material && !item.ceiling && Math.abs(item.top - level.floor) < 0.01,
  )
  return slab ? slab.top - (slab.thickness ?? 0) : level.floor
}

function ceilingSlab(model, levelId) {
  return (model.slabs ?? []).find((slab) => slab.level === levelId && slab.ceiling) ?? null
}

function polygonArea(points) {
  let sum = 0
  points.forEach(([x1, z1], i) => {
    const [x2, z2] = points[(i + 1) % points.length]
    sum += x1 * z2 - x2 * z1
  })
  return Math.abs(sum) / 2
}

function inside(points, x, z) {
  let hit = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]
    const [xj, zj] = points[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

// Edges of an outline with their length and outward normal.
function outlineEdges(points) {
  return points
    .map((start, i) => {
      const end = points[(i + 1) % points.length]
      const dx = end[0] - start[0]
      const dz = end[1] - start[1]
      const length = Math.hypot(dx, dz)
      if (length < 1e-6) return null
      let normal = [dz / length, -dx / length]
      const mx = (start[0] + end[0]) / 2
      const mz = (start[1] + end[1]) / 2
      if (inside(points, mx + normal[0] * 0.01, mz + normal[1] * 0.01)) normal = [-normal[0], -normal[1]]
      return { start, end, length, dir: [dx / length, dz / length], normal }
    })
    .filter(Boolean)
}

function wallArea(edge, height) {
  const steps = Math.max(1, Math.ceil(edge.length / STEP))
  const ds = edge.length / steps
  let area = 0
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds
    area += height(edge.start[0] + edge.dir[0] * t, edge.start[1] + edge.dir[1] * t) * ds
  }
  return area
}

// The outline edge an opening sits in: near the opening's centre and
// parallel to its wall. Openings in inner walls have none.
function edgeOf(edges, wall, opening) {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return null
  const cx = wall.start[0] + (dx / length) * opening.at
  const cz = wall.start[1] + (dz / length) * opening.at
  const reach = (wall.thickness ?? 0.3) + 0.1
  return (
    edges.find((edge) => {
      const parallel = Math.abs(edge.dir[0] * dz - edge.dir[1] * dx) / length < 0.05
      if (!parallel) return false
      const px = cx - edge.start[0]
      const pz = cz - edge.start[1]
      const along = px * edge.dir[0] + pz * edge.dir[1]
      const across = Math.abs(px * edge.normal[0] + pz * edge.normal[1])
      return across <= reach && along >= -0.05 && along <= edge.length + 0.05
    }) ?? null
  )
}

// Roof slopes, flat top ceiling and volume above a floor at `bottom`,
// within the outline, on a fine grid.
function roofSurfaces(outline, roof, ceiling, bottom) {
  const xs = outline.map((point) => point[0])
  const zs = outline.map((point) => point[1])
  const cell = GRID * GRID
  let slope = 0
  let flat = 0
  let volume = 0
  for (let x = Math.min(...xs) + GRID / 2; x < Math.max(...xs); x += GRID) {
    for (let z = Math.min(...zs) + GRID / 2; z < Math.max(...zs); z += GRID) {
      if (!inside(outline, x, z)) continue
      const h = roof.top(x, z)
      if (!Number.isFinite(h)) {
        flat += cell
        continue
      }
      if (ceiling && h >= ceiling.top) {
        flat += cell
        volume += cell * Math.max(0, ceiling.top - bottom)
      } else {
        const gx = (roof.top(x + 0.01, z) - roof.top(x - 0.01, z)) / 0.02
        const gz = (roof.top(x, z + 0.01) - roof.top(x, z - 0.01)) / 0.02
        const grad = Number.isFinite(gx) && Number.isFinite(gz) ? Math.hypot(gx, gz) : 0
        slope += cell * Math.sqrt(1 + grad * grad)
        volume += cell * Math.max(0, h - bottom)
      }
    }
  }
  return { slope, flat, volume }
}

// Compass bearing (0 = north, clockwise) of a direction in model
// coordinates. The model gives the angle from -z towards +x to north.
function bearingFrom(northAngleDeg) {
  const xBearing = 90 - northAngleDeg
  return ([nx, nz]) => {
    const deg = xBearing + (Math.atan2(nz, nx) * 180) / Math.PI
    return ((deg % 360) + 360) % 360
  }
}

const SIDES = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']

export function sideName(bearing) {
  return SIDES[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]
}

function round2(value) {
  return Math.round(value * 100) / 100
}

// The roof surface height at (x, z), as drawn in the Haus tab (see
// makeRoof in src/haus/viewer.js): main gable roof with its ridge along
// x, cross gables and shed dormers.
function makeRoof(r) {
  const k = Math.tan((r.pitch * Math.PI) / 180)
  const R = r.ridgeHeight
  const ez = r.eaves.z[1]
  const eaveH = R - k * ez
  const crosses = (r.crossGables ?? []).map((cg) => {
    const half = cg.width / 2
    const kc = cg.pitch != null ? Math.tan((cg.pitch * Math.PI) / 180) : (cg.ridgeHeight - eaveH) / half
    const Rc = cg.ridgeHeight != null ? cg.ridgeHeight : eaveH + kc * half
    return { center: cg.center, half, kc, Rc, s: cg.side === '+z' ? 1 : -1, zv0: Math.max(0, (R - Rc) / k), zOut: Math.abs(cg.extendTo) }
  })
  const dormers = (r.dormers ?? []).map((d) => {
    const kd = Math.tan((d.pitch * Math.PI) / 180)
    const a = (R - d.eaveHeight - kd * d.wallZ) / (k - kd)
    return { s: d.side === '+z' ? 1 : -1, a, x0: d.x[0], x1: d.x[1], wallZ: d.wallZ, h: (sz) => d.eaveHeight + kd * (d.wallZ - sz) }
  })
  const eps = 1e-6
  function top(x, z) {
    let h = x >= r.eaves.x[0] - eps && x <= r.eaves.x[1] + eps && Math.abs(z) <= ez + eps ? R - k * Math.abs(z) : -Infinity
    for (const c of crosses) {
      const a = Math.abs(x - c.center)
      const sz = c.s * z
      if (a <= c.half + eps && sz >= c.zv0 - eps && sz <= c.zOut + eps) h = Math.max(h, c.Rc - c.kc * a)
    }
    for (const d of dormers) {
      const sz = d.s * z
      if (x >= d.x0 - eps && x <= d.x1 + eps && sz >= d.a - eps && sz <= d.wallZ + eps) h = Math.max(h, d.h(sz))
    }
    return h
  }
  return { top }
}
