import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { vaultApi } from '@/lib/api/vault'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import {
  CreateVaultConnectionRequest,
  VaultSubscriptionResponse,
} from '@/lib/types/vault'

/** All vault connections (workspace resource). */
export function useVaultConnections(enabled = true) {
  return useQuery({
    queryKey: QUERY_KEYS.vaultConnections,
    queryFn: () => vaultApi.listConnections(),
    enabled,
    staleTime: 10 * 1000,
  })
}

/**
 * Vaults a notebook subscribes to. The embedded connection carries live
 * status/stats, so this polls while any subscription is mid-scan.
 */
export function useNotebookVaultSubscriptions(notebookId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.vaultSubscriptions(notebookId),
    queryFn: () => vaultApi.listSubscriptions(notebookId),
    enabled: !!notebookId,
    staleTime: 5 * 1000,
    refetchInterval: (query) => {
      const data = query.state.data as VaultSubscriptionResponse[] | undefined
      const scanning = data?.some((s) => s.connection.status === 'scanning')
      return scanning ? 2000 : false
    },
  })
}

function invalidateNotebookContent(
  queryClient: ReturnType<typeof useQueryClient>,
  notebookId: string
) {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.vaultSubscriptions(notebookId) })
  // New/changed vault files surface as sources — refresh those lists too.
  queryClient.invalidateQueries({ queryKey: ['sources'] })
}

export function useRefreshNotebookVaults(notebookId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: () => vaultApi.refreshNotebook(notebookId),
    onSuccess: (result) => {
      invalidateNotebookContent(queryClient, notebookId)
      toast({
        title: t('vault.refreshStarted'),
        description: t('vault.refreshStartedDesc').replace(
          '{count}',
          String(result.job_ids.length)
        ),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key), t('vault.refreshFailed')),
        variant: 'destructive',
      })
    },
  })
}

export function useRefreshVaultConnection(notebookId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (connectionId: string) => vaultApi.refreshConnection(connectionId),
    onSuccess: () => {
      invalidateNotebookContent(queryClient, notebookId)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.vaultConnections })
      toast({ title: t('vault.refreshStarted') })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key), t('vault.refreshFailed')),
        variant: 'destructive',
      })
    },
  })
}

export function useLinkVault(notebookId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (data: CreateVaultConnectionRequest) => vaultApi.link(notebookId, data),
    onSuccess: () => {
      invalidateNotebookContent(queryClient, notebookId)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.vaultConnections })
      toast({
        title: t('vault.linked'),
        description: t('vault.linkedDesc'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key), t('vault.linkFailed')),
        variant: 'destructive',
      })
    },
  })
}

export function useSubscribeVault(notebookId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (connectionId: string) => vaultApi.subscribe(notebookId, connectionId),
    onSuccess: () => {
      invalidateNotebookContent(queryClient, notebookId)
      toast({
        title: t('vault.subscribed'),
        description: t('vault.subscribedDesc'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key), t('vault.subscribeFailed')),
        variant: 'destructive',
      })
    },
  })
}

export function useUnsubscribeVault(notebookId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (subscriptionId: string) =>
      vaultApi.unsubscribe(notebookId, subscriptionId),
    onSuccess: () => {
      invalidateNotebookContent(queryClient, notebookId)
      toast({
        title: t('vault.unsubscribed'),
        description: t('vault.unsubscribedDesc'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key), t('vault.unsubscribeFailed')),
        variant: 'destructive',
      })
    },
  })
}
