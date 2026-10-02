import { useEffect, useState } from 'react'
import { getImage } from '../imageStore.js'

// Shows an image from a Blob in memory or, when only an id is given,
// from IndexedDB.
function StoredImage({ id, blob, alt, className, onClick }) {
  const [src, setSrc] = useState(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let url = null
    let cancelled = false

    const source = blob ? Promise.resolve(blob) : getImage(id)
    source
      .then((data) => {
        if (cancelled) return
        if (!data) {
          setMissing(true)
          return
        }
        url = URL.createObjectURL(data)
        setSrc(url)
      })
      .catch(() => !cancelled && setMissing(true))

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [id, blob])

  if (missing) {
    return <span className={`${className ?? ''} image-missing`}>Image unavailable</span>
  }
  if (!src) {
    return <span className={`${className ?? ''} image-loading`} aria-hidden="true" />
  }
  if (onClick) {
    return (
      <button type="button" className="image-button" onClick={() => onClick(src)}>
        <img src={src} alt={alt} className={className} />
      </button>
    )
  }
  return <img src={src} alt={alt} className={className} />
}

export default StoredImage
