'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowUpDown, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Citation {
  row: number
  column: string
  quote: string
  source: string
}

type Row = Record<string, unknown> & { __i: number }

export function DataTableViewer({ payload }: { payload: Record<string, unknown> }) {
  const columns = (payload?.columns as string[] | undefined) ?? []
  const rawRows = (payload?.rows as Record<string, unknown>[] | undefined) ?? []
  const citations = (payload?.citations as Citation[] | undefined) ?? []
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const citationFor = (rowIndex: number, column: string) =>
    citations.find((c) => c.row === rowIndex && c.column === column)

  const rows: Row[] = useMemo(() => {
    const indexed: Row[] = rawRows.map((r, i) => ({ ...r, __i: i }))
    if (!sortCol) return indexed
    return [...indexed].sort((a, b) => {
      const av = String(a[sortCol] ?? '')
      const bv = String(b[sortCol] ?? '')
      const cmp = av.localeCompare(bv, undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rawRows, sortCol, sortDir])

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [columns.map(esc).join(',')]
    rawRows.forEach((r) => lines.push(columns.map((c) => esc(r[c])).join(',')))
    if (citations.length) {
      lines.push('', 'Source References')
      lines.push(['Row', 'Column', 'Quote', 'Source'].map(esc).join(','))
      citations.forEach((c) =>
        lines.push([c.row, c.column, c.quote, c.source].map(esc).join(','))
      )
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'data-table.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (columns.length === 0 || rawRows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Data not found in the selected sources.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-1 h-4 w-4" /> Export CSV
        </Button>
      </div>
      <div className="overflow-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50">
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  className="cursor-pointer select-none border-b px-3 py-2 text-left font-medium hover:bg-muted"
                >
                  <span className="inline-flex items-center gap-1">
                    {col}
                    <ArrowUpDown
                      className={cn(
                        'h-3 w-3',
                        sortCol === col ? 'text-foreground' : 'text-muted-foreground/40'
                      )}
                    />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.__i} className="border-b last:border-0 hover:bg-muted/30">
                {columns.map((col) => {
                  const cite = citationFor(row.__i, col)
                  return (
                    <td
                      key={col}
                      title={cite ? `"${cite.quote}" — ${cite.source}` : undefined}
                      className={cn(
                        'border-l px-3 py-2 first:border-l-0',
                        cite && 'underline decoration-dotted decoration-muted-foreground/50'
                      )}
                    >
                      {String(row[col] ?? 'N/A')}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {citations.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Hover a cited cell to see the supporting source quote.
        </p>
      )}
    </div>
  )
}
