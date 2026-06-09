'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Network,
  FileText,
  Layers,
  CircleHelp,
  Image as ImageIcon,
  Table,
  Loader2,
  Pencil,
  type LucideIcon,
} from 'lucide-react'
import {
  generatorsApi,
  GeneratorFeature,
  GenerateOptions,
} from '@/lib/api/generators'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorKey } from '@/lib/utils/error-handler'
import { cn } from '@/lib/utils'
import { GenerationOptionsPanel } from './GenerationOptionsPanel'

interface WorkshopTilesProps {
  notebookId: string
  selectedSourceIds: string[]
}

interface Tile {
  feature: GeneratorFeature
  icon: LucideIcon
  titleKey: string
  descKey: string
  accent: string
}

// "Generate from sources" widgets — one per backend generator. Accent colors
// are inline CSS vars so they work in every theme; the glass/dark themes pick
// up the hover glow automatically.
const TILES: Tile[] = [
  { feature: 'mindmap', icon: Network, titleKey: 'workshop.mindmap', descKey: 'workshop.mindmapDesc', accent: 'oklch(0.72 0.16 285)' },
  { feature: 'report', icon: FileText, titleKey: 'workshop.report', descKey: 'workshop.reportDesc', accent: 'oklch(0.68 0.15 230)' },
  { feature: 'flashcards', icon: Layers, titleKey: 'workshop.flashcards', descKey: 'workshop.flashcardsDesc', accent: 'oklch(0.74 0.15 150)' },
  { feature: 'quiz', icon: CircleHelp, titleKey: 'workshop.quiz', descKey: 'workshop.quizDesc', accent: 'oklch(0.78 0.15 95)' },
  { feature: 'infographic', icon: ImageIcon, titleKey: 'workshop.infographic', descKey: 'workshop.infographicDesc', accent: 'oklch(0.72 0.16 25)' },
  { feature: 'data_table', icon: Table, titleKey: 'workshop.dataTable', descKey: 'workshop.dataTableDesc', accent: 'oklch(0.7 0.14 320)' },
]

export function WorkshopTiles({ notebookId, selectedSourceIds }: WorkshopTilesProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [generating, setGenerating] = useState<Set<string>>(new Set())
  const [customizeFeature, setCustomizeFeature] = useState<GeneratorFeature | null>(
    null
  )

  const hasSources = selectedSourceIds.length > 0

  const run = async (
    feature: GeneratorFeature,
    labelKey: string,
    extra?: Partial<GenerateOptions>
  ) => {
    if (!hasSources || generating.has(feature)) return
    setGenerating((prev) => new Set(prev).add(feature))
    try {
      // Submit an async job (generation is slow on local models) and poll until
      // the worker finishes — keeps the request short so nothing times out.
      const { job_id } = await generatorsApi.generate(notebookId, feature, {
        source_ids: selectedSourceIds,
        ...extra,
      })

      const maxPolls = 360 // 360 * 2.5s = 15 min ceiling
      let done = false
      for (let i = 0; i < maxPolls && !done; i++) {
        await new Promise((r) => setTimeout(r, 2500))
        const s = await generatorsApi.jobStatus(job_id)
        // The job record carries a (non-null) result object even while running,
        // so terminal state must be detected from STATUS, not result presence.
        const terminal = ['completed', 'failed', 'error', 'cancelled'].includes(
          s.status
        )
        if (!terminal) continue
        const ok = s.status === 'completed' && s.result?.success !== false
        if (!ok) {
          throw new Error(
            s.result?.error_message || s.error_message || t('workshop.generateFailed')
          )
        }
        done = true
      }
      if (!done) throw new Error(t('workshop.generateFailed'))

      // Save quietly: refresh the notes list so the new card appears on its own.
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notes(notebookId) })
      toast({ title: t('workshop.added'), description: t(labelKey) })
    } catch (error) {
      toast({
        title: t('common.error'),
        description: getApiErrorKey(error, t('workshop.generateFailed')),
        variant: 'destructive',
      })
    } finally {
      setGenerating((prev) => {
        const next = new Set(prev)
        next.delete(feature)
        return next
      })
    }
  }

  const customizeTitleKey =
    TILES.find((x) => x.feature === customizeFeature)?.titleKey ?? ''

  return (
    <div className="mb-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('workshop.generateFromSources')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {TILES.map(({ feature, icon: Icon, titleKey, descKey, accent }) => {
          const busy = generating.has(feature)
          const disabled = !hasSources || busy
          return (
            <div
              key={feature}
              title={!hasSources ? t('workshop.selectSourcesFirst') : undefined}
              style={{ ['--tile-accent']: accent } as React.CSSProperties}
              className={cn(
                'group relative rounded-[13px] border p-3 transition-all',
                'hover:-translate-y-0.5 hover:border-[var(--ring)]',
                'hover:shadow-[0_8px_24px_-12px_var(--tile-accent)]',
                disabled && 'pointer-events-none opacity-50'
              )}
            >
              <button
                type="button"
                onClick={() => run(feature, titleKey)}
                className="flex w-full flex-col gap-1 text-left"
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{
                    backgroundColor:
                      'color-mix(in oklch, var(--tile-accent) 20%, transparent)',
                    color: 'var(--tile-accent)',
                  }}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </span>
                <span className="text-[13px] font-medium leading-tight">
                  {t(titleKey)}
                </span>
                <span className="line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
                  {busy ? t('workshop.generating') : t(descKey)}
                </span>
              </button>

              {/* Customize: opens the options panel instead of the one-click default */}
              <button
                type="button"
                onClick={() => setCustomizeFeature(feature)}
                title={t('workshop.customize')}
                aria-label={t('workshop.customize')}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      <GenerationOptionsPanel
        feature={customizeFeature}
        open={Boolean(customizeFeature)}
        onOpenChange={(o) => {
          if (!o) setCustomizeFeature(null)
        }}
        onGenerate={(opts) => {
          if (customizeFeature) run(customizeFeature, customizeTitleKey, opts)
        }}
      />
    </div>
  )
}
