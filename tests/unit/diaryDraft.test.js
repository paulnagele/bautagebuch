// The diary's draft survives closing the app (src/diaryDraft.js). jsdom
// has no Cache API, so only the text is kept, as on a phone without it.
import { beforeEach, describe, expect, it } from 'vitest'
import { clearDraft, loadDraft, saveDraft } from '../../src/diaryDraft.js'
import { emptyForm } from '../../src/diaryForm.js'

beforeEach(() => localStorage.clear())

describe('Entwurf im Tagebuch', () => {
  it('bleibt nach dem Schließen erhalten', async () => {
    const form = { ...emptyForm('defect'), work: 'Riss in der Wand' }
    await saveDraft({ form, editingId: null, open: true })
    const draft = await loadDraft()
    expect(draft.open).toBe(true)
    expect(draft.form).toMatchObject({ type: 'defect', work: 'Riss in der Wand' })
  })

  it('ein leeres, zugeklapptes Formular wird nicht gespeichert', async () => {
    await saveDraft({ form: { ...emptyForm(), work: 'x' }, editingId: null, open: false })
    await saveDraft({ form: emptyForm(), editingId: null, open: false })
    expect(await loadDraft()).toBeNull()
  })

  it('Fotos schon in Drive bleiben, neue ohne Speicher fallen weg', async () => {
    const form = {
      ...emptyForm(),
      photos: [{ key: 'drive1', fileId: 'drive1' }, { key: 'neu', blob: new File(['x'], 'neu.jpg', { type: 'image/jpeg' }) }],
    }
    await saveDraft({ form, editingId: 'e1', open: true })
    const draft = await loadDraft()
    expect(draft.editingId).toBe('e1')
    expect(draft.form.photos).toEqual([{ key: 'drive1', fileId: 'drive1' }])
  })

  it('Abmelden löscht den Entwurf', async () => {
    await saveDraft({ form: { ...emptyForm(), work: 'privat' }, editingId: null, open: true })
    await clearDraft()
    expect(await loadDraft()).toBeNull()
  })
})
