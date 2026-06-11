# Local Dev Quickstart — open-mod-notebook (Docker Compose, build from source)

This guide runs your **fork** of Open Notebook with Docker Compose, building the
`open_notebook` image from local source so your code changes are compiled in.

It uses [`docker-compose.local.yml`](docker-compose.local.yml), which builds the
image locally (the default `docker-compose.yml` pulls a pre-built image from
Docker Hub instead).

**Prerequisites:** Docker Engine + Docker Compose v2. On **Windows**, run inside
**WSL2** with Docker Desktop using the WSL2 backend, and run all commands from
the WSL2 terminal.

---

## 1. Clone the fork

```bash
git clone https://github.com/Steve524/open-mod-notebook.git
cd open-mod-notebook
```

## 2. Create your `.env` file

Create a file named `.env` in the repo root:

```bash
# REQUIRED — encrypts API keys stored in the database.
# Use a long random string and NEVER change it after first run
# (changing it breaks all saved credentials).
OPEN_NOTEBOOK_ENCRYPTION_KEY=replace-with-a-long-random-string

# Optional — only uncomment to override the defaults baked into the compose file.
# SURREAL_URL=ws://surrealdb:8000/rpc
# SURREAL_USER=root
# SURREAL_PASSWORD=root
# SURREAL_NAMESPACE=open_notebook
# SURREAL_DATABASE=open_notebook

# Optional — vault sync. Folder made browsable in-app at /host (read-only).
# Point at the PARENT of your vaults; pick examples for your OS:
#   Windows: VAULTS_HOST_DIR=C:/Users/YOUR_USERNAME
#   macOS:   VAULTS_HOST_DIR=/Users/YOUR_USERNAME
#   Linux:   VAULTS_HOST_DIR=/home/YOUR_USERNAME
```

Generate a strong key quickly:

```bash
openssl rand -base64 32
```

> AI provider keys (OpenAI, Anthropic, etc.) are **not** set here — add them in
> the app UI after startup (step 6).

## 3. Build and start

```bash
docker compose -f docker-compose.local.yml up --build -d
```

The **first build takes ~5–10 minutes** (npm `npm ci` + Python wheel/venv
compilation). Subsequent builds are much faster thanks to layer caching.

## 4. Verify services are running

```bash
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs -f open_notebook
```

Wait until the logs show the API and frontend have started, then `Ctrl+C` to
stop tailing (the containers keep running).

## 5. Access the app

- **Web UI** → http://localhost:8502
- **REST API docs** → http://localhost:5055/docs

## 6. Configure an AI provider

In the Web UI: **Settings → API Keys → Add Credential**, then add a key for
OpenAI, Anthropic, Google, Ollama, or any supported provider.

## 7. Rebuild after code changes

After editing source in your fork, rebuild and restart:

```bash
docker compose -f docker-compose.local.yml up --build -d
```

## 8. Stop everything

```bash
docker compose -f docker-compose.local.yml down
```

## 9. Nuke all data (full reset)

```bash
docker compose -f docker-compose.local.yml down -v
rm -rf ./surreal_data ./notebook_data
```

---

## Sync a local folder (Obsidian vault)

Link a folder on your machine so its documents become searchable sources, kept
in sync as you edit. **The server reads the folder, not the browser**, so the
folder is exposed to the container via a read-only bind mount.

1. Set `VAULTS_HOST_DIR` in `.env` to a folder that **contains all the vaults
   you'll ever want to link** — everything under it becomes browsable. Your
   **user profile** is the usual choice (it covers `Documents`, `Desktop`, etc.);
   use a whole drive for maximum reach:

   - Windows: `VAULTS_HOST_DIR=C:/Users/YOUR_USERNAME` (or `C:/` for the whole drive)
   - macOS: `VAULTS_HOST_DIR=/Users/YOUR_USERNAME`
   - Linux: `VAULTS_HOST_DIR=/home/YOUR_USERNAME`

   Then start/rebuild:

   ```bash
   docker compose -f docker-compose.local.yml up --build -d
   ```

   `docker-compose.local.yml` mounts `VAULTS_HOST_DIR` at `/host` (read-only),
   sets `OPEN_NOTEBOOK_VAULTS_BASE_DIR=/host` (the app can only see what's under
   that folder), `OPEN_NOTEBOOK_VAULT_WATCHER=poll` (live sync across the bind
   mount on Windows/macOS), and `OPEN_NOTEBOOK_VAULTS_HOST_LABEL` (so the UI
   shows your real paths, e.g. `C:\Users\you\Documents\Vault`).

   > **Docker Desktop file sharing:** the drive holding `VAULTS_HOST_DIR` must be
   > shared with Docker (Settings → Resources → File sharing; the WSL2 backend
   > shares your drives by default). If browsing shows nothing, this is usually why.

2. In the app, open a notebook → **Sources → Connect a vault → Link new →
   Browse**. The browser starts at your shared folder and shows native paths
   (e.g. `C:\Users\you\Documents`); click through to any subfolder and choose
   **Use this folder**, then **Link**. (You can also just paste a path like
   `C:\Users\you\Documents\My Vault`.)

   > A web app can't open the native OS file-picker for this — that returns
   > uploaded file *bytes*, not a folder the server can keep watching. So the
   > browser navigates the server's view of your shared folder instead.

3. The folder is ingested and kept in sync. **All supported document types** are
   imported — Markdown, PDF, Word/Excel/PowerPoint, plain text, source code, and
   structured data (XML, YAML) — not just Markdown. HTML, JSON, CSV, EPUB,
   images, audio, and video are skipped. Edits, adds, and deletes sync
   automatically (live watch) or via the **Refresh** button.

> The host→container mapping means the path you pick is a `/host/...` path the
> *server* sees. Only folders under `VAULTS_HOST_DIR` are visible, and the mount
> is read-only — Open Notebook never writes to your files.

See the [Vault Sync user guide](docs/3-USER-GUIDE/vault-sync.md) for details.

---

## Platform notes

- **Linux:** if SurrealDB reports `Permission denied` on its data dir, the
  `user: root` line (already in the compose file) fixes bind-mount ownership.
- **Apple Silicon (M1/M2/M3):** builds natively for `linux/arm64` — no special
  flags needed.
- **Windows:** use WSL2 + the Docker Desktop WSL2 backend; run everything from
  the WSL2 terminal, not PowerShell/CMD.
- **Corporate proxy / npm mirror:** uncomment the `args: NPM_REGISTRY:` block in
  `docker-compose.local.yml` and point it at your registry.

## Want local AI with Ollama?

You can add an `ollama` service to `docker-compose.local.yml` for free local
inference. See [`examples/docker-compose-ollama.yml`](examples/docker-compose-ollama.yml)
for the pattern.
