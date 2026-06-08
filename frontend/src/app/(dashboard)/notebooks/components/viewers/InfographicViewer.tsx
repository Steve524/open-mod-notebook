'use client'

import { useRef } from 'react'
import { toPng } from 'html-to-image'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Section {
  heading: string
  body?: string
  icon_hint?: string
  callout?: string
}
interface Stat {
  value: string
  label?: string
  source?: string
}

const ORIENTATION_WIDTH: Record<string, string> = {
  portrait: 'max-w-md',
  square: 'max-w-xl',
  landscape: 'max-w-3xl',
}

export function InfographicViewer({ payload }: { payload: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null)
  const error = payload?.error as string | undefined
  const title = (payload?.title as string) ?? 'Infographic'
  const subtitle = payload?.subtitle as string | undefined
  const orientation = ((payload?.orientation as string) ?? 'landscape').toLowerCase()
  const sections = (payload?.sections as Section[] | undefined) ?? []
  const stats = (payload?.key_stats as Stat[] | undefined) ?? []
  const footer = payload?.footer as string | undefined

  if (error) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        {error}
      </div>
    )
  }

  const download = async () => {
    if (!ref.current) return
    const dataUrl = await toPng(ref.current, { pixelRatio: 2, backgroundColor: 'transparent' })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = 'infographic.png'
    a.click()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={download}>
          <Download className="mr-1 h-4 w-4" /> PNG
        </Button>
      </div>

      <div
        ref={ref}
        className={cn(
          'mx-auto w-full rounded-2xl border p-6',
          ORIENTATION_WIDTH[orientation] ?? 'max-w-3xl'
        )}
        style={{
          background:
            'linear-gradient(160deg, var(--card), color-mix(in oklch, var(--primary) 8%, var(--card)))',
        }}
      >
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}

        {stats.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {stats.map((s, i) => (
              <div
                key={i}
                className="rounded-xl border bg-background/50 p-3 text-center"
              >
                <div className="text-2xl font-bold text-primary">{s.value}</div>
                {s.label && (
                  <div className="mt-1 text-[11px] leading-tight text-muted-foreground">
                    {s.label}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {sections.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {sections.map((sec, i) => (
              <div key={i} className="rounded-xl border bg-background/40 p-3">
                <div className="text-sm font-semibold">{sec.heading}</div>
                {sec.body && (
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    {sec.body}
                  </p>
                )}
                {sec.callout && sec.callout !== 'N/A' && (
                  <p className="mt-2 text-xs font-medium text-primary">{sec.callout}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {footer && (
          <p className="mt-4 border-t pt-2 text-[10px] text-muted-foreground">{footer}</p>
        )}
      </div>
    </div>
  )
}
