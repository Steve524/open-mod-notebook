'use client'

import { useState } from 'react'
import {
  FolderGit2,
  MoreVertical,
  RefreshCw,
  LogOut,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import {
  useNotebookVaultSubscriptions,
  useRefreshVaultConnection,
  useUnsubscribeVault,
} from '@/lib/hooks/use-vault'
import { VaultSubscriptionResponse } from '@/lib/types/vault'
import { useTranslation } from '@/lib/hooks/use-translation'

interface ConnectedVaultsProps {
  notebookId: string
}

function formatLastSynced(value: string | null | undefined, neverLabel: string): string {
  if (!value) return neverLabel
  try {
    const d = new Date(value.replace(' ', 'T'))
    if (Number.isNaN(d.getTime())) return neverLabel
    return d.toLocaleString()
  } catch {
    return neverLabel
  }
}

function statsSummary(sub: VaultSubscriptionResponse): string | null {
  const s = sub.connection.stats
  if (!s) return null
  const added = s.added ?? 0
  const updated = s.updated ?? 0
  const removed = s.removed ?? 0
  return `+${added} ~${updated} −${removed}`
}

export function ConnectedVaults({ notebookId }: ConnectedVaultsProps) {
  const { t } = useTranslation()
  const { data: subscriptions, isLoading } = useNotebookVaultSubscriptions(notebookId)
  const refreshConnection = useRefreshVaultConnection(notebookId)
  const unsubscribe = useUnsubscribeVault(notebookId)

  const [unsubTarget, setUnsubTarget] = useState<VaultSubscriptionResponse | null>(null)

  if (isLoading || !subscriptions || subscriptions.length === 0) {
    return null
  }

  const handleUnsubscribeConfirm = async () => {
    if (!unsubTarget) return
    try {
      await unsubscribe.mutateAsync(unsubTarget.id)
      setUnsubTarget(null)
    } catch {
      // toast handled by hook
    }
  }

  return (
    <div className="space-y-2 mb-3">
      <p className="text-xs font-medium text-muted-foreground px-1">
        {t('vault.connectedVaults')}
      </p>
      {subscriptions.map((sub) => {
        const conn = sub.connection
        const isLive = conn.sync_mode === 'live'
        const isScanning = conn.status === 'scanning'
        const isError = conn.status === 'error'
        const summary = statsSummary(sub)
        return (
          <div
            key={sub.id}
            className="flex items-start gap-2 rounded-lg border border-border p-2.5"
          >
            <FolderGit2 className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{conn.name}</span>
                <Badge variant={isLive ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                  {isLive ? t('vault.live') : t('vault.manual')}
                </Badge>
                {isScanning && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
                {isError && (
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                )}
              </div>
              <p className="text-xs text-muted-foreground font-mono truncate">
                {conn.root_path}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('vault.lastSynced')}: {formatLastSynced(conn.last_synced_at, t('vault.neverSynced'))}
                {summary ? ` · ${summary}` : ''}
              </p>
              {isError && conn.last_error && (
                <p className="text-xs text-destructive truncate">{conn.last_error}</p>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="shrink-0 rounded-md p-1 hover:bg-accent text-muted-foreground"
                  aria-label={t('common.actions')}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => refreshConnection.mutate(conn.id)}
                  disabled={isScanning}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('vault.refreshNow')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setUnsubTarget(sub)}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  {t('vault.unsubscribe')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      })}

      <ConfirmDialog
        open={!!unsubTarget}
        onOpenChange={(o) => !o && setUnsubTarget(null)}
        title={t('vault.unsubscribe')}
        description={t('vault.unsubscribeConfirm')}
        confirmText={t('vault.unsubscribe')}
        onConfirm={handleUnsubscribeConfirm}
        isLoading={unsubscribe.isPending}
        confirmVariant="destructive"
      />
    </div>
  )
}
