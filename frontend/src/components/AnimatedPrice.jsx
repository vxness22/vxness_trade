import { useEffect, useRef } from 'react'

/**
 * A price that moves the way a broker's does — DISPLAY ONLY.
 *
 * Two effects:
 *   glide  the shown number rolls from the previous value to the new one over
 *          ~150ms. A tick arriving mid-glide re-targets instead of restarting,
 *          so a fast feed reads as continuous motion rather than a stutter.
 *   flash  the TEXT tints green or red on a change and eases back to whatever
 *          colour it inherits. No background box.
 *
 * SAFETY — this component never writes anywhere. It renders a number and
 * nothing else: no store, no state, no callbacks. Order execution, P&L, margin
 * and SL/TP all keep reading the real value from the store, never a frame of
 * this animation. A trader's fill is the real quote, always. That is why the
 * glide is painted straight onto the DOM node instead of going through state —
 * an interpolated price must not be able to leak into anything that matters.
 *
 * The number is written with ref.textContent and the span is left childless in
 * JSX, so React never re-renders while it animates. Dozens of these on a weak
 * phone cost one text write per frame each, not a render pass.
 */
const GLIDE_MS = 150

export default function AnimatedPrice({
  value,
  digits = 2,
  className = '',
  glide = true,
  flash = true,
  ...rest
}) {
  const ref = useRef(null)
  const fromRef = useRef(null)     // where this glide started
  const shownRef = useRef(null)    // what is on screen right now
  const startRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const next = Number(value)
    if (!Number.isFinite(next)) {
      el.textContent = '—'
      shownRef.current = null
      return
    }

    const paint = (n) => {
      shownRef.current = n
      el.textContent = n.toFixed(digits)
    }

    const prev = shownRef.current

    // First value, or no glide asked for: show it and stop.
    if (prev === null || !glide) {
      paint(next)
      return
    }
    if (prev === next) return

    if (flash) {
      // Restart the keyframe: removing the class alone does nothing until the
      // browser has recalculated style, so the reflow read is load-bearing.
      el.classList.remove('vx-tick-up', 'vx-tick-down')
      void el.offsetWidth
      el.classList.add(next > prev ? 'vx-tick-up' : 'vx-tick-down')
    }

    // Re-target from wherever the last glide had reached.
    fromRef.current = prev
    startRef.current = performance.now()
    cancelAnimationFrame(rafRef.current)

    const step = (now) => {
      const t = Math.min(1, (now - startRef.current) / GLIDE_MS)
      // easeOutQuad: quick off the mark, settles onto the real value.
      const eased = 1 - (1 - t) * (1 - t)
      paint(fromRef.current + (next - fromRef.current) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(step)
      else paint(next) // land exactly on the real number, never an eased approximation
    }
    rafRef.current = requestAnimationFrame(step)
  }, [value, digits, glide, flash])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  return <span ref={ref} className={className} suppressHydrationWarning {...rest} />
}
