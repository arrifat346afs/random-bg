/**
 * top-bar/FeedbackButtons — thumbs up/down on Randomise plus the Liked gallery.
 *
 * Rating the current project stores seed + generator mix + gate metrics and
 * retunes the randomiser's bandit multipliers immediately. The Liked menu
 * lists rated projects (re-roll any seed), and carries JSON export/import
 * plus the reset-learning escape hatch.
 */

import { useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Heart, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { randomProjectChecked } from '@/lib/quality'
import { formatSeed } from '@/lib/rng'
import { useFeedbackStore } from '@/store/feedbackStore'
import { useProjectStore } from '@/store/projectStore'
import type { FeedbackEntry } from '@/lib/feedback'

function entryLabel(e: FeedbackEntry): string {
  return `${formatSeed(e.seed)} · ${e.genIds.join('+') || 'empty'}`
}

export function FeedbackButtons() {
  const seed = useProjectStore((s) => s.project.seed)
  const verdict = useFeedbackStore((s) => s.entries.find((e) => e.seed === seed)?.verdict ?? null)
  const liked = useFeedbackStore(useShallow((s) => s.entries.filter((e) => e.verdict === 'like').slice(-30).reverse()))
  const likedCount = useFeedbackStore((s) => s.entries.reduce((n, e) => n + (e.verdict === 'like' ? 1 : 0), 0))
  const fileRef = useRef<HTMLInputElement>(null)

  const rate = (v: 'like' | 'dislike') => useFeedbackStore.getState().rateCurrent(v)

  const loadSeed = (entrySeed: number) => {
    void randomProjectChecked(entrySeed, { attempts: 8 }).then((checked) => {
      useProjectStore.getState().applyProject(checked.project)
    })
  }

  const download = () => {
    const text = useFeedbackStore.getState().exportJSON()
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'fxforge-feedback.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    void file.text().then((text) => {
      useFeedbackStore.getState().importJSON(text)
    })
  }

  return (
    <>
      <Button
        size="sm"
        variant={verdict === 'like' ? 'default' : 'ghost'}
        className="px-1.5"
        title="Love this result ( ] )"
        aria-label="Rate current project up"
        onClick={() => rate('like')}
      >
        <ThumbsUp />
      </Button>
      <Button
        size="sm"
        variant={verdict === 'dislike' ? 'default' : 'ghost'}
        className="px-1.5"
        title="Not this ( [ )"
        aria-label="Rate current project down"
        onClick={() => rate('dislike')}
      >
        <ThumbsDown />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="px-1.5" aria-label="Liked gallery" title="Liked gallery">
            <Heart />
            {likedCount > 0 && (
              <span className="text-[10px] tabular-nums text-muted-foreground">{likedCount}</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
          <DropdownMenuLabel>Liked ({likedCount})</DropdownMenuLabel>
          {liked.length === 0 && (
            <DropdownMenuItem disabled>No likes yet — hit 👍 on a roll.</DropdownMenuItem>
          )}
          {liked.map((e) => (
            <DropdownMenuItem key={e.seed} onSelect={() => loadSeed(e.seed)}>
              <span className="flex w-full items-center justify-between gap-2">
                <span className="truncate text-xs">{entryLabel(e)}</span>
                <span className="flex shrink-0">
                  {e.palette.slice(0, 4).map((c) => (
                    <span
                      key={c}
                      className="inline-block h-3 w-3 rounded-full border border-black/30"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={download}>Export feedback as JSON…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => fileRef.current?.click()}>Import feedback JSON…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useFeedbackStore.getState().resetLearning()}>
            Reset learning
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(ev) => {
          onFile(ev.target.files?.[0])
          ev.target.value = ''
        }}
      />
    </>
  )
}
