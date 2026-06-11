'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Folder,
  FolderOpen,
  CornerLeftUp,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { vaultApi } from '@/lib/api/vault'
import { BrowseResponse } from '@/lib/types/vault'
import { useTranslation } from '@/lib/hooks/use-translation'

interface FolderBrowserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPath?: string
  onSelect: (path: string) => void
}

export function FolderBrowserDialog({
  open,
  onOpenChange,
  initialPath,
  onSelect,
}: FolderBrowserDialogProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<BrowseResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (path?: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await vaultApi.browse(path)
      setData(result)
    } catch {
      setError(t('vault.browseError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (open) {
      load(initialPath || undefined)
    }
    // Only re-run when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            {t('vault.browseTitle')}
          </DialogTitle>
          <DialogDescription>{t('vault.browseDesc')}</DialogDescription>
        </DialogHeader>

        {/* Current path + up */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => data?.parent && load(data.parent)}
            disabled={loading || !data?.parent}
            title={t('vault.browseUp')}
            aria-label={t('vault.browseUp')}
          >
            <CornerLeftUp className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs truncate">
            {data?.path ?? '…'}
          </div>
        </div>

        <ScrollArea className="h-[320px] border rounded-md">
          {loading ? (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-destructive gap-2">
              <AlertTriangle className="h-8 w-8" />
              <p className="text-sm">{error}</p>
            </div>
          ) : !data || data.entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
              <Folder className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">{t('vault.browseEmpty')}</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {data.entries.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  onClick={() => load(entry.path)}
                  className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                >
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0 truncate">{entry.name}</span>
                  {entry.doc_count > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      {t('vault.browseDocCount').replace('{count}', String(entry.doc_count))}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              if (data?.path) {
                onSelect(data.path)
                onOpenChange(false)
              }
            }}
            disabled={!data?.path || !data?.allowed}
          >
            {t('vault.browseUseFolder')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
