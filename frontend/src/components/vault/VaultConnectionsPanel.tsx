'use client'

import { useState } from 'react'
import {
  FolderGit2,
  MoreVertical,
  RefreshCw,
  Pencil,
  Unlink,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useVaultConnections,
  useRefreshAllVaults,
  useRefreshConnection,
  useRemoveVaultConnection,
} from '@/lib/hooks/use-vault'
import { VaultConnectionResponse } from '@/lib/types/vault'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useLocalVaultsEnabled } from '@/lib/hooks/use-local-vaults'
import { EditVaultDialog } from '@/components/vault/EditVaultDialog'
import { RemoveVaultDialog } from '@/components/vault/RemoveVaultDialog'

function StatusBadge({ status }: { status: VaultConnectionResponse['status'] }) {
  const { t } = useTranslation()
  if (status === 'scanning') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('vault.statusScanning')}
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <AlertTriangle className="h-3 w-3" />
        {t('vault.statusError')}
      </span>
    )
  }
  if (status === 'watching') {
    return <Badge variant="default" className="text-xs">{t('vault.statusWatching')}</Badge>
  }
  return <Badge variant="secondary" className="text-xs">{t('vault.statusIdle')}</Badge>
}

function modeKey(mode: VaultConnectionResponse['sync_mode']): string {
  if (mode === 'live') return 'vault.live'
  if (mode === 'manual') return 'vault.manual'
  return 'vault.inherit'
}

function formatDate(value: string | null | undefined, neverLabel: string): string {
  if (!value) return neverLabel
  try {
    const d = new Date(value.replace(' ', 'T'))
    return Number.isNaN(d.getTime()) ? neverLabel : d.toLocaleString()
  } catch {
    return neverLabel
  }
}

export function VaultConnectionsPanel() {
  const { t } = useTranslation()
  const localEnabled = useLocalVaultsEnabled()
  const { data: connections, isLoading } = useVaultConnections()
  const refreshAll = useRefreshAllVaults()
  const refreshOne = useRefreshConnection()
  const removeConnection = useRemoveVaultConnection()

  const [editTarget, setEditTarget] = useState<VaultConnectionResponse | null>(null)
  const [removeTarget, setRemoveTarget] = useState<VaultConnectionResponse | null>(null)

  // Stay invisible for users who don't use vaults.
  if (isLoading || !connections || connections.length === 0) {
    return null
  }

  const handleRemoveConfirm = async (purgeSources: boolean) => {
    if (!removeTarget) return
    try {
      await removeConnection.mutateAsync({ id: removeTarget.id, purgeSources })
      setRemoveTarget(null)
    } catch {
      // toast handled by hook
    }
  }

  return (
    <div className="mb-6 flex-shrink-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <FolderGit2 className="h-5 w-5" />
          {t('vault.connectedVaults')}
          <span className="text-sm font-normal text-muted-foreground">
            ({connections.length})
          </span>
        </h2>
        {localEnabled && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => refreshAll.mutate()}
            disabled={refreshAll.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshAll.isPending ? 'animate-spin' : ''}`} />
            {t('vault.refreshAll')}
          </Button>
        )}
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-muted-foreground">
              <th className="h-10 px-4 text-left font-medium">{t('vault.colName')}</th>
              <th className="h-10 px-4 text-left font-medium">{t('vault.colPath')}</th>
              <th className="h-10 px-4 text-left font-medium">{t('vault.colMode')}</th>
              <th className="h-10 px-4 text-center font-medium">{t('vault.colSubscribers')}</th>
              <th className="h-10 px-4 text-center font-medium">{t('vault.colFiles')}</th>
              <th className="h-10 px-4 text-left font-medium">{t('vault.colLastSynced')}</th>
              <th className="h-10 px-4 text-left font-medium">{t('vault.colStatus')}</th>
              <th className="h-10 px-4 text-right font-medium">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {connections.map((conn) => (
              <tr key={conn.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="h-12 px-4 font-medium">{conn.name}</td>
                <td className="h-12 px-4 font-mono text-xs text-muted-foreground max-w-[260px] truncate">
                  {conn.root_path || t('vault.pushVault')}
                </td>
                <td className="h-12 px-4">
                  <Badge
                    variant={conn.sync_mode === 'live' ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {t(modeKey(conn.sync_mode))}
                  </Badge>
                </td>
                <td className="h-12 px-4 text-center">{conn.subscriber_count}</td>
                <td className="h-12 px-4 text-center">{conn.file_count}</td>
                <td className="h-12 px-4 text-muted-foreground text-xs">
                  {formatDate(conn.last_synced_at, t('vault.neverSynced'))}
                </td>
                <td className="h-12 px-4">
                  <StatusBadge status={conn.status} />
                </td>
                <td className="h-12 px-4 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t('common.actions')}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {localEnabled && (
                        <>
                          <DropdownMenuItem
                            onClick={() => refreshOne.mutate(conn.id)}
                            disabled={conn.status === 'scanning'}
                          >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            {t('vault.refreshNow')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditTarget(conn)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            {t('common.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem
                        onClick={() => setRemoveTarget(conn)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Unlink className="h-4 w-4 mr-2" />
                        {t('vault.removeLink')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <EditVaultDialog
          connection={editTarget}
          open={!!editTarget}
          onOpenChange={(o) => !o && setEditTarget(null)}
        />
      )}

      {removeTarget && (
        <RemoveVaultDialog
          connection={removeTarget}
          open={!!removeTarget}
          onOpenChange={(o) => !o && setRemoveTarget(null)}
          onConfirm={handleRemoveConfirm}
          isLoading={removeConnection.isPending}
        />
      )}
    </div>
  )
}
