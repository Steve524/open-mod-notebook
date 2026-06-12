'use client'

import { useState } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUpdateVaultConnection } from '@/lib/hooks/use-vault'
import { VaultConnectionResponse, VaultSyncMode } from '@/lib/types/vault'
import { useTranslation } from '@/lib/hooks/use-translation'

interface EditVaultDialogProps {
  connection: VaultConnectionResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}

const linesToGlobs = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

export function EditVaultDialog({ connection, open, onOpenChange }: EditVaultDialogProps) {
  const { t } = useTranslation()
  const update = useUpdateVaultConnection()

  const [name, setName] = useState(connection.name)
  const [rootPath, setRootPath] = useState(connection.root_path ?? '')
  const [includeText, setIncludeText] = useState(connection.include_globs.join('\n'))
  const [excludeText, setExcludeText] = useState(connection.exclude_globs.join('\n'))
  const [syncMode, setSyncMode] = useState<VaultSyncMode>(connection.sync_mode)
  const [embed, setEmbed] = useState(connection.embed)

  const handleSave = async () => {
    if (!name.trim() || !rootPath.trim()) return
    try {
      await update.mutateAsync({
        id: connection.id,
        data: {
          name: name.trim(),
          root_path: rootPath.trim(),
          include_globs: linesToGlobs(includeText),
          exclude_globs: linesToGlobs(excludeText),
          sync_mode: syncMode,
          embed,
        },
      })
      onOpenChange(false)
    } catch {
      // toast handled by hook
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            {t('vault.editVault')}
          </DialogTitle>
          <DialogDescription>{t('vault.editVaultDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-vault-name">{t('vault.nameLabel')}</Label>
            <Input
              id="edit-vault-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-vault-path">{t('vault.pathLabel')}</Label>
            <Input
              id="edit-vault-path"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{t('vault.editPathHelp')}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-vault-include">{t('vault.includeLabel')}</Label>
              <Textarea
                id="edit-vault-include"
                value={includeText}
                onChange={(e) => setIncludeText(e.target.value)}
                rows={4}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-vault-exclude">{t('vault.excludeLabel')}</Label>
              <Textarea
                id="edit-vault-exclude"
                value={excludeText}
                onChange={(e) => setExcludeText(e.target.value)}
                rows={4}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('vault.modeLabel')}</Label>
            <Select value={syncMode} onValueChange={(v) => setSyncMode(v as VaultSyncMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">{t('vault.modeInherit')}</SelectItem>
                <SelectItem value="manual">{t('vault.modeManual')}</SelectItem>
                <SelectItem value="live">{t('vault.modeLive')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('vault.modeHelp')}</p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="edit-vault-embed"
              checked={embed}
              onCheckedChange={(c) => setEmbed(c === true)}
            />
            <Label htmlFor="edit-vault-embed" className="cursor-pointer">
              {t('vault.embedLabel')}
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || !rootPath.trim() || update.isPending}>
            {update.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('common.saving')}
              </>
            ) : (
              t('common.save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
