'use client'

import '@xyflow/react/dist/style.css'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import dagre from 'dagre'
import { toPng } from 'html-to-image'
import {
  Plus,
  Minus,
  Maximize2,
  Download,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNotebookChatBridge } from '@/lib/stores/notebook-chat-bridge'

interface MindMapTree {
  id: string
  label: string
  children?: MindMapTree[]
}

interface MindNodeData extends Record<string, unknown> {
  label: string
  isRoot: boolean
  hasChildren: boolean
  collapsed: boolean
  onToggle: () => void
  onAsk: () => void
}

const NODE_W = 190
const NODE_H = 46

function MindNode({ data }: NodeProps) {
  const d = data as MindNodeData
  return (
    <div
      className={cn(
        'relative flex items-center rounded-full border px-3 py-2 text-xs shadow-sm backdrop-blur-sm transition-colors',
        d.isRoot
          ? 'border-primary/60 bg-primary/20 font-semibold text-foreground'
          : 'border-border bg-card/80 text-foreground'
      )}
      style={{ width: NODE_W, height: NODE_H }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <button
        type="button"
        onClick={d.onAsk}
        title="Ask about this in chat"
        className="line-clamp-2 flex-1 cursor-pointer text-left leading-tight hover:underline"
      >
        {d.label}
      </button>
      {d.hasChildren && (
        <button
          type="button"
          onClick={d.onToggle}
          title={d.collapsed ? 'Expand branch' : 'Collapse branch'}
          className="ml-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-border bg-background/80 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {d.collapsed ? '›' : '‹'}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  )
}

const nodeTypes = { mind: MindNode }

function collectIdsWithChildren(node: MindMapTree, acc: Set<string>, isRoot = true) {
  if (node.children && node.children.length > 0) {
    if (!isRoot) acc.add(node.id)
    node.children.forEach((c) => collectIdsWithChildren(c, acc, false))
  }
  return acc
}

function layoutTree(
  root: MindMapTree,
  collapsed: Set<string>,
  onToggle: (id: string) => void,
  onAsk: (label: string) => void
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 70 })
  g.setDefaultEdgeLabel(() => ({}))

  const nodes: Node[] = []
  const edges: Edge[] = []

  const walk = (node: MindMapTree, parentId: string | null, isRoot: boolean) => {
    const hasChildren = !!node.children && node.children.length > 0
    g.setNode(node.id, { width: NODE_W, height: NODE_H })
    nodes.push({
      id: node.id,
      type: 'mind',
      position: { x: 0, y: 0 },
      data: {
        label: node.label,
        isRoot,
        hasChildren,
        collapsed: collapsed.has(node.id),
        onToggle: () => onToggle(node.id),
        onAsk: () => onAsk(node.label),
      } satisfies MindNodeData,
    })
    if (parentId) {
      g.setEdge(parentId, node.id)
      edges.push({
        id: `${parentId}->${node.id}`,
        source: parentId,
        target: node.id,
        type: 'default',
        animated: false,
      })
    }
    if (hasChildren && !collapsed.has(node.id)) {
      node.children!.forEach((c) => walk(c, node.id, false))
    }
  }

  walk(root, null, true)
  dagre.layout(g)
  nodes.forEach((n) => {
    const p = g.node(n.id)
    n.position = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }
  })
  return { nodes, edges }
}

function ControlButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:text-foreground"
    >
      {children}
    </button>
  )
}

function Flow({ root, notebookId }: { root: MindMapTree; notebookId: string }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { fitView, zoomIn, zoomOut } = useReactFlow()
  const ask = useNotebookChatBridge((s) => s.ask)

  const onToggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const onAsk = useCallback(
    (label: string) => {
      ask(notebookId, `Tell me more about "${label}" based on my sources.`)
    },
    [ask, notebookId]
  )

  const { nodes, edges } = useMemo(
    () => layoutTree(root, collapsed, onToggle, onAsk),
    [root, collapsed, onToggle, onAsk]
  )

  const expandAll = useCallback(() => setCollapsed(new Set()), [])
  const collapseAll = useCallback(
    () => setCollapsed(collectIdsWithChildren(root, new Set())),
    [root]
  )

  const onDownload = useCallback(async () => {
    if (!wrapperRef.current) return
    const dataUrl = await toPng(wrapperRef.current, {
      backgroundColor: 'transparent',
      pixelRatio: 2,
    })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = 'mindmap.png'
    a.click()
  }, [])

  return (
    <div ref={wrapperRef} className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onInit={(instance) => {
          // The dialog can mount React Flow before it is measured; refit once.
          window.setTimeout(() => instance.fitView({ padding: 0.2 }), 60)
        }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="opacity-40" />
      </ReactFlow>

      <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1.5">
        <ControlButton onClick={expandAll} title="Expand all">
          <ChevronsUpDown className="h-4 w-4" />
        </ControlButton>
        <ControlButton onClick={collapseAll} title="Collapse all">
          <ChevronsDownUp className="h-4 w-4" />
        </ControlButton>
        <ControlButton onClick={() => zoomIn()} title="Zoom in">
          <Plus className="h-4 w-4" />
        </ControlButton>
        <ControlButton onClick={() => zoomOut()} title="Zoom out">
          <Minus className="h-4 w-4" />
        </ControlButton>
        <ControlButton onClick={() => fitView({ duration: 200 })} title="Fit view">
          <Maximize2 className="h-4 w-4" />
        </ControlButton>
        <ControlButton onClick={onDownload} title="Download PNG">
          <Download className="h-4 w-4" />
        </ControlButton>
      </div>
    </div>
  )
}

export function MindMapViewer({
  payload,
  notebookId,
}: {
  payload: Record<string, unknown>
  notebookId: string
}) {
  const root = payload as unknown as MindMapTree
  if (!root || !root.label) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This mind map has no data to display.
      </div>
    )
  }
  return (
    <ReactFlowProvider>
      <Flow root={root} notebookId={notebookId} />
    </ReactFlowProvider>
  )
}
