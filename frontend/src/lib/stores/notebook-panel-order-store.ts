import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PanelKey = 'sources' | 'workshop' | 'chat'

// Default left-to-right order of the notebook's three panels. Users can drag to
// reorder; the chosen order persists globally.
const DEFAULT_ORDER: PanelKey[] = ['sources', 'workshop', 'chat']

interface NotebookPanelOrderState {
  order: PanelKey[]
  setOrder: (order: PanelKey[]) => void
  /** Move `key` to the position currently held by `target`. */
  reorder: (key: PanelKey, target: PanelKey) => void
  reset: () => void
}

export const useNotebookPanelOrderStore = create<NotebookPanelOrderState>()(
  persist(
    (set) => ({
      order: DEFAULT_ORDER,
      setOrder: (order) => set({ order }),
      reorder: (key, target) =>
        set((state) => {
          if (key === target) return state
          const next = state.order.filter((k) => k !== key)
          const targetIndex = next.indexOf(target)
          if (targetIndex === -1) return state
          next.splice(targetIndex, 0, key)
          return { order: next }
        }),
      reset: () => set({ order: DEFAULT_ORDER }),
    }),
    {
      name: 'notebook-panel-order',
      // Guard against stale/partial persisted values from older builds.
      merge: (persisted, current) => {
        const p = persisted as Partial<NotebookPanelOrderState> | undefined
        const order = p?.order
        const valid =
          Array.isArray(order) &&
          order.length === 3 &&
          DEFAULT_ORDER.every((k) => order.includes(k))
        return { ...current, ...(p ?? {}), order: valid ? (order as PanelKey[]) : DEFAULT_ORDER }
      },
    }
  )
)
