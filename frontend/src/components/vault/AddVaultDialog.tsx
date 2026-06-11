'use client'

import { useState } from 'react'
import {
  FolderGit2,
  FolderSearch,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Link2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { vaultApi } from '@/lib/api/vault'
import { FolderBrowserDialog } from '@/components/vault/FolderBrowserDialog'
import {
  useVaultConnections,
  useLinkVault,
  useSubscribeVault,
} from '@/lib/hooks/use-vault'
import {
  DEFAULT_INCLUDE_GLOBS,
  DEFAULT_EXCLUDE_GLOBS,
  ValidatePathResponse,
} from '@/lib/types/vault'
import { useTranslation } from '@/lib/hooks/use-translation'

interface AddVaultDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  onSuccess?: () => void
}

// Above this many markdown files, suggest tightening globs — the first sync
// (and any live rescan) gets noticeably heavier.
const LARGE_VAULT_THRESHOLD = 2000

const linesToGlobs = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

export function AddVaultDialog({
  open,
  onOpenChange,
  notebookId,
  onSuccess,
}: AddVaultDialogProps) {
  const { t } = useTranslation()

  // Link-new form state
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [includeText, setIncludeText] = useState(DEFAULT_INCLUDE_GLOBS.join('\n'))
  const [excludeText, setExcludeText] = useState(DEFAULT_EXCLUDE_GLOBS.join('\n'))
  const [embed, setEmbed] = useState(true)
  const [validation, setValidation] = useState<ValidatePathResponse | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)

  // Subscribe state
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)

  const { data: connections, isLoading: connectionsLoading } = useVaultConnections(open)
  const linkVault = useLinkVault(notebookId)
  const subscribeVault = useSubscribeVault(notebookId)

  const resetAndClose = () => {
    setName('')
    setRootPath('')
    setIncludeText(DEFAULT_INCLUDE_GLOBS.join('\n'))
    setExcludeText(DEFAULT_EXCLUDE_GLOBS.join('\n'))
    setEmbed(true)
    setValidation(null)
    setSelectedConnectionId(null)
    onOpenChange(false)
  }

  const handleValidate = async () => {
    if (!rootPath.trim()) return
    setIsValidating(true)
    setValidation(null)
    try {
      const result = await vaultApi.validatePath(rootPath.trim())
      setValidation(result)
    } catch {
      setValidation({
        exists: false,
        readable: false,
        is_dir: false,
        allowed: true,
        file_count_estimate: 0,
        sample: [],
      })
    } finally {
      setIsValidating(false)
    }
  }

  const handleLink = async () => {
    if (!name.trim() || !rootPath.trim()) return
    try {
      await linkVault.mutateAsync({
        name: name.trim(),
        root_path: rootPath.trim(),
        include_globs: linesToGlobs(includeText),
        exclude_globs: linesToGlobs(excludeText),
        embed,
      })
      resetAndClose()
      onSuccess?.()
    } catch {
      // toast handled by hook
    }
  }

  const handleSubscribe = async () => {
    if (!selectedConnectionId) return
    try {
      await subscribeVault.mutateAsync(selectedConnectionId)
      resetAndClose()
      onSuccess?.()
    } catch {
      // toast handled by hook
    }
  }

  const pathOk =
    validation && validation.exists && validation.is_dir && validation.readable && validation.allowed

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : resetAndClose())}>
      <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderGit2 className="h-5 w-5" />
            {t('vault.addVault')}
          </DialogTitle>
          <DialogDescription>{t('vault.addVaultDesc')}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="link" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="link">{t('vault.linkNew')}</TabsTrigger>
            <TabsTrigger value="subscribe">{t('vault.subscribeExisting')}</TabsTrigger>
          </TabsList>

          {/* Link a new vault */}
          <TabsContent value="link" className="flex-1 overflow-y-auto space-y-4 px-1 pt-2">
            <div className="space-y-2">
              <Label htmlFor="vault-name">{t('vault.nameLabel')}</Label>
              <Input
                id="vault-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('vault.namePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vault-path">{t('vault.pathLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="vault-path"
                  value={rootPath}
                  onChange={(e) => {
                    setRootPath(e.target.value)
                    setValidation(null)
                  }}
                  placeholder="/vaults/MyVault"
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBrowserOpen(true)}
                  title={t('vault.browse')}
                >
                  <FolderSearch className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleValidate}
                  disabled={!rootPath.trim() || isValidating}
                >
                  {isValidating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t('vault.validate')
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('vault.pathHelp')}</p>

              {validation && (
                <div
                  className={`flex items-start gap-2 rounded-md border p-2 text-xs ${
                    pathOk
                      ? 'border-border text-muted-foreground'
                      : 'border-destructive/50 text-destructive'
                  }`}
                >
                  {pathOk ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    {pathOk ? (
                      <>
                        <p>
                          {t('vault.validateOk').replace(
                            '{count}',
                            String(validation.file_count_estimate)
                          )}
                        </p>
                        {validation.sample.length > 0 && (
                          <p className="font-mono truncate opacity-70">
                            {validation.sample.slice(0, 3).join(', ')}
                            {validation.file_count_estimate > 3 ? ' …' : ''}
                          </p>
                        )}
                        {validation.file_count_estimate >= LARGE_VAULT_THRESHOLD && (
                          <p className="mt-1 flex items-start gap-1 italic">
                            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                            {t('vault.validateLarge')}
                          </p>
                        )}
                      </>
                    ) : !validation.allowed ? (
                      <p>{t('vault.validateNotAllowed')}</p>
                    ) : !validation.exists ? (
                      <p>{t('vault.validateNotFound')}</p>
                    ) : !validation.is_dir ? (
                      <p>{t('vault.validateNotDir')}</p>
                    ) : (
                      <p>{t('vault.validateNotReadable')}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="vault-include">{t('vault.includeLabel')}</Label>
                <Textarea
                  id="vault-include"
                  value={includeText}
                  onChange={(e) => setIncludeText(e.target.value)}
                  rows={4}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vault-exclude">{t('vault.excludeLabel')}</Label>
                <Textarea
                  id="vault-exclude"
                  value={excludeText}
                  onChange={(e) => setExcludeText(e.target.value)}
                  rows={4}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="vault-embed"
                checked={embed}
                onCheckedChange={(c) => setEmbed(c === true)}
              />
              <Label htmlFor="vault-embed" className="cursor-pointer">
                {t('vault.embedLabel')}
              </Label>
            </div>
          </TabsContent>

          {/* Subscribe to an existing vault */}
          <TabsContent value="subscribe" className="flex-1 overflow-hidden flex flex-col pt-2">
            <ScrollArea className="h-[360px] border rounded-md">
              {connectionsLoading ? (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : !connections || connections.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                  <FolderGit2 className="h-10 w-10 mb-2 opacity-50" />
                  <p className="text-sm">{t('vault.noConnections')}</p>
                </div>
              ) : (
                <div className="space-y-2 p-3">
                  {connections.map((conn) => {
                    const isSelected = selectedConnectionId === conn.id
                    return (
                      <button
                        type="button"
                        key={conn.id}
                        onClick={() => setSelectedConnectionId(conn.id)}
                        className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                          isSelected
                            ? 'bg-accent border-accent-foreground/20'
                            : 'hover:bg-accent/50'
                        }`}
                      >
                        <Link2 className="h-4 w-4 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{conn.name}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {conn.root_path}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t('vault.subscribers').replace(
                              '{count}',
                              String(conn.subscriber_count)
                            )}{' '}
                            · {t('vault.fileCount').replace('{count}', String(conn.file_count))}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={resetAndClose}>
              {t('common.cancel')}
            </Button>
            <TabsContent value="link" className="m-0">
              <Button
                onClick={handleLink}
                disabled={!name.trim() || !rootPath.trim() || linkVault.isPending}
              >
                {linkVault.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('vault.linking')}
                  </>
                ) : (
                  t('vault.linkNew')
                )}
              </Button>
            </TabsContent>
            <TabsContent value="subscribe" className="m-0">
              <Button
                onClick={handleSubscribe}
                disabled={!selectedConnectionId || subscribeVault.isPending}
              >
                {subscribeVault.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('vault.subscribing')}
                  </>
                ) : (
                  t('vault.subscribe')
                )}
              </Button>
            </TabsContent>
          </DialogFooter>
        </Tabs>
      </DialogContent>
    </Dialog>

    <FolderBrowserDialog
      open={browserOpen}
      onOpenChange={setBrowserOpen}
      initialPath={rootPath.trim() || undefined}
      onSelect={(p) => {
        setRootPath(p)
        setValidation(null)
      }}
    />
    </>
  )
}
