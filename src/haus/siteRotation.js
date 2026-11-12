// Turns the site data (neighbours, roads, trees, terrain, north) around the
// house origin by `siteRotationDeg` from house_context. The georeference was
// taken from a slightly skewed outline of the house, so the surroundings sat
// a few degrees off; this corrects it without touching any house version.
//
// Positive degrees turn the site from +x towards +z (atan2(z, x) grows).
// The terrain grids keep their axes and are resampled.

const turn = (c, s) => ([x, z, ...rest]) => [x * c - z * s, x * s + z * c, ...rest]
// [x, y, z, ...] points (roads, power lines, trees)
const turnXyz = (c, s) => ([x, y, z, ...rest]) => [x * c - z * s, y, x * s + z * c, ...rest]

function sample(grid, x, z) {
  const find = (axis, v) => {
    let i = 0
    while (i < axis.length - 2 && v > axis[i + 1]) i++
    return [i, Math.min(1, Math.max(0, (v - axis[i]) / (axis[i + 1] - axis[i])))]
  }
  const [xi, tx] = find(grid.xs, x)
  const [zi, tz] = find(grid.zs, z)
  const r = grid.heights
  const a = r[zi][xi] * (1 - tx) + r[zi][xi + 1] * tx
  const b = r[zi + 1][xi] * (1 - tx) + r[zi + 1][xi + 1] * tx
  return a * (1 - tz) + b * tz
}

// same xs/zs, each height read from where that point was before the turn
function turnGrid(grid, c, s) {
  if (!grid?.heights) return grid
  const heights = grid.zs.map((z) =>
    grid.xs.map((x) => Math.round(sample(grid, x * c + z * s, -x * s + z * c) * 100) / 100),
  )
  return { ...grid, heights }
}

export function rotateSite(context) {
  const deg = Number(context?.siteRotationDeg)
  if (!context || !deg) return context
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const p = turn(c, s)
  const p3 = turnXyz(c, s)
  const out = structuredClone(context)
  delete out.siteRotationDeg // the result is already turned

  if (out.terrain) {
    out.terrain = turnGrid(out.terrain, c, s)
    if (out.terrain.fine) out.terrain.fine = turnGrid(out.terrain.fine, c, s)
  }
  const N = out.neighborhood
  if (N) {
    for (const b of N.buildings ?? []) {
      if (b.footprint) b.footprint = b.footprint.map(p)
      if (b.holes) b.holes = b.holes.map((h) => h.map(p))
      if (b.ridgeDir) b.ridgeDir = p(b.ridgeDir)
    }
    if (N.trees) N.trees = N.trees.map(p3)
    for (const r of N.roads ?? []) if (r.points) r.points = r.points.map(p3)
    for (const ar of N.areas ?? []) {
      if (ar.outline) ar.outline = ar.outline.map(p)
      if (ar.holes) ar.holes = ar.holes.map((h) => h.map(p))
    }
    for (const it of N.infrastructure ?? []) {
      if (it.line) it.line = it.line.map(p3)
      if (it.point) it.point = p3(it.point)
    }
    for (const ad of N.addresses ?? []) [ad.x, ad.z] = p([ad.x, ad.z])
  }
  for (const g of new Set([N?.meta?.georef, out.terrain?.georef].filter(Boolean))) {
    if (g.trueNorthInModelXZ) g.trueNorthInModelXZ = p(g.trueNorthInModelXZ).map((v) => Math.round(v * 1e4) / 1e4)
    if (g.xAxisBearingDeg != null) g.xAxisBearingDeg = Math.round((g.xAxisBearingDeg - deg) * 100) / 100
  }
  return out
}
