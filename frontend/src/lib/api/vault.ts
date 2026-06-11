import apiClient from './client'
import {
  VaultConnectionResponse,
  VaultSubscriptionResponse,
  CreateVaultConnectionRequest,
  ValidatePathResponse,
  VaultJobResponse,
} from '@/lib/types/vault'

export const vaultApi = {
  // Connections (workspace resource)
  listConnections: async () => {
    const response = await apiClient.get<VaultConnectionResponse[]>('/vault-connections')
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
