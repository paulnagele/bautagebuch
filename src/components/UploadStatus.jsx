import { useEffect, useState } from 'react'
import { connectDrive } from '../drive.js'
import { resumeUploads, start } from '../uploadQueue.js'
import { useUploads } from '../useUploads.js'

function countText(items) {
  const photos = items.filter((item) => item.list === 'photos').length
  const files = items.length - photos
  return [
    photos && (photos === 1 ? '1 Foto' : `${photos} Fotos`),
    files && (files === 1 ? '1 Datei' : `${files} Dateien`),
  ]
    .filter(Boolean)
    .join(' und ')
}

// A bar while saved entries' photos and files go to Drive in the
// background (see uploadQueue.js), with a button when Drive needs
// connecting again or an upload is to be tried again now.
function UploadStatus({ user }) {
  const { items, status, error, fraction } = useUploads()
  const [problem, setProblem] = useState('')

  // Continue uploads that did not finish when the app was closed.
  useEffect(() => {
    resumeUploads()
  }, [])

  if (status === 'idle') return null
  const what = countText(items)

  async function connect() {
    setProblem('')
    try {
      await connectDrive(user.email)
    } catch (err) {
      setProblem(err.message)
    }
  }

  return (
    <div className="install-hint upload-status" role="status">
      <div className="upload-status-text">
        {status === 'uploading' && <span>{what} {items.length === 1 ? 'wird' : 'werden'} hochgeladen…</span>}
        {status === 'needs-drive' && <span>{what} warten auf Google Drive.</span>}
        {status === 'retrying' && (
          <span>
            Upload unterbrochen ({error}). {what} {items.length === 1 ? 'wird' : 'werden'} gleich noch einmal versucht.
          </span>
        )}
        {problem && <span className="error">{problem}</span>}
        <div className="busy-bar" aria-hidden="true">
          <div style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      </div>
      {status === 'needs-drive' && (
        <button type="button" onClick={connect}>
          Drive verbinden
        </button>
      )}
      {status === 'retrying' && (
        <button type="button" onClick={start}>
          Jetzt versuchen
        </button>
      )}
    </div>
  )
}

export default UploadStatus
