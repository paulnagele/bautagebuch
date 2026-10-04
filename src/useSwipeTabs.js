import { useEffect, useRef } from 'react'

// How far (px) a finger has to travel sideways before it counts as a swipe,
// and how much more sideways than up or down the motion has to be.
const MIN_DISTANCE = 70
const SIDEWAYS_RATIO = 1.8
// Slow drags are more likely reading or selecting text than a swipe.
const MAX_DURATION = 700
// Swipes from the very edge belong to the browser (back / forward).
const EDGE = 24

// Places where a sideways drag already means something else.
const IGNORE = 'input, textarea, select, [contenteditable], dialog, [role="dialog"], [role="alertdialog"], [data-no-swipe]'

// True if the touch started inside something that scrolls sideways itself,
// such as a wide table, so the swipe belongs to it.
function inHorizontalScroller(target) {
  for (let node = target; node && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX
      if (overflow === 'auto' || overflow === 'scroll') return true
    }
  }
  return false
}

// Calls onSwipe(+1) for a swipe to the left (next tab) and onSwipe(-1) for
// a swipe to the right (previous tab) anywhere on the page. Touch only: on
// a desktop with a mouse nothing changes.
export function useSwipeTabs(onSwipe) {
  // Kept in a ref so a re-render mid-swipe doesn't drop the touch.
  const onSwipeRef = useRef(onSwipe)
  useEffect(() => {
    onSwipeRef.current = onSwipe
  })

  useEffect(() => {
    let start = null

    function handleStart(event) {
      start = null
      if (event.touches.length !== 1) return
      // When zoomed in, a sideways drag pans the page.
      if ((window.visualViewport?.scale ?? 1) > 1.01) return
      const touch = event.touches[0]
      if (touch.clientX < EDGE || touch.clientX > window.innerWidth - EDGE) return
      if (event.target.closest?.(IGNORE)) return
      if (inHorizontalScroller(event.target)) return
      start = { x: touch.clientX, y: touch.clientY, time: Date.now() }
    }

    function handleEnd(event) {
      if (!start) return
      const touch = event.changedTouches[0]
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      const elapsed = Date.now() - start.time
      start = null
      if (elapsed > MAX_DURATION) return
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * SIDEWAYS_RATIO) return
      // Leave text selection alone.
      if (String(window.getSelection?.() ?? '')) return
      onSwipeRef.current(dx < 0 ? 1 : -1)
    }

    function handleCancel() {
      start = null
    }

    document.addEventListener('touchstart', handleStart, { passive: true })
    document.addEventListener('touchend', handleEnd, { passive: true })
    document.addEventListener('touchcancel', handleCancel, { passive: true })
    return () => {
      document.removeEventListener('touchstart', handleStart)
      document.removeEventListener('touchend', handleEnd)
      document.removeEventListener('touchcancel', handleCancel)
    }
  }, [])
}
