import { create } from 'zustand'

// Ephemeral bridge so artifact viewers (e.g. the Mind Map) can push a question
// into the notebook's Chat panel. ChatColumn consumes `pending` and sends it.
interface NotebookChatBridgeState {
  pending: { notebookId: string; message: string } | null
  ask: (notebookId: string, message: string) => void
  clear: () => void
}

export const useNotebookChatBridge = create<NotebookChatBridgeState>((set) => ({
  pending: null,
  ask: (notebookId, message) => set({ pending: { notebookId, message } }),
  clear: () => set({ pending: null }),
}))
