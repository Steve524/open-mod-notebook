'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Copy, Check, Download } from 'lucide-react'
import { NoteResponse } from '@/lib/types/api'
import { cn } from '@/lib/utils'
import { useNote } from '@/lib/hooks/use-notes'
import { MindMapViewer } from './viewers/MindMapViewer'
import { FlashcardsViewer } from './viewers/FlashcardsViewer'
import { QuizViewer } from './viewers/QuizViewer'
import { DataTableViewer } from './viewers/DataTableViewer'
import { InfographicViewer } from './viewers/InfographicViewer'

const MD_CLASS =
  'text-sm leading-relaxed [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5'

function ReportViewer({ note }: { note: NoteResponse }) {
  const [copied, setCopied] = useState(false)
  const content = note.content ?? ''

  if (!content) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const copy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const download = () => {
    const blob = new Blob([content], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${note.title ?? 'report'}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
          Copy
        </Button>
        <Button variant="outline" size="sm" onClick={download}>
          <Download className="mr-1 h-4 w-4" /> .md
        </Button>
      </div>
      <div className={MD_CLASS}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  )
}

const SIZE: Record<string, string> = {
  mindmap: 'h-[88vh] max-w-[92vw] gap-0 p-0 sm:max-w-[92vw]',
  data_table: 'max-w-5xl max-h-[85vh] overflow-y-auto',
}
const DEFAULT_SIZE = 'max-w-3xl max-h-[85vh] overflow-y-auto'

interface ArtifactViewerDialogProps {
  note: NoteResponse | null
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
}

// Opens a saved generator artifact. The notes LIST omits `content` (and is
// otherwise lean), so we fetch the full note by id to guarantee complete
// content + payload before dispatching to the viewer.
export function ArtifactViewerDialog({
  note,
  open,
  onOpenChange,
  notebookId,
}: ArtifactViewerDialogProps) {
  const { data: full } = useNote(note?.id, { enabled: open && !!note?.id })
  const active = full ?? note
  const type = active?.artifact_type ?? ''
  const isMindMap = type === 'mindmap'
  const payload = active?.payload ?? {}

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('flex flex-col', SIZE[type] ?? DEFAULT_SIZE)}>
        <DialogHeader className={cn(isMindMap && 'px-4 pt-4 pb-2')}>
          <DialogTitle>{active?.title ?? 'Artifact'}</DialogTitle>
        </DialogHeader>

        {active && isMindMap && (
          <div className="min-h-0 flex-1">
            <MindMapViewer payload={payload} notebookId={notebookId} />
          </div>
        )}
        {active && type === 'flashcards' && <FlashcardsViewer payload={payload} />}
        {active && type === 'quiz' && <QuizViewer payload={payload} />}
        {active && type === 'data_table' && <DataTableViewer payload={payload} />}
        {active && type === 'infographic' && <InfographicViewer payload={payload} />}
        {active &&
          type !== 'mindmap' &&
          type !== 'flashcards' &&
          type !== 'quiz' &&
          type !== 'data_table' &&
          type !== 'infographic' && <ReportViewer note={active} />}
      </DialogContent>
    </Dialog>
  )
}
