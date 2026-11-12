// "Teilen" behind the gear in the Haus tab: secret links that show one or
// more versions on haus.html without a login, always as they are now. Plain DOM
// like the rest of the viewer.
//
// mountSharePanel(el, { shares, getVersion, getVersions, onChange })
//   shares       { list, create, add, remove, revoke } (houseStore.js)
//   getVersion   () => the open version's row
//   getVersions  () => all version rows (for names)
//   onChange     (shares) => called after the list changed
// Returns { refresh() }: call it when the open version changed.
export function mountSharePanel(el, { shares, getVersion, getVersions, onChange }) {
  el.innerHTML = `
    <span class="label">Teilen</span>
    <p class="note">Wer einen Link hat, sieht die verlinkten Versionen ohne Login (bei mehreren zum Umschalten), immer im aktuellen Stand, mit Umgebung. Andere Versionen und der Rest des Bautagebuchs bleiben verborgen. Widerrufen beendet den Link sofort.</p>
    <ul class="slist" data-s="list"></ul>
    <div class="vform">
      <input data-s="label" maxlength="60" placeholder="Für wen? z. B. Architekt" aria-label="Bezeichnung des Links">
      <div class="row"><button type="button" class="btn" data-s="create">Link für diese Version erstellen</button></div>
    </div>
    <div class="vform" data-s="new" hidden>
      <input data-s="url" readonly aria-label="Neuer Link">
      <div class="row"><button type="button" class="btn primary" data-s="copy">Link kopieren</button></div>
      <p class="note">Der Link wird nur jetzt angezeigt. Geht er verloren, erstelle einfach einen neuen.</p>
    </div>
    <p class="msg" data-s="msg" role="status"></p>`
  const $ = (id) => el.querySelector(`[data-s="${id}"]`)
  let list = null
  let loading = false
  let armed = null

  const setMsg = (text, error) => {
    $('msg').textContent = text
    $('msg').className = error ? 'msg err' : 'msg'
  }

  async function load() {
    if (loading) return
    loading = true
    try {
      list = await shares.list()
      onChange?.(list)
      render()
    } catch (error) {
      setMsg(error.message, true)
    } finally {
      loading = false
    }
  }

  function render() {
    if (!list) {
      $('list').replaceChildren()
      return
    }
    const version = getVersion()
    const names = new Map(getVersions().map((v) => [v.id, v.name]))
    $('list').replaceChildren(
      ...list.map((share) => {
        const li = document.createElement('li')
        const label = document.createElement('b')
        label.textContent = share.label
        const chips = document.createElement('span')
        chips.className = 'row'
        for (const versionId of share.versionIds) {
          const name = names.get(versionId) ?? 'Version'
          const chip = document.createElement('span')
          chip.className = 'schip'
          chip.textContent = name
          if (share.versionIds.length > 1) {
            const remove = document.createElement('button')
            remove.type = 'button'
            remove.textContent = '×'
            remove.setAttribute('aria-label', `„${name}“ aus dem Link nehmen`)
            remove.title = 'Aus dem Link nehmen'
            remove.addEventListener('click', () => change(share, () => shares.remove(share, versionId), `„${name}“ aus „${share.label}“ genommen.`))
            chip.append(remove)
          }
          chips.append(chip)
        }
        const row = document.createElement('span')
        row.className = 'row'
        if (version && !share.versionIds.includes(version.id)) {
          const add = document.createElement('button')
          add.type = 'button'
          add.className = 'btn'
          add.textContent = '+ Diese Version'
          add.title = `„${version.name}“ zu diesem Link hinzufügen`
          add.addEventListener('click', () => change(share, () => shares.add(share, version.id), `„${version.name}“ zu „${share.label}“ hinzugefügt.`))
          row.append(add)
        }
        const revoke = document.createElement('button')
        revoke.type = 'button'
        revoke.className = 'btn'
        revoke.textContent = armed === share.id ? 'Wirklich widerrufen?' : 'Widerrufen'
        revoke.addEventListener('click', () => revokeLink(share))
        row.append(revoke)
        li.append(label, chips, row)
        return li
      }),
    )
    if (list.length === 0) {
      const li = document.createElement('li')
      li.className = 'empty'
      li.textContent = 'Noch keine Links.'
      $('list').append(li)
    }
  }

  async function change(share, run, done) {
    armed = null
    try {
      const row = await run()
      list = list.map((s) => (s.id === row.id ? row : s))
      onChange?.(list)
      setMsg(done)
    } catch (error) {
      setMsg(error.message, true)
    }
    render()
  }

  async function revokeLink(share) {
    if (armed !== share.id) {
      armed = share.id
      render()
      return
    }
    armed = null
    try {
      await shares.revoke(share.id)
      list = list.filter((s) => s.id !== share.id)
      onChange?.(list)
      setMsg(`Link „${share.label}“ widerrufen.`)
    } catch (error) {
      setMsg(error.message, true)
    }
    render()
  }

  $('create').addEventListener('click', async () => {
    const version = getVersion()
    const label = $('label').value.trim()
    if (!version) return
    if (!label) {
      setMsg('Bitte angeben, für wen der Link ist.', true)
      $('label').focus()
      return
    }
    const button = $('create')
    button.disabled = true
    setMsg('Link wird erstellt …')
    try {
      const { share, url } = await shares.create({ label, versionId: version.id })
      list = [...(list ?? []), share]
      onChange?.(list)
      $('label').value = ''
      $('url').value = url
      $('new').hidden = false
      setMsg(`Link „${label}“ für „${version.name}“ erstellt.`)
      render()
    } catch (error) {
      setMsg(error.message, true)
    } finally {
      button.disabled = false
    }
  })
  $('label').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      $('create').click()
    }
  })
  $('copy').addEventListener('click', () => {
    const url = $('url').value
    navigator.clipboard
      .writeText(url)
      .then(() => setMsg('Link kopiert.'))
      .catch(() => {
        $('url').focus()
        $('url').select()
        setMsg('Link markiert, bitte manuell kopieren.')
      })
  })

  return {
    refresh() {
      if (!list) load()
      else render()
    },
  }
}
