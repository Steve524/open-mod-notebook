// Vault sync types — mirror api/routers/vault.py response models.

export interface VaultStats {
  files?: number
  added?: number
  updated?: number
  removed?: number
  skipped?: number
}

export type VaultStatus = 'idle' | 'scanning' | 'watching' | 'error'
export type VaultSyncMode = 'inherit' | 'manual' | 'live'

export interface VaultConnectionResponse {
  id: string
  name: string
  root_path?: string | null  // null for push connections (no folder)
  sync_mode: VaultSyncMode
  include_globs: string[]
  exclude_globs: string[]
  embed: boolean
  status: VaultStatus
  last_synced_at?: string | null
  last_error?: string | null
  stats?: VaultStats | null
  subscriber_count: number
  file_count: number
  created?: string | null
  updated?: string | null
}

export interface VaultSubscriptionResponse {
  id: string
  connection_id: string
  connection: VaultConnectionResponse
}

export interface CreateVaultConnectionRequest {
  name: string
  root_path: string
  sync_mode?: VaultSyncMode
  include_globs?: string[]
  exclude_globs?: string[]
  embed?: boolean
  transformations?: string[]
}

export interface UpdateVaultConnectionRequest {
  name?: string
  root_path?: string
  sync_mode?: VaultSyncMode
  include_globs?: string[]
  exclude_globs?: string[]
  embed?: boolean
  transformations?: string[]
}

export interface RemoveVaultResponse {
  deleted: boolean
  purged_sources: number
}

export interface ValidatePathResponse {
  exists: boolean
  readable: boolean
  is_dir: boolean
  allowed: boolean
  file_count_estimate: number
  sample: string[]
}

export interface VaultJobResponse {
  job_ids: string[]
  status: string
}

export interface BrowseEntry {
  name: string
  path: string
  doc_count: number
}

export interface BrowseResponse {
  path: string
  parent: string | null
  display_path: string
  allowed: boolean
  entries: BrowseEntry[]
}

export interface SupportedExtensionsResponse {
  extensions: string[]
  include_globs: string[]
  exclude_globs: string[]
}

// Fallback only — the dialog fetches the authoritative globs from
// GET /api/vault/supported-extensions (single source of truth in the backend).
// Keep this in sync with SUPPORTED_EXTENSIONS in open_notebook/domain/vault.py.
const SUPPORTED_EXTENSIONS = [
  // Markdown
  'md', 'markdown', 'mdown', 'mkd',
  // Plain text
  'txt', 'text', 'rst', 'log',
  // Markup & structured data
  'xml', 'yaml', 'yml',
  // Code
  'py', 'js', 'ts', 'jsx', 'tsx', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bash', 'zsh', 'sql', 'swift', 'kt',
  // Rich documents
  'pdf', 'docx', 'xlsx', 'pptx',
]

export const DEFAULT_INCLUDE_GLOBS = SUPPORTED_EXTENSIONS.map((ext) => `**/*.${ext}`)
export const DEFAULT_EXCLUDE_GLOBS = [
  '.obsidian/**',
  '**/.trash/**',
  '**/*.excalidraw',
  '**/*.excalidraw.md',
  'templates/**',
]
