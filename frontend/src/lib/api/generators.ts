import apiClient from './client'

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

export interface GenerateJobResponse {
  job_id: string
  status: string
}

export interface JobStatus {
  job_id: string
  status: string
  result?: {
    success?: boolean
    note_id?: string
    artifact_type?: string
    error_message?: string
  } | null
  error_message?: string | null
}

export const generatorsApi = {
  // Submits an async generation job; returns immediately with a job_id.
  generate: async (
    notebookId: string,
    feature: GeneratorFeature,
    options: GenerateOptions
  ) => {
    const response = await apiClient.post<GenerateJobResponse>(
      `/notebooks/${notebookId}/generate/${feature}`,
      options
    )
    return response.data
  },

  jobStatus: async (jobId: string) => {
    const response = await apiClient.get<JobStatus>(`/commands/jobs/${jobId}`)
    return response.data
  },
}
