import { useEffect, useRef, useState } from 'react'
import { connectDrive, loadPhoto, makePhotosPrivate, onDriveConnected } from '../drive.js'

// Object URLs for photos picked in the form but not uploaded yet. They are
// few and small, so they are kept for the page's lifetime.
const previewUrls = new WeakMap()

function previewUrl(blob) {
  if (!previewUrls.has(blob)) previewUrls.set(blob, URL.createObjectURL(blob))
  return previewUrls.get(blob)
}

// Starts loading only once the photo is about to scroll into view, so a
// long diary does not download every photo at once.
function useNearView(ref, enabled) {
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (!enabled || near) return
    const element = ref.current
    if (!element || !('IntersectionObserver' in window)) {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((item) => item.isIntersecting)) setNear(true)
      },
      { rootMargin: '600px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, enabled, near])
  return near
}

// Shows a photo either from a local Blob (picked but not uploaded yet) or
// from Google Drive by file id. Drive photos are private: they come from
// the copy on this device or are downloaded with the person's own Drive
// access, which needs one tap to connect Drive when it has run out.
function DrivePhoto({ fileId, blob, alt, className, onOpen }) {
  // status: loading | ready | needs-drive | failed
  const [state, setState] = useState({ source: null, status: 'loading', src: null })
  const [attempt, setAttempt] = useState(0)
  const placeholder = useRef(null)
  const near = useNearView(placeholder, !blob)

  // Ignore state that belongs to a previous photo.
  const current = blob
    ? { status: 'ready', src: previewUrl(blob) }
    : state.source === fileId
      ? state
      : { status: 'loading', src: null }

  const retry = () => {
    setState({ source: fileId, status: 'loading', src: null })
    setAttempt((n) => n + 1)
  }

  useEffect(() => {
    if (blob || !near) return
    let cancelled = false
    loadPhoto(fileId).then(
      (src) => !cancelled && setState({ source: fileId, status: 'ready', src }),
      (err) =>
        !cancelled &&
        setState({ source: fileId, status: err.needsDrive ? 'needs-drive' : 'failed', src: null }),
    )
    return () => {
      cancelled = true
    }
  }, [blob, fileId, near, attempt])

  // Takes back old "Anyone with the link" sharing once Drive is connected
  // (does nothing once done on this device).
  useEffect(() => {
    if (!blob) makePhotosPrivate()?.catch(() => {})
  }, [blob])

  // Photos waiting for Drive load as soon as it is connected (one tap on
  // any of them is enough); failed ones retry when back online.
  useEffect(() => {
    if (blob) return
    if (current.status === 'needs-drive') return onDriveConnected(retry)
    if (current.status === 'failed') {
      window.addEventListener('online', retry)
      return () => window.removeEventListener('online', retry)
    }
  })

  if (current.status === 'needs-drive') {
    const connect = () => connectDrive().catch(() => {})
    return (
      <button type="button" className={`${className} image-missing`} onClick={connect}>
        Zum Laden tippen
      </button>
    )
  }
  if (current.status === 'failed') {
    return (
      <button type="button" className={`${className} image-missing`} onClick={retry}>
        Foto nicht geladen. Zum Wiederholen tippen
      </button>
    )
  }
  if (current.status === 'loading') {
    return (
      <span ref={placeholder} className={`${className} image-loading`}>
        <span className="spinner" aria-label="Foto wird geladen" />
      </span>
    )
  }

  const img = <img src={current.src} alt={alt} className={className} />
  if (onOpen) {
    return (
      <button type="button" className="image-button" onClick={() => onOpen(current.src)}>
        {img}
      </button>
    )
  }
  return img
}

export default DrivePhoto
