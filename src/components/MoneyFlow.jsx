import { useCallback, useRef, useState } from 'react'
import { usePersistentState } from '../storage.js'

// Money-flow (Sankey) diagram: funding sources → budget → expense
// categories. Transactions do not record which source paid for which
// expense, so all money flows through one "Budget" node in the middle.
// Unspent money shows as "Not yet spent"; spending beyond the secured
// funding shows as "Not yet funded", so both sides always add up.
//
// With "Show entries" on (and enough width), an outer column on each side
// breaks every source and category down into its entries, grouped by
// description.

const NODE_W = 12
const SLOT_MIN = 34 // room for a two-line label next to small nodes
const DETAIL_SLOT_MIN = 20 // one-line labels in the outer detail columns
const GAP = 6
const DETAIL_GAP = 3
const TOP = 30 // space for the budget label
const BOTTOM = 8
const HUB_HEIGHT = 260

const MIN_WIDTH = 260 // below this the diagram scrolls sideways
const DETAIL_MIN_WIDTH = 860 // narrower screens only get the three columns

// Measures the drawing area. A callback ref, so measuring starts whenever
// the element appears (it is absent while the empty message is shown).
function useWidth() {
  const [width, setWidth] = useState(0)
  const observer = useRef(null)
  const ref = useCallback((element) => {
    observer.current?.disconnect()
    observer.current = null
    if (!element) return
    observer.current = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width)),
    )
    observer.current.observe(element)
  }, [])
  return [ref, width]
}

function useTooltip() {
  const [tip, setTip] = useState(null)
  function bind(text) {
    return {
      tabIndex: 0,
      'aria-label': text,
      onMouseMove: (e) => {
        const box = e.currentTarget.closest('.chart').getBoundingClientRect()
        setTip({ text, x: e.clientX - box.left, y: e.clientY - box.top })
      },
      onFocus: (e) => {
        const box = e.currentTarget.closest('.chart').getBoundingClientRect()
        const mark = e.currentTarget.getBoundingClientRect()
        setTip({ text, x: mark.left - box.left + mark.width / 2, y: mark.top - box.top })
      },
      onMouseLeave: () => setTip(null),
      onBlur: () => setTip(null),
    }
  }
  const element = tip && (
    <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.text}
    </div>
  )
  return [bind, element]
}

// Stacks nodes in a column. Each node gets a slot at least `slotMin` high so
// labels never overlap; the node itself keeps its true (scaled) height.
function layoutColumn(nodes, scale, slotMin = SLOT_MIN, gap = GAP) {
  let y = 0
  const placed = nodes.map((node) => {
    const h = Math.max(node.value * scale, 2)
    const slot = Math.max(h, slotMin)
    const item = { ...node, y: y + (slot - h) / 2, h }
    y += slot + gap
    return item
  })
  return { nodes: placed, height: Math.max(0, y - gap) }
}

// Splits [startY, startY + total height] into consecutive bands, one per node.
function stack(nodes, scale, startY) {
  let y = startY
  return nodes.map((node) => {
    const h = node.value * scale
    const link = { node, y0: y, y1: y + h }
    y += h
    return link
  })
}

function band(x1, a0, a1, x2, b0, b1) {
  const xm = (x1 + x2) / 2
  return (
    `M${x1},${a0} C${xm},${a0} ${xm},${b0} ${x2},${b0} ` +
    `L${x2},${b1} C${xm},${b1} ${xm},${a1} ${x1},${a1} Z`
  )
}

const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
let measureContext = null

function textWidth(text, fontSize) {
  measureContext ??= document.createElement('canvas').getContext('2d')
  measureContext.font = `${fontSize}px ${FONT_FAMILY}`
  return measureContext.measureText(text).width
}

// Shortens text with "…" until it fits maxWidth pixels at the given size.
function fitText(text, maxWidth, fontSize) {
  if (maxWidth <= 0) return ''
  if (textWidth(text, fontSize) <= maxWidth) return text
  let end = text.length
  while (end > 1 && textWidth(`${text.slice(0, end)}…`, fontSize) > maxWidth) end--
  return `${text.slice(0, end).trimEnd()}…`
}

// Two-line label: name, then amount.
function NodeLabel({ x, y, anchor, name, amount, title, halo }) {
  return (
    <text
      className={halo ? 'flow-label halo' : 'flow-label'}
      x={x}
      y={y}
      textAnchor={anchor}
    >
      <title>{title}</title>
      <tspan x={x} dy="-0.2em">
        {name}
      </tspan>
      <tspan className="flow-amount" x={x} dy="1.2em">
        {amount}
      </tspan>
    </text>
  )
}

// One-line label for the detail columns: name and amount side by side.
function DetailLabel({ x, y, anchor, name, amount, title }) {
  return (
    <text className="flow-label flow-detail-label" x={x} y={y} dy="0.35em" textAnchor={anchor}>
      <title>{title}</title>
      {name}
      <tspan className="flow-amount"> {amount}</tspan>
    </text>
  )
}

