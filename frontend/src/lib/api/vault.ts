import apiClient from './client'
import {
  VaultConnectionResponse,
  VaultSubscriptionResponse,
  CreateVaultConnectionRequest,
  UpdateVaultConnectionRequest,
  RemoveVaultResponse,
  ValidatePathResponse,
  VaultJobResponse,
  BrowseResponse,
  SupportedExtensionsResponse,
} from '@/lib/types/vault'

export const vaultApi = {
  // Connections (workspace resource)
  listConnections: async () => {
    const response = await apiClient.get<VaultConnectionResponse[]>('/vault-connections')
    return response.data
  },

  updateConnection: async (connectionId: string, data: UpdateVaultConnectionRequest) => {
    const response = await apiClient.patch<VaultConnectionResponse>(
      `/vault-connections/${connectionId}`,
      data
    )
    return response.data
  },

  removeConnection: async (connectionId: string, purgeSources: boolean) => {
    const response = await apiClient.delete<RemoveVaultResponse>(
      `/vault-connections/${connectionId}`,
      { params: { purge_sources: purgeSources } }
    )
    return response.data
  },

  refreshAll: async () => {
    const response = await apiClient.post<VaultJobResponse>('/vault-connections/refresh-all')
    return response.data
  },

  connectionStatus: async (connectionId: string) => {
    const response = await apiClient.get<{
      status: string
      last_synced_at?: string | null
      last_error?: string | null
      stats?: Record<string, number> | null
    }>(`/vault-connections/${connectionId}/status`)
    return response.data
  },

  validatePath: async (root_path: string) => {
    const response = await apiClient.post<ValidatePathResponse>('/vault/validate-path', {
      root_path,
    })
    return response.data
  },

  browse: async (path?: string) => {
    const response = await apiClient.get<BrowseResponse>('/vault/browse', {
      params: path ? { path } : undefined,
    })
    return response.data
  },

  supportedExtensions: async () => {
    const response = await apiClient.get<SupportedExtensionsResponse>(
      '/vault/supported-extensions'
    )
    return response.data
  },

  // Subscriptions (notebook <-> connection)
  listSubscriptions: async (notebookId: string) => {
    const response = await apiClient.get<VaultSubscriptionResponse[]>(
      `/notebooks/${notebookId}/vault-subscriptions`
    )
    return response.data
  },

  subscribe: async (notebookId: string, connectionId: string) => {
    const response = await apiClient.post<VaultSubscriptionResponse>(
      `/notebooks/${notebookId}/vault-subscriptions`,
      { connection_id: connectionId }
    )
    return response.data
  },

  unsubscribe: async (notebookId: string, subscriptionId: string) => {
    await apiClient.delete(
      `/notebooks/${notebookId}/vault-subscriptions/${subscriptionId}`
    )
  },

  link: async (notebookId: string, data: CreateVaultConnectionRequest) => {
    const response = await apiClient.post<VaultConnectionResponse>(
      `/notebooks/${notebookId}/vault/link`,
      data
    )
    return response.data
  },

  // Refresh (submit sync jobs; never blocks)
  refreshNotebook: async (notebookId: string) => {
    const response = await apiClient.post<VaultJobResponse>(
      `/notebooks/${notebookId}/vault/refresh`
    )
    return response.data
  },

  refreshConnection: async (connectionId: string) => {
    const response = await apiClient.post<VaultJobResponse>(
      `/vault-connections/${connectionId}/refresh`
    )
    return response.data
  },
}
