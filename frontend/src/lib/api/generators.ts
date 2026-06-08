import apiClient from './client'
import { NoteResponse } from '@/lib/types/api'

// The six Workshop generators. Values match the backend route segments
// (POST /notebooks/{id}/generate/{feature}).
export type GeneratorFeature =
  | 'data_table'
  | 'report'
  | 'flashcards'
  | 'quiz'
  | 'infographic'
  | 'mindmap'

export interface GenerateOptions {
  source_ids: string[]
  steering_prompt?: string
  language?: string
  model_id?: string
  // feature-specific (ignored by features that don't use them)
  template?: string
  length?: string
  difficulty?: string
  quantity?: string
  card_count?: number
  question_count?: number
  orientation?: string
  detail?: string
  style?: string
}

export const generatorsApi = {
  generate: async (
    notebookId: string,
    feature: GeneratorFeature,
    options: GenerateOptions
  ) => {
    const response = await apiClient.post<NoteResponse>(
      `/notebooks/${notebookId}/generate/${feature}`,
      options
    )
    return response.data
  },
}
