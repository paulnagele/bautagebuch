import { useEffect, useState } from 'react'
import { loadPhoto, useDriveConnected } from '../drive.js'

// Object URLs for photos picked in the form but not uploaded yet. They are
// few and small, so they are kept for the page's lifetime.
const previewUrls = new WeakMap()

function previewUrl(blob) {
  if (!previewUrls.has(blob)) previewUrls.set(blob, URL.createObjectURL(blob))
  return previewUrls.get(blob)
}

// Shows a photo either from a local Blob (picked but not uploaded yet) or
// from Google Drive by file id.
function DrivePhoto({ fileId, blob, alt, className, onOpen }) {
  const connected = useDriveConnected()
  const [state, setState] = useState({ source: null, src: null, failed: false })
  const source = blob ?? fileId

  useEffect(() => {
    if (blob || !connected) return
    let cancelled = false
    loadPhoto(fileId).then(
      (src) => !cancelled && setState({ source: fileId, src, failed: false }),
      () => !cancelled && setState({ source: fileId, src: null, failed: true }),
    )
    return () => {
      cancelled = true
    }
  }, [blob, fileId, connected])

  // Ignore results that belong to a previous photo.
  const current = blob
    ? { src: previewUrl(blob), failed: false }
    : state.source === source
      ? state
      : { src: null, failed: false }

  if (current.failed) {
    return <span className={`${className} image-missing`}>Photo unavailable</span>
  }
  if (!current.src) {
    return <span className={`${className} image-loading`}>{connected || blob ? '' : 'Photo'}</span>
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
