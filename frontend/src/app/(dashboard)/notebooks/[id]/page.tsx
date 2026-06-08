'use client'

import { useState, useEffect, Fragment } from 'react'
import { useParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { NotebookHeader } from '../components/NotebookHeader'
import { SourcesColumn } from '../components/SourcesColumn'
import { NotesColumn } from '../components/NotesColumn'
import { ChatColumn } from '../components/ChatColumn'
import { useNotebook } from '@/lib/hooks/use-notebooks'
import { useNotebookSources } from '@/lib/hooks/use-sources'
import { useNotes } from '@/lib/hooks/use-notes'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useIsDesktop } from '@/lib/hooks/use-media-query'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileText, StickyNote, MessageSquare, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useNotebookPanelOrderStore,
  type PanelKey,
} from '@/lib/stores/notebook-panel-order-store'

export type ContextMode = 'off' | 'insights' | 'full'

export interface ContextSelections {
  sources: Record<string, ContextMode>
  notes: Record<string, ContextMode>
}

export default function NotebookPage() {
  const { t } = useTranslation()
  const params = useParams()

  // Ensure the notebook ID is properly decoded from URL
  const notebookId = params?.id ? decodeURIComponent(params.id as string) : ''

  const { data: notebook, isLoading: notebookLoading } = useNotebook(notebookId)
  const {
    sources,
    isLoading: sourcesLoading,
    refetch: refetchSources,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useNotebookSources(notebookId)
  const { data: notes, isLoading: notesLoading } = useNotes(notebookId)

  // Detect desktop to avoid double-mounting ChatColumn
  const isDesktop = useIsDesktop()

  // Mobile tab state (Sources, Notes, or Chat)
  const [mobileActiveTab, setMobileActiveTab] = useState<'sources' | 'notes' | 'chat'>('chat')

  // Context selection state
  const [contextSelections, setContextSelections] = useState<ContextSelections>({
    sources: {},
    notes: {}
  })

  // Initialize and update selections when sources load or change
  useEffect(() => {
    if (sources && sources.length > 0) {
      setContextSelections(prev => {
        const newSourceSelections = { ...prev.sources }
        sources.forEach(source => {
          const currentMode = newSourceSelections[source.id]
          const hasInsights = source.insights_count > 0

          if (currentMode === undefined) {
            // Initial setup - default based on insights availability
            newSourceSelections[source.id] = hasInsights ? 'insights' : 'full'
          } else if (currentMode === 'full' && hasInsights) {
            // Source gained insights while in 'full' mode - auto-switch to 'insights'
            newSourceSelections[source.id] = 'insights'
          }
        })
        return { ...prev, sources: newSourceSelections }
      })
    }
  }, [sources])

  useEffect(() => {
    if (notes && notes.length > 0) {
      setContextSelections(prev => {
        const newNoteSelections = { ...prev.notes }
        notes.forEach(note => {
          // Only set default if not already set
          if (!(note.id in newNoteSelections)) {
            // Notes default to 'full'
            newNoteSelections[note.id] = 'full'
          }
        })
        return { ...prev, notes: newNoteSelections }
      })
    }
  }, [notes])

  // Handler to update context selection
  const handleContextModeChange = (itemId: string, mode: ContextMode, type: 'source' | 'note') => {
    setContextSelections(prev => ({
      ...prev,
      [type === 'source' ? 'sources' : 'notes']: {
        ...(type === 'source' ? prev.sources : prev.notes),
        [itemId]: mode
      }
    }))
  }

  // Sources currently in context (mode != 'off') — what the Workshop generates from.
  const selectedSourceIds = Object.entries(contextSelections.sources)
    .filter(([, mode]) => mode !== 'off')
    .map(([id]) => id)

  // Panel order + drag-to-reorder (hooks must run before any early return).
  const { order, reorder } = useNotebookPanelOrderStore()
  const [dragKey, setDragKey] = useState<PanelKey | null>(null)

  if (notebookLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!notebook) {
    return (
      <AppShell>
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-4">{t('notebooks.notFound')}</h1>
          <p className="text-muted-foreground">{t('notebooks.notFoundDesc')}</p>
        </div>
      </AppShell>
    )
  }

  const panelConfig: Record<
    PanelKey,
    { defaultSize: number; minSize: number; label: string }
  > = {
    sources: { defaultSize: 26, minSize: 16, label: t('navigation.sources') },
    workshop: { defaultSize: 30, minSize: 18, label: t('workshop.title') },
    chat: { defaultSize: 44, minSize: 24, label: t('common.chat') },
  }

  const renderPanelBody = (key: PanelKey) => {
    switch (key) {
      case 'sources':
        return (
          <SourcesColumn
            sources={sources}
            isLoading={sourcesLoading}
            notebookId={notebookId}
            notebookName={notebook?.name}
            onRefresh={refetchSources}
            contextSelections={contextSelections.sources}
            onContextModeChange={(sourceId, mode) => handleContextModeChange(sourceId, mode, 'source')}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
          />
        )
      case 'workshop':
        return (
          <NotesColumn
            notes={notes}
            isLoading={notesLoading}
            notebookId={notebookId}
            contextSelections={contextSelections.notes}
            onContextModeChange={(noteId, mode) => handleContextModeChange(noteId, mode, 'note')}
            selectedSourceIds={selectedSourceIds}
          />
        )
      case 'chat':
        return (
          <ChatColumn
            notebookId={notebookId}
            contextSelections={contextSelections}
            sources={sources}
            sourcesLoading={sourcesLoading}
          />
        )
    }
  }

  return (
    <AppShell>
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-shrink-0 p-6 pb-0">
          <NotebookHeader notebook={notebook} />
        </div>

        <div className="flex-1 p-6 pt-6 overflow-x-auto flex flex-col">
          {/* Mobile: Tabbed interface - only render on mobile to avoid double-mounting */}
          {!isDesktop && (
            <>
              <div className="lg:hidden mb-4">
                <Tabs value={mobileActiveTab} onValueChange={(value) => setMobileActiveTab(value as 'sources' | 'notes' | 'chat')}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="sources" className="gap-2">
                      <FileText className="h-4 w-4" />
                      {t('navigation.sources')}
                    </TabsTrigger>
                    <TabsTrigger value="notes" className="gap-2">
                      <StickyNote className="h-4 w-4" />
                      {t('common.notes')}
                    </TabsTrigger>
                    <TabsTrigger value="chat" className="gap-2">
                      <MessageSquare className="h-4 w-4" />
                      {t('common.chat')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Mobile: Show only active tab */}
              <div className="flex-1 overflow-hidden lg:hidden">
                {mobileActiveTab === 'sources' && (
                  <SourcesColumn
                    sources={sources}
                    isLoading={sourcesLoading}
                    notebookId={notebookId}
                    notebookName={notebook?.name}
                    onRefresh={refetchSources}
                    contextSelections={contextSelections.sources}
                    onContextModeChange={(sourceId, mode) => handleContextModeChange(sourceId, mode, 'source')}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    fetchNextPage={fetchNextPage}
                  />
                )}
                {mobileActiveTab === 'notes' && (
                  <NotesColumn
                    notes={notes}
                    isLoading={notesLoading}
                    notebookId={notebookId}
                    contextSelections={contextSelections.notes}
                    onContextModeChange={(noteId, mode) => handleContextModeChange(noteId, mode, 'note')}
                    selectedSourceIds={selectedSourceIds}
                  />
                )}
                {mobileActiveTab === 'chat' && (
                  <ChatColumn
                    notebookId={notebookId}
                    contextSelections={contextSelections}
                    sources={sources}
                    sourcesLoading={sourcesLoading}
                  />
                )}
              </div>
            </>
          )}

          {/* Desktop: resizable, drag-reorderable panels. Default order
              Sources | Workshop | Chat; grab a panel's header grip to drop it
              into any order (persisted). autoSaveId is keyed to the current
              arrangement so sizes persist per order. */}
          <div className="hidden lg:block flex-1 min-h-0">
            <ResizablePanelGroup
              direction="horizontal"
              autoSaveId={`notebook-panels-${order.join('-')}`}
              className="h-full"
            >
              {order.map((key, index) => (
                <Fragment key={key}>
                  {index > 0 && <ResizableHandle withHandle />}
                  <ResizablePanel
                    id={key}
                    order={index}
                    defaultSize={panelConfig[key].defaultSize}
                    minSize={panelConfig[key].minSize}
                    className="min-w-0"
                  >
                    <div
                      className={cn(
                        'flex h-full flex-col rounded-lg transition-shadow',
                        dragKey && dragKey !== key && 'ring-1 ring-primary/40'
                      )}
                      onDragOver={(e) => {
                        if (dragKey && dragKey !== key) e.preventDefault()
                      }}
                      onDrop={() => {
                        if (dragKey) reorder(dragKey, key)
                        setDragKey(null)
                      }}
                    >
                      <div
                        draggable
                        onDragStart={() => setDragKey(key)}
                        onDragEnd={() => setDragKey(null)}
                        title={t('workshop.dragToReorder')}
                        className="flex cursor-grab select-none items-center justify-center gap-1.5 py-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                        <span className="text-[11px] font-medium uppercase tracking-wide">
                          {panelConfig[key].label}
                        </span>
                      </div>
                      <div className="min-h-0 flex-1 px-1 pb-1">
                        {renderPanelBody(key)}
                      </div>
                    </div>
                  </ResizablePanel>
                </Fragment>
              ))}
            </ResizablePanelGroup>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
