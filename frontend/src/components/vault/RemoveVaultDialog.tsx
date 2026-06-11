'use client'

import { useState } from 'react'
import { Loader2, Unlink, AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { VaultConnectionResponse } from '@/lib/types/vault'
import { useTranslation } from '@/lib/hooks/use-translation'

interface RemoveVaultDialogProps {
  connection: VaultConnectionResponse
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (purgeSources: boolean) => void
  isLoading: boolean
}

export function RemoveVaultDialog({
  connection,
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: RemoveVaultDialogProps) {
  const { t } = useTranslation()
  const [purge, setPurge] = useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Unlink className="h-5 w-5" />
            {t('vault.removeLink')}
          </DialogTitle>
          <DialogDescription>
            {t('vault.removeLinkConfirm')
              .replace('{name}', connection.name)
              .replace('{count}', String(connection.subscriber_count))}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            <p className="text-muted-foreground">
              {t('vault.removeLinkBlastRadius').replace(
                '{count}',
                String(connection.subscriber_count)
              )}
            </p>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="purge-sources"
              checked={purge}
              onCheckedChange={(c) => setPurge(c === true)}
              className="mt-0.5"
            />
            <Label htmlFor="purge-sources" className="cursor-pointer text-sm font-normal">
              {t('vault.deleteSources').replace('{count}', String(connection.file_count))}
              <span className="block text-xs text-muted-foreground mt-0.5">
                {t('vault.deleteSourcesHelp')}
              </span>
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(purge)}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('vault.removeLink')}
              </>
            ) : (
              t('vault.removeLink')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
