'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Lightbulb, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuizQuestion {
  question: string
  type: 'mcq' | 'short'
  choices: string[]
  answerIndex: number
  explanation?: string
  hint?: string
}

export function QuizViewer({ payload }: { payload: Record<string, unknown> }) {
  const questions = (payload?.questions as QuizQuestion[] | undefined) ?? []
  const [pos, setPos] = useState(0)
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [showHint, setShowHint] = useState(false)
  const [revealShort, setRevealShort] = useState<Record<number, boolean>>({})

  if (questions.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No quiz questions were generated.
      </div>
    )
  }

  const q = questions[pos]
  const chosen = picked[pos]
  const answered = chosen !== undefined
  const score = questions.reduce(
    (acc, qq, i) => (picked[i] === qq.answerIndex ? acc + 1 : acc),
    0
  )
  const go = (delta: number) => {
    setShowHint(false)
    setPos((p) => Math.min(Math.max(p + delta, 0), questions.length - 1))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Question {pos + 1} / {questions.length}
        </span>
        <span>Score: {score} / {questions.length}</span>
      </div>

      <div className="text-base font-medium leading-snug">{q.question}</div>

      {q.type === 'mcq' ? (
        <div className="flex flex-col gap-2">
          {q.choices.map((choice, i) => {
            const isCorrect = i === q.answerIndex
            const isChosen = chosen === i
            return (
              <button
                key={i}
                type="button"
                disabled={answered}
                onClick={() => setPicked((p) => ({ ...p, [pos]: i }))}
                className={cn(
                  'flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default',
                  !answered && 'hover:border-primary/60',
                  answered && isCorrect && 'border-green-500/60 bg-green-500/10',
                  answered && isChosen && !isCorrect && 'border-red-500/60 bg-red-500/10'
                )}
              >
                <span>{choice}</span>
                {answered && isCorrect && <Check className="h-4 w-4 text-green-500" />}
                {answered && isChosen && !isCorrect && (
                  <X className="h-4 w-4 text-red-500" />
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {!revealShort[pos] ? (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setRevealShort((r) => ({ ...r, [pos]: true }))}
            >
              Reveal answer
            </Button>
          ) : (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              {q.explanation}
            </div>
          )}
        </div>
      )}

      {q.hint && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHint((s) => !s)}
          >
            <Lightbulb className="mr-1 h-4 w-4" /> {showHint ? 'Hide hint' : 'Hint'}
          </Button>
          {showHint && (
            <p className="mt-1 text-xs text-muted-foreground">{q.hint}</p>
          )}
        </div>
      )}

      {answered && q.type === 'mcq' && q.explanation && (
        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          {q.explanation}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => go(-1)} disabled={pos === 0}>
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(1)}
          disabled={pos === questions.length - 1}
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
