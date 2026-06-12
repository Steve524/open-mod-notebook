# Vault Sync (Obsidian)

The supported way to sync an [Obsidian](https://obsidian.md) vault into Open Notebook is the **companion Obsidian plugin**. It runs inside Obsidian and **pushes** your notes to the backend over HTTP — no shared filesystem, bind mount, or server-side folder access required, and it works on mobile.

➡️ **See the [Obsidian plugin install guide](../../notebook_obsidian/README.md)** to build, install, and configure it.

Each note becomes a normal Open Notebook **source** in the notebook you pick, processed and embedded once, and kept in sync as you edit. A second notebook can **subscribe** to the same vault and reuse those sources with no re-ingest. All supported document types are imported (Markdown, PDF, Word/Excel/PowerPoint, plain text, source code, XML, YAML); other types are skipped.

---

## Shelved: server-side folder mount (legacy)

> **This model is shelved and off by default.** Instead of the plugin pushing notes, it made the **server** read a folder from disk (bind-mounted into Docker, browsed via a server-side folder picker). It's superseded by the push plugin above but kept and recoverable.
>
> To re-enable it, set **`OPEN_NOTEBOOK_ENABLE_LOCAL_VAULTS=true`** on the backend. While it's off, the browse / validate / link / refresh endpoints return `410` and the folder-picker UI is hidden; subscribing to and removing existing vaults still works. Everything below describes this legacy model.

---

## Concepts

- **Connection** — a connected folder (workspace-level). Holds the path, include/exclude globs, embed option, and sync mode. One source is created per file and **shared** across every notebook subscribed to the connection.
- **Subscription** — a link between a notebook and a connection. Subscribing a second notebook re-uses the existing sources (no re-ingest).
- **Two different "remove" actions** — keep them straight:
  - **Unsubscribe** (in a notebook's Sources panel) detaches *that notebook only*. The connection, its sources, and other notebooks are untouched.
  - **Remove link** (on the global **Sources** page only) deletes the whole connection and affects every subscriber. Optionally also deletes the imported sources. **Your files on disk are never deleted.**

---

## Connect a vault (from a notebook)

1. Open a notebook. In the **Sources** panel, open the **＋** menu → **Connect a vault** (or click the **↻** refresh icon when the notebook has no vaults yet).
2. **Link new:**
   - **Name** — anything memorable.
   - **Folder path** — the path as the server sees it. Use **Browse** to navigate the server's folders (starting at the mounted root), or type it. Click **Validate** to confirm the server can read it; it reports how many supported files it found, with a few samples.
   - **Include / Exclude globs** — prefilled with sensible Obsidian defaults (see below). One glob per line.
   - **Embed for semantic search** — on by default.
3. Submit. The first sync starts immediately; sources appear shortly.

To point another notebook at an existing vault, use **Connect a vault → Subscribe to existing** and pick it from the list.

### Default globs

| | Default |
|---|---|
| **Include** | One glob per supported type — `**/*.md`, `**/*.pdf`, `**/*.docx`, `**/*.xlsx`, `**/*.txt`, code files, … |
| **Exclude** | `.obsidian/**`, `**/.trash/**`, `**/*.excalidraw`, `**/*.excalidraw.md`, `templates/**` |

The include list is prefilled from the backend's canonical supported-extensions set, so it always matches what the pipeline can actually ingest. The excludes skip Obsidian's config, trash, drawings, and templates. Adjust either per vault at any time via **Edit** on the Sources page — narrow the includes to just the types you want, or add more.

---

## Keeping in sync

### Refresh (default)

Refreshing runs a 3-way diff against what was last seen: **new** files are ingested, **changed** files (different content) are re-processed, **deleted** files have their source removed. Renames keep the same source (no re-embed).

- **In a notebook** — the **↻** button in the Sources panel refreshes only that notebook's subscribed vaults.
- **On the Sources page** — **Refresh vaults** refreshes every connection; a row's kebab menu has **Refresh now** for just one.

### Live watch (optional)

With live watch, the server watches the folder and auto-syncs on every change — no Refresh needed.

- Turn it on globally in **Settings → Vault sync** (*On request* vs *Live watch*). This applies to every vault left on **Inherit**.
- Or override a single vault: **Sources page → Edit → Sync mode → Live** (or **Manual**).

Live watch needs the server running and (in Docker) the vault bind-mounted. See [Docker](#docker-mounting-your-vault) for the inotify caveat.

---

## Managing connections (Sources page)

The global **Sources** page shows a **Connected vaults** table: name, path, mode, subscriber & file counts, last-synced, and status. The row menu offers:

- **Refresh now** — re-sync this connection.
- **Edit** — change path, globs, sync mode, or embed.
- **Remove link** — delete the connection. A checkbox lets you also delete the imported sources. Spells out how many notebooks are affected. *Your files on disk stay put.*

---

## Docker: mounting your vault

The backend reads the path **as the container sees it**, so bind-mount your vault and enter the in-container path:

```yaml
services:
  open_notebook:
    volumes:
      - "/Users/me/Documents/MyVault:/vaults/MyVault:ro"   # :ro (read-only) is safest
```

Then enter `/vaults/MyVault` in the dialog and click **Validate** to confirm.

> **Live watch on bind mounts:** when the vault lives on a **Windows or macOS host**, filesystem (inotify) events often don't cross into the Linux container, so native live watch may see nothing. Set `OPEN_NOTEBOOK_VAULT_WATCHER=poll` to use a polling watcher that works across the mount. Manual **Refresh** always works regardless. Read-only mounts (`:ro`) are still fully syncable — Open Notebook never writes to your vault.

### Restricting where vaults may live

Set `OPEN_NOTEBOOK_VAULTS_BASE_DIR` to confine vault paths to one directory (e.g. `/vaults`). Paths outside it are rejected on create/update and during validation.

See the [Environment Reference](../5-CONFIGURATION/environment-reference.md#vault-sync) for both variables.

---

## Tips & limits

- **Big vaults** — tighten the include/exclude globs so you only ingest what you need; the first sync (and every live rescan) scales with file count. The Validate step warns when a folder is large.
- **Embeddings** — each file is embedded once, regardless of how many notebooks subscribe.
- **All supported document types by default** — Markdown, PDF, Word/Excel/PowerPoint, plain text, source code, and structured data (XML, YAML), using the same pipeline as uploaded sources. Narrow the include globs if you only want certain types. HTML, JSON, CSV, EPUB, images, audio, and video are not ingested (content-core can't extract them as local files).
- **Your files are never modified or deleted by Open Notebook** — sync is one-way (disk → Open Notebook).
