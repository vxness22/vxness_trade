import { useState, useEffect, useRef } from "react"
import { Monitor } from "lucide-react"

// Installers are served by nginx from /var/www/vxness-downloads (outside
// frontend/dist, which `npm run build` wipes). Absolute rather than relative:
// only the vxness.in server block defines `location /downloads/`, so a visitor
// on trade. or admin. would otherwise get the SPA's index.html instead of a file.
//
// ?v= is NOT decoration — bump it on every installer release.
//
// nginx sends `Cache-Control: public, max-age=14400` on /downloads/, and
// Cloudflare honours it. Replacing the file on the origin therefore changes
// nothing for up to four hours: the CDN keeps answering cf-cache-status: HIT
// with the PREVIOUS build, at its old Content-Length and Last-Modified. That is
// the worst kind of stale, because the download succeeds and looks correct.
// The query string is part of Cloudflare's cache key, so bumping it forces a
// MISS and pulls the new binary through. Same trick as tvchart.css?v=3.
export const WINDOWS_URL = "https://vxness.in/downloads/VxnessTerminal-Setup.exe?v=1.1.2"

// Flip to the .dmg URL once a macOS build has been produced and uploaded — the
// installer can only be built and notarised on a Mac.
export const MACOS_URL = null

export function WindowsLogo({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
    </svg>
  )
}

export function AppleLogo({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  )
}

/**
 * Sits inline in the navbar CTA row, left of Log In. `relative` rather than
 * fixed: the panel is anchored to the button, so the whole thing travels with
 * the header instead of floating over the hero at a hard-coded offset.
 */
export function DesktopTerminalDownload() {
  const [isOpen, setIsOpen] = useState(false)
  const wrapRef = useRef(null)

  // Close on outside click / Escape so the panel never sits stuck over the page.
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setIsOpen(false)
    }
    const onKeyDown = (e) => {
      if (e.key === "Escape") setIsOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [isOpen])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Download Desktop Terminal"
        title="Download Desktop Terminal"
        className="flex h-10 w-10 items-center justify-center rounded-full text-white shadow-md
                   bg-gradient-to-r from-emerald-500 to-lime-500
                   hover:from-emerald-400 hover:to-lime-400
                   transition-all duration-200 hover:scale-105
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
      >
        <Monitor className="h-5 w-5" />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-3 w-[290px] overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0d]/95 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <p className="px-5 pt-5 pb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
            Desktop Terminal
          </p>

          <a
            href={WINDOWS_URL}
            className="flex items-center gap-4 px-5 py-3.5 text-white transition-colors hover:bg-white/10 focus:outline-none focus-visible:bg-white/10"
            role="menuitem"
            onClick={() => setIsOpen(false)}
          >
            <WindowsLogo className="h-6 w-6 shrink-0" />
            <span className="text-[15px] font-medium">Download for Windows</span>
          </a>

          {MACOS_URL ? (
            <a
              href={MACOS_URL}
              className="flex items-center gap-4 px-5 py-3.5 text-white transition-colors hover:bg-white/10 focus:outline-none focus-visible:bg-white/10"
              role="menuitem"
              onClick={() => setIsOpen(false)}
            >
              <AppleLogo className="h-6 w-6 shrink-0" />
              <span className="text-[15px] font-medium">Download for macOS</span>
            </a>
          ) : (
            <div
              className="flex cursor-not-allowed items-center gap-4 px-5 py-3.5 text-white/40"
              role="menuitem"
              aria-disabled="true"
              title="The macOS build is not available yet"
            >
              <AppleLogo className="h-6 w-6 shrink-0" />
              <span className="flex-1 text-[15px] font-medium">Download for macOS</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                Soon
              </span>
            </div>
          )}

          <div className="h-2" />
        </div>
      )}
    </div>
  )
}

export default DesktopTerminalDownload
