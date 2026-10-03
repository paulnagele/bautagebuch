import { useEffect } from 'react'

// A photo shown over the whole page; a click or Escape closes it.
function Lightbox({ src, alt, onClose }) {
  useEffect(() => {
    const close = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <img src={src} alt={alt} />
      <button type="button" className="lightbox-close" aria-label="Schließen">
        ×
      </button>
    </div>
  )
}

export default Lightbox
