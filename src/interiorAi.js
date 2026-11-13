// KI-Entwürfe (Einrichtung): a view of a room furnished by an image model
// on OpenRouter, through the Edge Function einrichtung-ki (the key never
// reaches the browser). Pictures are sent shrunk, as JPEG data URLs.
import { supabase } from './supabase.js'
import { loadPhoto } from './drive.js'

let check = null

// { configured, model }; asked once per page load (again after saving).
export function aiStatus({ fresh = false } = {}) {
  if (!check || fresh) {
    check = supabase.functions
      .invoke('einrichtung-ki', { body: { check: true } })
      .then(({ data, error }) =>
        error ? { configured: false, model: '' } : { configured: data?.configured === true, model: data?.model ?? '' },
      )
      .catch(() => ({ configured: false, model: '' }))
  }
  return check
}

export async function saveAiSettings(apiKey, model) {
  const { error } = await supabase.rpc('set_openrouter_settings', { api_key: apiKey, model })
  if (error) throw new Error(error.message)
  return aiStatus({ fresh: true })
}

// A picture (Drive file ID) as a JPEG data URL, at most `size` pixels long.
async function pictureAsDataUrl(fileId, size = 1024) {
  const src = await loadPhoto(fileId)
  const image = new Image()
  image.src = src
  await image.decode()
  const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.naturalWidth * scale)
  canvas.height = Math.round(image.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

// Resolves to a Blob of the furnished room; throws with a German message.
// refs: [{ photoId, title, note }]; title and note tell the model what each picture is.
export async function createDraft({ baseId, refs, note }) {
  const [base, ...images] = await Promise.all([baseId, ...refs.map((r) => r.photoId)].map((id) => pictureAsDataUrl(id)))
  const { data, error } = await supabase.functions.invoke('einrichtung-ki', {
    body: { base, refs: refs.map((r, i) => ({ image: images[i], title: r.title, note: r.note })), note },
  })
  if (error) {
    let message = error.message
    try {
      message = (await error.context.json()).error ?? message
    } catch {
      // keep the generic message
    }
    throw new Error(message)
  }
  if (!data?.image) throw new Error(data?.error ?? 'Kein Bild erhalten.')
  const response = await fetch(data.image)
  return response.blob()
}
