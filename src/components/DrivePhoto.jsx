import { useEffect, useState } from 'react'
import { connectDrive, loadPhoto, publicPhotoUrl } from '../drive.js'

// Object URLs for photos picked in the form but not uploaded yet. They are
// few and small, so they are kept for the page's lifetime.
const previewUrls = new WeakMap()

function previewUrl(blob) {
  if (!previewUrls.has(blob)) previewUrls.set(blob, URL.createObjectURL(blob))
  return previewUrls.get(blob)
}

// Shows a photo either from a local Blob (picked but not uploaded yet) or
// from Google Drive by file id. Drive photos load from their public link;
// only if that fails does it fall back to the device copy or the person's
// own Drive access.
function DrivePhoto({ fileId, blob, alt, className, onOpen }) {
  // status: public | loading | ready | needs-drive | failed
  const [state, setState] = useState({ source: null, status: 'public', src: null })
  const [attempt, setAttempt] = useState(0)

  // Ignore state that belongs to a previous photo.
  const current = blob
    ? { status: 'ready', src: previewUrl(blob) }
    : state.source === fileId
      ? state
      : { status: 'public', src: publicPhotoUrl(fileId) }

  function loadFallback() {
    setState({ source: fileId, status: 'loading', src: null })
    setAttempt((n) => n + 1)
  }

  useEffect(() => {
    if (blob || attempt === 0) return
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
  }, [blob, fileId, attempt])

  // Try again when the device comes back online.
  useEffect(() => {
    if (blob || current.status !== 'failed') return
    const retry = () => setState({ source: fileId, status: 'public', src: publicPhotoUrl(fileId) })
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  })

  if (current.status === 'needs-drive') {
    // Only for older photos that are not shared by link yet.
    const connectAndRetry = () => connectDrive().then(loadFallback, () => {})
    return (
      <button type="button" className={`${className} image-missing`} onClick={connectAndRetry}>
        Tap to load photo
      </button>
    )
  }
  if (current.status === 'failed') {
    return (
      <button type="button" className={`${className} image-missing`} onClick={loadFallback}>
        Photo not loaded. Tap to retry
      </button>
    )
  }
  if (current.status === 'loading') {
    return (
      <span className={`${className} image-loading`}>
        <span className="spinner" aria-label="Loading photo" />
      </span>
    )
  }

  const img = (
    <img
      src={current.src}
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={current.status === 'public' ? loadFallback : undefined}
    />
  )
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