// sources / targets: [{ name, value, color?, kind?, details? }] with value > 0.
// details: [{ name, value }] — the entries that make up the node.
function MoneyFlow({ sources, targets, total, format, formatShare }) {
  const [ref, measuredWidth] = useWidth()
  const width = measuredWidth > 0 ? Math.max(measuredWidth, MIN_WIDTH) : 0
  const [bind, tooltip] = useTooltip()
  const [showDetails, setShowDetails] = usePersistentState('bautagebuch.flowDetails', true)

  const hasDetails = [...sources, ...targets].some((n) => n.details?.length > 0)
  const detailsFit = width >= DETAIL_MIN_WIDTH
  const detailsOn = showDetails && hasDetails && detailsFit

  const header = (
    <div className="flow-head">
      <h2>Money flow</h2>
      {hasDetails && total > 0 && (
        <label className="flow-toggle" title={detailsFit ? undefined : 'Shown on wider screens'}>
          <input
            type="checkbox"
            checked={showDetails}
            onChange={(e) => setShowDetails(e.target.checked)}
            disabled={!detailsFit}
          />
          Show entries
        </label>
      )}
    </div>
  )

  if (total <= 0) {
    return (
      <div className="card chart money-flow">
        {header}
        <p className="muted chart-empty">
          Add funding and expenses to see where the money comes from and where it goes.
        </p>
      </div>
    )
  }

  // Phones get narrower label columns and smaller text so the whole flow fits.
  const narrow = width < 560
  const fontSize = narrow ? 11 : 12.5
  const detailFontSize = 11.5
  const scale = HUB_HEIGHT / total

  // Column x positions.
  let outerLeftX, leftX, hubX, rightX, outerRightX, labelW, innerLabelW
  if (detailsOn) {
    labelW = Math.min(200, Math.max(120, width * 0.19))
    outerLeftX = labelW
    outerRightX = width - labelW - NODE_W
    const step = (outerRightX - outerLeftX) / 4
    leftX = outerLeftX + step
    hubX = outerLeftX + 2 * step
    rightX = outerLeftX + 3 * step
    innerLabelW = step - NODE_W - 14
  } else {
    labelW = Math.min(170, Math.max(92, width * (narrow ? 0.29 : 0.24)))
    leftX = labelW
    rightX = width - labelW - NODE_W
    hubX = (leftX + rightX) / 2 - NODE_W / 2
  }
  const labelSpace = labelW - 10

  const left = layoutColumn(sources, scale)
  const right = layoutColumn(targets, scale)
  const detailsOf = (nodes) =>
    nodes.flatMap((parent) =>
      (parent.details ?? []).map((d) => ({ ...d, parent, color: parent.color })),
    )
  const outerLeft = detailsOn
    ? layoutColumn(detailsOf(left.nodes), scale, DETAIL_SLOT_MIN, DETAIL_GAP)
    : { nodes: [], height: 0 }
  const outerRight = detailsOn
    ? layoutColumn(detailsOf(right.nodes), scale, DETAIL_SLOT_MIN, DETAIL_GAP)
    : { nodes: [], height: 0 }

  const contentH = Math.max(
    left.height,
    right.height,
    outerLeft.height,
    outerRight.height,
    HUB_HEIGHT,
  )
  const centre = (h) => TOP + (contentH - h) / 2
  const leftOffset = centre(left.height)
  const rightOffset = centre(right.height)
  const outerLeftOffset = centre(outerLeft.height)
  const outerRightOffset = centre(outerRight.height)
  const hubY = centre(HUB_HEIGHT)
  const height = TOP + contentH + BOTTOM

  // Links into and out of the budget node, stacked in node order.
  const inLinks = stack(left.nodes, scale, hubY)
  const outLinks = stack(right.nodes, scale, hubY)

  // Detail links: each entry meets its parent node, stacked within it.
  function detailLinks(column, offset, parentOffset) {
    const byParent = new Map()
    for (const d of column.nodes) {
      if (!byParent.has(d.parent)) byParent.set(d.parent, [])
      byParent.get(d.parent).push(d)
    }
    return [...byParent.entries()].flatMap(([parent, details]) =>
      stack(details, scale, parent.y + parentOffset).map((link) => ({ ...link, offset })),
    )
  }
  const outerLeftLinks = detailsOn ? detailLinks(outerLeft, outerLeftOffset, leftOffset) : []
  const outerRightLinks = detailsOn ? detailLinks(outerRight, outerRightOffset, rightOffset) : []

  const describe = (n) => `${n.name}: ${format(n.value)} (${formatShare(n.value / total)})`
  const describeDetail = (d) =>
    `${d.name} (${d.parent.name}): ${format(d.value)} (${formatShare(d.value / total)})`
  const nodeClass = (n) => `flow-node ${n.kind ?? ''}`
  const linkClass = (n) => `flow-link ${n.kind ?? ''}`
  const fill = (n) => (n.color ? { fill: n.color } : undefined)

  // Inner labels sit over the flows towards the budget when details are on.
  const leftLabel = detailsOn
    ? { x: leftX + NODE_W + 6, anchor: 'start', space: innerLabelW, halo: true }
    : { x: leftX - 6, anchor: 'end', space: labelSpace, halo: false }
  const rightLabel = detailsOn
    ? { x: rightX - 6, anchor: 'end', space: innerLabelW, halo: true }
    : { x: rightX + NODE_W + 6, anchor: 'start', space: labelSpace, halo: false }

  const detailName = (d, space) => {
    const amount = ` ${format(d.value)}`
    return fitText(d.name, space - textWidth(amount, detailFontSize), detailFontSize)
  }

  return (
    <div className="card chart money-flow">
      {header}
      <div ref={ref} className="flow-canvas">
        {width > 0 && (
          <svg
            className={narrow ? 'narrow' : undefined}
            width={width}
            height={height}
            role="img"
            aria-label={
              `Money flow. Sources: ${sources.map(describe).join('; ')}. ` +
              `Uses: ${targets.map(describe).join('; ')}.`
            }
          >
            {outerLeftLinks.map(({ node, y0, y1, offset }, i) => (
              <path
                key={`ol-${i}`}
                className={linkClass(node)}
                d={band(outerLeftX + NODE_W, node.y + offset, node.y + offset + node.h, leftX, y0, y1)}
                style={fill(node)}
                {...bind(describeDetail(node))}
              />
            ))}
            {inLinks.map(({ node, y0, y1 }) => (
              <path
                key={`in-${node.name}`}
                className={linkClass(node)}
                d={band(leftX + NODE_W, node.y + leftOffset, node.y + leftOffset + node.h, hubX, y0, y1)}
                style={fill(node)}
                {...bind(describe(node))}
              />
            ))}
            {outLinks.map(({ node, y0, y1 }) => (
              <path
                key={`out-${node.name}`}
                className={linkClass(node)}
                d={band(hubX + NODE_W, y0, y1, rightX, node.y + rightOffset, node.y + rightOffset + node.h)}
                {...bind(describe(node))}
              />
            ))}
            {outerRightLinks.map(({ node, y0, y1, offset }, i) => (
              <path
                key={`or-${i}`}
                className={linkClass(node)}
                d={band(rightX + NODE_W, y0, y1, outerRightX, node.y + offset, node.y + offset + node.h)}
                {...bind(describeDetail(node))}
              />
            ))}

            {outerLeft.nodes.map((d, i) => (
              <g key={`old-${i}`}>
                <rect
                  className={nodeClass(d)}
                  x={outerLeftX}
                  y={d.y + outerLeftOffset}
                  width={NODE_W}
                  height={d.h}
                  rx="3"
                  style={fill(d)}
                />
                <DetailLabel
                  x={outerLeftX - 6}
                  y={d.y + outerLeftOffset + d.h / 2}
                  anchor="end"
                  name={detailName(d, labelSpace)}
                  amount={format(d.value)}
                  title={describeDetail(d)}
                />
              </g>
            ))}

            {left.nodes.map((n) => (
              <g key={`l-${n.name}`}>
                <rect
                  className={nodeClass(n)}
                  x={leftX}
                  y={n.y + leftOffset}
                  width={NODE_W}
                  height={n.h}
                  rx="3"
                  style={fill(n)}
                />
                <NodeLabel
                  x={leftLabel.x}
                  y={n.y + leftOffset + n.h / 2}
                  anchor={leftLabel.anchor}
                  halo={leftLabel.halo}
                  name={`${n.kind === 'unfunded' ? '⚠ ' : ''}${fitText(n.name, leftLabel.space, fontSize)}`}
                  amount={format(n.value)}
                  title={describe(n)}
                />
              </g>
            ))}

            <rect className="flow-node hub" x={hubX} y={hubY} width={NODE_W} height={HUB_HEIGHT} rx="3" />
            {/* Above all flows, so it never collides with them. */}
            <text className="flow-label flow-hub-label" x={hubX + NODE_W / 2} y={TOP - 12} textAnchor="middle">
              {narrow ? format(total) : `Budget ${format(total)}`}
            </text>

            {right.nodes.map((n) => (
              <g key={`r-${n.name}`}>
                <rect
                  className={nodeClass(n)}
                  x={rightX}
                  y={n.y + rightOffset}
                  width={NODE_W}
                  height={n.h}
                  rx="3"
                />
                <NodeLabel
                  x={rightLabel.x}
                  y={n.y + rightOffset + n.h / 2}
                  anchor={rightLabel.anchor}
                  halo={rightLabel.halo}
                  name={fitText(n.name, rightLabel.space, fontSize)}
                  amount={format(n.value)}
                  title={describe(n)}
                />
              </g>
            ))}

            {outerRight.nodes.map((d, i) => (
              <g key={`ord-${i}`}>
                <rect
                  className={nodeClass(d)}
                  x={outerRightX}
                  y={d.y + outerRightOffset}
                  width={NODE_W}
                  height={d.h}
                  rx="3"
                />
                <DetailLabel
                  x={outerRightX + NODE_W + 6}
                  y={d.y + outerRightOffset + d.h / 2}
                  anchor="start"
                  name={detailName(d, labelSpace)}
                  amount={format(d.value)}
                  title={describeDetail(d)}
                />
              </g>
            ))}
          </svg>
        )}
      </div>
      {tooltip}
    </div>
  )
}

export default MoneyFlow
