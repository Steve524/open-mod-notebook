'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sparkles } from 'lucide-react'
import { GeneratorFeature, GenerateOptions } from '@/lib/api/generators'
import { useTranslation } from '@/lib/hooks/use-translation'

type OptKey = keyof GenerateOptions

interface Control {
  key: OptKey
  label: string
  options: { value: string; label: string }[]
}

const o = (value: string, label?: string) => ({ value, label: label ?? value })

// Each tile's structured controls map to {{VARIABLES}} the prompts already
// declare. Mind Map and Data Table are steering-driven (no structured knobs).
const FEATURE_CONTROLS: Record<GeneratorFeature, Control[]> = {
  mindmap: [],
  data_table: [],
  report: [
    {
      key: 'template',
      label: 'Template',
      options: ['Briefing Document', 'Study Guide', 'FAQ', 'Timeline', 'Custom'].map(
        (v) => o(v)
      ),
    },
    {
      key: 'length',
      label: 'Length',
      options: [o('short', 'Short'), o('standard', 'Standard'), o('long', 'Long')],
    },
  ],
  flashcards: [
    {
      key: 'difficulty',
      label: 'Difficulty',
      options: [o('easy', 'Easy'), o('medium', 'Medium'), o('hard', 'Hard')],
    },
    {
      key: 'quantity',
      label: 'Quantity',
      options: [o('fewer', 'Fewer'), o('standard', 'Standard'), o('more', 'More')],
    },
  ],
  quiz: [
    {
      key: 'difficulty',
      label: 'Difficulty',
      options: [o('easy', 'Easy'), o('medium', 'Medium'), o('hard', 'Hard')],
    },
    {
      key: 'quantity',
      label: 'Questions',
      options: [o('fewer', 'Fewer'), o('standard', 'Standard'), o('more', 'More')],
    },
  ],
  infographic: [
    {
      key: 'orientation',
      label: 'Orientation',
      options: [o('Landscape'), o('Portrait'), o('Square')],
    },
    {
      key: 'detail',
      label: 'Detail',
      options: [o('Concise'), o('Standard'), o('Detailed')],
    },
    {
      key: 'style',
      label: 'Style',
      options: [o('Professional'), o('Sketch'), o('Kawaii')],
    },
  ],
}

// Defaults mirror the backend defaults so "open → Generate unchanged" == one-click.
const DEFAULTS: Partial<GenerateOptions> = {
  steering_prompt: '',
  language: 'en-US',
  template: 'Briefing Document',
  length: 'standard',
  difficulty: 'medium',
  quantity: 'standard',
  orientation: 'Landscape',
  detail: 'Standard',
  style: 'Professional',
}

const LANGUAGES = [
  'en-US',
  'es-ES',
  'fr-FR',
  'de-DE',
  'pt-BR',
  'it-IT',
  'ja-JP',
  'zh-CN',
  'zh-TW',
  'ru-RU',
]

interface GenerationOptionsPanelProps {
  feature: GeneratorFeature | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerate: (opts: Partial<GenerateOptions>) => void
  initial?: Partial<GenerateOptions>
  title?: string
}

export function GenerationOptionsPanel({
  feature,
  open,
  onOpenChange,
  onGenerate,
  initial,
  title,
}: GenerationOptionsPanelProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Partial<GenerateOptions>>(DEFAULTS)

  // Reset (or pre-fill) every time the panel opens.
  useEffect(() => {
    if (open) setValues({ ...DEFAULTS, ...initial })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, feature])

  if (!feature) return null
  const controls = FEATURE_CONTROLS[feature]

  const set = (k: OptKey, v: string) => setValues((p) => ({ ...p, [k]: v }))

  const submit = () => {
    const out: Partial<GenerateOptions> = {
      steering_prompt: values.steering_prompt || '',
      language: values.language || 'en-US',
    }
    controls.forEach((c) => {
      // @ts-expect-error string union assignment is safe for these option keys
      out[c.key] = values[c.key]
    })
    onGenerate(out)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? t('workshop.customize')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {controls.map((c) => (
            <div key={c.key} className="flex flex-col gap-1.5">
              <Label className="text-xs">{c.label}</Label>
              <Select
                value={String(values[c.key] ?? '')}
                onValueChange={(v) => set(c.key, v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {c.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t('workshop.steering')}</Label>
            <Textarea
              value={values.steering_prompt ?? ''}
              onChange={(e) => set('steering_prompt', e.target.value)}
              placeholder={t('workshop.steeringPlaceholder')}
              rows={3}
            />
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t('workshop.steeringHelper')}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t('common.language')}</Label>
            <Select
              value={values.language ?? 'en-US'}
              onValueChange={(v) => set('language', v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit}>
            <Sparkles className="mr-1 h-4 w-4" />
            {t('workshop.generate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
