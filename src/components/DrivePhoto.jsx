import { useEffect, useRef, useState } from 'react'
import { loadPhoto, setWaitingForDrive, useDriveConnected } from '../drive.js'

// Object URLs for photos picked in the form but not uploaded yet. They are
// few and small, so they are kept for the page's lifetime.
const previewUrls = new WeakMap()

function previewUrl(blob) {
  if (!previewUrls.has(blob)) previewUrls.set(blob, URL.createObjectURL(blob))
  return previewUrls.get(blob)
}

// True once the element has come near the screen, so photos further down
// a long diary only load when scrolled to.
function useNearScreen(ref) {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near || !ref.current) return
    const observer = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setNear(true),
      { rootMargin: '600px' },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [near, ref])
  return near
}

// Shows a photo either from a local Blob (picked but not uploaded yet) or
// from Google Drive by file id.
function DrivePhoto({ fileId, blob, alt, className, onOpen }) {
  const connected = useDriveConnected()
  const placeholder = useRef(null)
  const near = useNearScreen(placeholder)
  // status: loading | ready | needs-drive | failed
  const [state, setState] = useState({ source: null, status: 'loading', src: null })
  const [attempt, setAttempt] = useState(0)

  function retry() {
    setState({ source: fileId, status: 'loading', src: null })
    setAttempt((n) => n + 1)
  }

  useEffect(() => {
    if (blob || !near) return
    let cancelled = false
    loadPhoto(fileId).then(
      (src) => {
        if (cancelled) return
        setWaitingForDrive(fileId, false)
        setState({ source: fileId, status: 'ready', src })
      },
      (err) => {
        if (cancelled) return
        setWaitingForDrive(fileId, Boolean(err.needsDrive))
        setState({ source: fileId, status: err.needsDrive ? 'needs-drive' : 'failed', src: null })
      },
    )
    return () => {
      cancelled = true
    }
    // `connected` re-runs the load once Drive access is granted.
  }, [blob, fileId, near, connected, attempt])

  useEffect(() => () => setWaitingForDrive(fileId, false), [fileId])

  // Try again when the device comes back online.
  useEffect(() => {
    if (blob || state.status !== 'failed') return
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  })

  // Ignore results that belong to a previous photo.
  const current = blob
    ? { status: 'ready', src: previewUrl(blob) }
    : state.source === fileId
      ? state
      : { status: 'loading', src: null }

  if (current.status === 'failed') {
    return (
      <button
        type="button"
        className={`${className} image-missing`}
        onClick={retry}
      >
        Photo not loaded. Tap to retry
      </button>
    )
  }
  if (current.status !== 'ready') {
    return (
      <span ref={placeholder} className={`${className} image-loading`}>
        {current.status === 'needs-drive' && !connected ? 'Photo' : <span className="spinner" aria-label="Loading photo" />}
      </span>
    )
  }
  if (onOpen) {
    return (
      <button type="button" className="image-button" onClick={() => onOpen(current.src)}>
        <img src={current.src} alt={alt} className={className} />
      </button>
    )
  }
  return <img src={current.src} alt={alt} className={className} />
}

export default DrivePhoto
