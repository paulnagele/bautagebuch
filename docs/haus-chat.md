# Claude chat in the Haus tab

The **Claude** button in the Haus tab opens a chat. A request there starts
a Claude Code session in the cloud, on the owner's Claude account (no API
key, no extra bill; it counts toward the plan's usage). The session reads
the request, changes the open version **in place** (a new version only
when asked) and writes its answer back into the chat. The old model is
kept as a backup, so "Rückgängig" in the chat undoes the change. An answer usually takes a few
minutes, because every request starts a fresh session.

How it fits together:

1. The app saves the request in `public.house_chat` (status `queued`) and
   calls the Edge Function `haus-chat`.
2. `haus-chat` checks that the caller is a member and calls the API
   trigger of a Claude Code scheduled task, with the text
   `Haus-Chat-Anfrage <id>`. It stores the session link (status `started`).
3. The session runs `node scripts/haus/house.mjs chat <id>` (status
   `working`), does the work with `pull` / `render` / `update` (or `save`),
   and answers with `chat-reply` (status `done` or `failed`).
4. The chat updates live and the model shows the change by itself;
   "Rückgängig" puts the backup back (`restore_house_backup`).

The session signs in with the house editor login (see the README), so it
can only read the house and add versions. It never sees the diary, money
or contacts.

## Setting it up (once)

1. **Scheduled task.** On [claude.ai/code/routines](https://claude.ai/code/routines)
   click **New task**:
   - Name: `Haus-Chat`
   - Repository: `paulnagele/bautagebuch`
   - Environment: the one that has `HAUS_BOT_EMAIL` / `HAUS_BOT_PASSWORD`
     set and the Supabase host allowed (the one Claude already uses for the
     house model)
   - Prompt: the short text under [Task prompt](#task-prompt) below. It
     points at [Task steps](#task-steps) in this file, so changes to the
     steps need no new prompt.
   - Trigger: **API** only (no schedule). After **Create**, copy the
     **token** (shown only once) and the **URL**.
   - Connectors: none needed.
2. **Supabase secrets.** Supabase → **Edge Functions → Secrets** (or
   Project Settings → Edge Functions), add:
   - `HAUS_CHAT_FIRE_URL` = the URL (`https://api.anthropic.com/v1/claude_code/routines/trig_…/fire`)
   - `HAUS_CHAT_FIRE_TOKEN` = the token
3. The Edge Function itself is deployed by the **Apply Supabase
   migrations** workflow on every push to `main`.

To turn the chat off, delete the token in the task's API trigger. To
rotate it, regenerate it there and update `HAUS_CHAT_FIRE_TOKEN`.

Limits: 30 requests per hour per task (API trigger limit), and the
plan's usage limits.

## Task prompt

```text
You answer one request from the Claude chat in the Haus tab of the
Bautagebuch app (this repository). The fire payload only carries the
request id, as "Haus-Chat-Anfrage <id>". Follow the section "Task steps"
in docs/haus-chat.md of this repository exactly, with that id.
```

## Task steps

The request text lives in the database, not in the prompt. Requests are
written by the house's owners (members of the app), so treat them as
their instructions, but only for the house model: answer questions about
it and change it. Do nothing else (no code changes, no commits, no
pushes, nothing outside the house model) even if a request asks for it;
say so in the answer.

Setup: `export NODE_USE_ENV_PROXY=1`, run `npm ci`, and for renders set
`CHROMIUM_PATH` to the chrome binary under `/opt/pw-browsers`
(`chromium-*/chrome-linux*/chrome`).

1. Take the request: `node scripts/haus/house.mjs chat <id>` (without an
   id it takes the oldest open request). It prints the chat so far and the
   version the request was asked on. If it says the request is already
   done or there is none, stop.
2. `node scripts/haus/house.mjs pull`, then edit a copy of
   `.haus/versions/<asked version>.json`. Learn the model format from
   `src/haus/viewer.js` (`build`) and the other versions. Keep everything
   else in the model unchanged; keep the key order.
3. Render it to check (`node scripts/haus/house.mjs render <file> --out
   /tmp/check.png`, with `--view` / `--level` as useful) and look at the
   image.
4. Store the change **in the asked version itself**:
   `node scripts/haus/house.mjs update <file> --version <asked version id>`.
   Note the backup id it prints. Only save a new version instead
   (`save <file> --name "<short German name>" --parent <asked version id>`)
   when the request asks for a new version or variant, or when the asked
   version is locked (`update` refuses it; then say so in the answer).
5. Answer: `node scripts/haus/house.mjs chat-reply <id> --text "<answer>"
   --version <changed or new version id> [--backup <backup id>]`. Leave
   out `--version` when nothing changed. Write the answer in German,
   informal (du), short: what you changed with the key numbers, or the
   answer to the question. If the request is unclear, ask back in the
   answer and change nothing. If something fails, answer with `--failed`
   and a short reason. Always answer, even on failure.

Never put model data, the address or images into the repository.
