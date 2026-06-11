# Vault Sync (Obsidian & local folders)

Connect a local folder — typically an [Obsidian](https://obsidian.md) vault — and have its Markdown files ingested as normal Open Notebook **sources**, kept in sync as you edit. Ingestion happens **once per file** at the workspace level; notebooks **subscribe** to a vault, so the same vault can feed many notebooks with no duplicate ingestion or embedding.

> **Key idea:** the **server** reads the folder, not your browser. The path you enter is the path *as the server sees it*. On a local install that's a normal path; in Docker you bind-mount the vault and enter the in-container path (see [Docker](#docker-mounting-your-vault)).

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
   - **Folder path** — the path as the server sees it. Click **Validate** to confirm the server can read it; it reports how many Markdown files it found, with a few samples.
   - **Include / Exclude globs** — prefilled with sensible Obsidian defaults (see below). One glob per line.
   - **Embed for semantic search** — on by default.
3. Submit. The first sync starts immediately; sources appear shortly.

To point another notebook at an existing vault, use **Connect a vault → Subscribe to existing** and pick it from the list.

### Default globs

| | Default |
|---|---|
| **Include** | `**/*.md` |
| **Exclude** | `.obsidian/**`, `**/.trash/**`, `**/*.excalidraw`, `templates/**` |

These skip Obsidian's config, trash, drawings, and templates. Adjust them per vault at any time via **Edit** on the Sources page.

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
- **Markdown only by default** — change the include globs if you want other extensions; ingestion uses the same pipeline as uploaded sources.
- **Your files are never modified or deleted by Open Notebook** — sync is one-way (disk → Open Notebook).
