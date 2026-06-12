# Open Notebook — Obsidian plugin

Sync an [Obsidian](https://obsidian.md) vault into [Open Notebook](https://github.com/Steve524/open-mod-notebook). The plugin runs inside Obsidian and **pushes** your notes to the Open Notebook backend over HTTP(S); each note becomes a normal Open Notebook **source**, processed and embedded once, and kept in sync as you edit. A vault attaches to one **notebook**; because ingestion is keyed by the vault, several notebooks can subscribe to the same vault with no duplicate work.

> This folder is a derivative of the Apache-2.0 SurfSense Obsidian plugin, rebranded and re-pointed at Open Notebook. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

---

## Requirements

- **Obsidian** ≥ `1.5.4` (the plugin's `minAppVersion`). Works on desktop and mobile.
- A running **Open Notebook backend** reachable over HTTP(S) from the device running Obsidian.
- Your Open Notebook **API token** — this is the app password (`OPEN_NOTEBOOK_PASSWORD`). If no password is configured, the backend leaves auth open and accepts any non-empty token.

---

## Install

The plugin isn't on the community store yet, so install it manually.

### Build it

There's no published `main.js`, so build it once (Node 18+):

```bash
cd notebook_obsidian
npm install
npm run build      # tsc type-check + esbuild -> main.js
```

This produces `main.js` next to `manifest.json` and `styles.css`.

### Copy into your vault

Create the plugin folder in your vault and copy the three files into it:

```
<your-vault>/.obsidian/plugins/open-notebook-obsidian/
  ├─ manifest.json
  ├─ main.js
  └─ styles.css
```

Then in Obsidian: **Settings → Community plugins** → turn off Restricted mode if needed → enable **Open Notebook**. (If the plugin list doesn't show it, use the "Reload plugins" / reopen Obsidian.)

> **BRAT alternative:** once this plugin has its own tagged GitHub release, you can install and auto-update it with the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin instead of building by hand.

---

## Configure

Open **Settings → Open Notebook** and fill in:

1. **Server URL** — where the backend API is reachable.
   - Default Open Notebook API port: `http://localhost:5055`.
   - In this fork's local Docker stack (`docker-compose.local.yml`), the API is mapped to host port **5056**, so use `http://localhost:5056`.
2. **API token** — your `OPEN_NOTEBOOK_PASSWORD` (any non-empty value if auth is disabled). Click **Verify** to confirm it reaches the server.
3. **Notebook** — pick which Open Notebook notebook this vault syncs into (the dropdown lists your notebooks). Selecting one **connects** the vault and kicks off the first sync.
4. Optionally narrow what's synced with **Include/Exclude folders** and **Advanced exclude patterns** (defaults skip `.trash`, `_attachments`, `templates`).
5. **Force sync** re-indexes the whole vault on demand.

---

## How sync works

- **Live edits push immediately.** Create/modify/delete/rename events are queued and flushed to the backend; Markdown edits wait briefly for Obsidian's metadata cache so the payload is complete.
- **Periodic reconcile self-heals.** On an interval (Settings → *Sync interval*, default 10 min; `Off` disables it) the plugin compares a content **manifest** with the server and only uploads what actually changed — unchanged notes are skipped.
- **Renames don't re-embed.** A move re-keys the existing source and re-titles it; the content (and its embeddings) are untouched.
- **Deletes are safe.** Removing a note removes its Open Notebook source; nothing on your disk is touched (the server never had your file — only its content).
- **The queue is persistent and offline-tolerant.** Work survives restarts and retries with backoff; a `VAULT_NOT_REGISTERED` response makes the plugin reconnect and retry.

The wire contract the plugin speaks is implemented server-side in `api/routers/obsidian.py` (`/api/v1/obsidian/*` and `/api/v1/searchspaces/`).

---

## Mobile

The plugin is mobile-safe (iOS and Android): it uses Obsidian's `requestUrl` (no `fetch`/Node networking, so CORS isn't an issue) and Web Crypto for hashing. On **Android** a *Sync only on WiFi* toggle is available; iOS can't detect the network type, so that toggle is a no-op there.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **401 / "token expired or invalid"** | The API token is wrong or was rotated. Re-paste your `OPEN_NOTEBOOK_PASSWORD` in settings and **Verify**. |
| **`VAULT_NOT_REGISTERED`** | The vault isn't registered yet (or the DB was reset). Reopen settings and re-pick the **Notebook** to reconnect; the plugin also auto-reconnects on this error. |
| **Nothing syncs / "Select a notebook"** | You haven't chosen a notebook, or the token failed. Verify the token, then reload the notebook list. |
| **Self-signed / local HTTPS certs** | Point Server URL at a plain `http://` local address, or use a backend with a trusted cert; Obsidian won't accept untrusted certs. |
| **Large vault is slow / noisy** | Tighten **Include/Exclude folders** and exclude patterns so only the notes you want are pushed. |

---

## Develop

```bash
npm install
npm run dev     # esbuild watch build (rebuilds main.js on save)
npm run build   # type-check + production bundle
npm run lint    # eslint (obsidianmd rules)
```

**Project layout** (`src/`):

| File | Role |
|---|---|
| `main.ts` | Plugin entry point; wires settings, status bar, events. |
| `settings.ts` | Settings tab UI. |
| `api-client.ts` | HTTP client for the `/api/v1` wire contract (mobile-safe `requestUrl`). |
| `sync-engine.ts` | Reconcile/queue orchestration (connect → drain → reconcile → events). |
| `queue.ts` | Persistent, retrying op queue. |
| `payload.ts` | Builds a `NotePayload` from a vault file + metadata. |
| `vault-identity.ts` | Stable vault fingerprint (cross-device dedup). |
| `excludes.ts` | Folder/glob filtering. |
| `types.ts` | Shared types (ids are **strings** — Open Notebook record ids). |
| `status-*.ts` | Status bar + status modal. |

The reused sync/queue/payload/identity/excludes machinery is carried from SurfSense unchanged; only branding, the server URL default, and the id types (numeric → string) were modified for Open Notebook.
