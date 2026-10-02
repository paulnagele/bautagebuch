import { useCallback, useRef, useState } from 'react'

// Money-flow (Sankey) diagram: funding sources → budget → expense
// categories. Transactions do not record which source paid for which
// expense, so all money flows through one "Budget" node in the middle.
// Unspent money shows as "Not yet spent"; spending beyond the secured
// funding shows as "Not yet funded", so both sides always add up.

const NODE_W = 12
const SLOT_MIN = 34 // room for a two-line label next to small nodes
const GAP = 6
const TOP = 30 // space for the budget label
const BOTTOM = 8
const HUB_HEIGHT = 260

const MIN_WIDTH = 260 // below this the diagram scrolls sideways

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

// Stacks nodes in a column. Each node gets a slot at least SLOT_MIN high so
// labels never overlap; the node itself keeps its true (scaled) height.
function layoutColumn(nodes, scale) {
  let y = 0
  const placed = nodes.map((node) => {
    const h = Math.max(node.value * scale, 2)
    const slot = Math.max(h, SLOT_MIN)
    const item = { ...node, y: y + (slot - h) / 2, h }
    y += slot + GAP
    return item
  })
  return { nodes: placed, height: Math.max(0, y - GAP) }
}

function stackOnHub(nodes, scale, startY) {
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

// Shortens text with "…" until it fits maxWidth pixels at the given size.
function fitText(text, maxWidth, fontSize) {
  measureContext ??= document.createElement('canvas').getContext('2d')
  measureContext.font = `${fontSize}px ${FONT_FAMILY}`
  if (measureContext.measureText(text).width <= maxWidth) return text
  let end = text.length
  while (end > 1 && measureContext.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--
  return `${text.slice(0, end).trimEnd()}…`
}

// sources / targets: [{ name, value, color?, kind? }] with value > 0.
function MoneyFlow({ sources, targets, total, format, formatShare }) {
  const [ref, measuredWidth] = useWidth()
  const width = measuredWidth > 0 ? Math.max(measuredWidth, MIN_WIDTH) : 0
  const [bind, tooltip] = useTooltip()

  if (total <= 0) {
    return (
      <div className="card chart money-flow">
        <h2>Money flow</h2>
        <p className="muted chart-empty">
          Add funding and expenses to see where the money comes from and where it goes.
        </p>
      </div>
    )
  }

  // Phones get narrower label columns and smaller text so the whole flow fits.
  const narrow = width < 560
  const fontSize = narrow ? 11 : 12.5
  const labelW = Math.min(170, Math.max(92, width * (narrow ? 0.29 : 0.24)))
  const leftX = labelW
  const rightX = width - labelW - NODE_W
  const hubX = (leftX + rightX) / 2 - NODE_W / 2
  const labelSpace = labelW - 10
  const scale = HUB_HEIGHT / total

  const left = layoutColumn(sources, scale)
  const right = layoutColumn(targets, scale)
  const contentH = Math.max(left.height, right.height, HUB_HEIGHT)
  const leftOffset = TOP + (contentH - left.height) / 2
  const rightOffset = TOP + (contentH - right.height) / 2
  const hubY = TOP + (contentH - HUB_HEIGHT) / 2
  const height = TOP + contentH + BOTTOM

  // Where each link meets the budget node, stacked in node order.
  const inLinks = stackOnHub(left.nodes, scale, hubY)
  const outLinks = stackOnHub(right.nodes, scale, hubY)

  const describe = (n) => `${n.name}: ${format(n.value)} (${formatShare(n.value / total)})`
  const nodeClass = (n) => `flow-node ${n.kind ?? ''}`
  const linkClass = (n) => `flow-link ${n.kind ?? ''}`

  return (
    <div className="card chart money-flow">
      <h2>Money flow</h2>
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
            {inLinks.map(({ node, y0, y1 }) => (
              <path
                key={`in-${node.name}`}
                className={linkClass(node)}
                d={band(leftX + NODE_W, node.y + leftOffset, node.y + leftOffset + node.h, hubX, y0, y1)}
                style={node.color ? { fill: node.color } : undefined}
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

            {left.nodes.map((n) => (
              <g key={`l-${n.name}`}>
                <rect
                  className={nodeClass(n)}
                  x={leftX}
                  y={n.y + leftOffset}
                  width={NODE_W}
                  height={n.h}
                  rx="3"
                  style={n.color ? { fill: n.color } : undefined}
                />
                <text
                  className="flow-label"
                  x={leftX - 6}
                  y={n.y + leftOffset + n.h / 2}
                  textAnchor="end"
                >
                  <title>{describe(n)}</title>
                  <tspan x={leftX - 6} dy="-0.2em">
                    {n.kind === 'unfunded' ? '⚠ ' : ''}
                    {fitText(n.name, labelSpace, fontSize)}
                  </tspan>
                  <tspan className="flow-amount" x={leftX - 6} dy="1.2em">
                    {format(n.value)}
                  </tspan>
                </text>
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
                <text
                  className="flow-label"
                  x={rightX + NODE_W + 6}
                  y={n.y + rightOffset + n.h / 2}
                >
                  <title>{describe(n)}</title>
                  <tspan x={rightX + NODE_W + 6} dy="-0.2em">
                    {fitText(n.name, labelSpace, fontSize)}
                  </tspan>
                  <tspan className="flow-amount" x={rightX + NODE_W + 6} dy="1.2em">
                    {format(n.value)}
                  </tspan>
                </text>
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
