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
  root_path: string
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

export const DEFAULT_INCLUDE_GLOBS = ['**/*.md']
export const DEFAULT_EXCLUDE_GLOBS = [
  '.obsidian/**',
  '**/.trash/**',
  '**/*.excalidraw',
  'templates/**',
]
