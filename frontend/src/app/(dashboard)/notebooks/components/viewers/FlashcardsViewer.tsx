'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Shuffle, Check, X, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Flashcard {
  front: string
  back: string
  hint?: string
}

export function FlashcardsViewer({ payload }: { payload: Record<string, unknown> }) {
  const cards = (payload?.cards as Flashcard[] | undefined) ?? []
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i))
  const [pos, setPos] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [known, setKnown] = useState<Set<number>>(new Set())
  const [missed, setMissed] = useState<Set<number>>(new Set())

  if (cards.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No flashcards were generated.
      </div>
    )
  }

  const idx = order[pos]
  const card = cards[idx]
  const go = (delta: number) => {
    setFlipped(false)
    setPos((p) => (p + delta + order.length) % order.length)
  }
  const shuffle = () => {
    setOrder((o) => [...o].sort(() => Math.random() - 0.5))
    setPos(0)
    setFlipped(false)
  }
  const tag = (which: 'known' | 'missed') => {
    const add = (s: Set<number>) => new Set(s).add(idx)
    const del = (s: Set<number>) => {
      const n = new Set(s)
      n.delete(idx)
      return n
    }
    if (which === 'known') {
      setKnown(add)
      setMissed(del)
    } else {
      setMissed(add)
      setKnown(del)
    }
    go(1)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Card {pos + 1} / {order.length}
        </span>
        <span>
          <span className="text-green-500">{known.size} known</span> ·{' '}
          <span className="text-amber-500">{missed.size} missed</span>
        </span>
      </div>

      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className={cn(
          'flex min-h-56 flex-col items-center justify-center rounded-xl border p-6 text-center transition-colors',
          flipped ? 'bg-muted/50' : 'bg-card'
        )}
      >
        <span className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          {flipped ? 'Answer' : 'Question'}
        </span>
        <span className="text-base font-medium leading-snug">
          {flipped ? card.back : card.front}
        </span>
        {!flipped && card.hint && (
          <span className="mt-3 text-xs text-muted-foreground">Hint: {card.hint}</span>
        )}
        <span className="mt-4 text-[10px] text-muted-foreground">
          Click to flip
        </span>
      </button>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => go(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => tag('missed')}>
            <X className="mr-1 h-4 w-4 text-amber-500" /> Missed
          </Button>
          <Button variant="outline" size="sm" onClick={() => tag('known')}>
            <Check className="mr-1 h-4 w-4 text-green-500" /> Known
          </Button>
          <Button variant="ghost" size="sm" onClick={shuffle}>
            <Shuffle className="mr-1 h-4 w-4" /> Shuffle
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setKnown(new Set())
              setMissed(new Set())
              setOrder(cards.map((_, i) => i))
              setPos(0)
              setFlipped(false)
            }}
          >
            <RotateCcw className="mr-1 h-4 w-4" /> Reset
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => go(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
