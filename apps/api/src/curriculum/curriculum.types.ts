export interface Curriculum {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  week_count: number;
  status: 'draft' | 'active' | 'archived';
  template_source: string | null;
  created_by: string;
  created_at: string;
}

export interface CurriculumModule {
  id: string;
  curriculum_id: string;
  week_number: number;
  theme: string;
  instruments: Array<{ symbol: string; instrument_id?: string }>;
  challenge_id: string | null;
  poll_id: string | null;
  journal_prompt: string | null;
  tournament_id: string | null;
  created_at: string;
}

export interface CurriculumEnrollment {
  id: string;
  curriculum_id: string;
  user_id: string;
  current_week: number;
  completion_pct: number;
  enrolled_at: string;
}

export interface CurriculumModuleProgress {
  id: string;
  enrollment_id: string;
  module_id: string;
  challenge_completed: boolean;
  poll_completed: boolean;
  journal_completed: boolean;
  tournament_completed: boolean;
  score: number | null;
  completed_at: string | null;
}

export interface CreateCurriculumInput {
  club_id: string;
  name: string;
  description?: string;
  week_count: number;
}

export interface UpdateCurriculumInput {
  name?: string;
  description?: string;
  status?: 'draft' | 'active' | 'archived';
}

export interface UpdateModuleInput {
  theme?: string;
  instruments?: Array<{ symbol: string; instrument_id?: string }>;
  journal_prompt?: string;
  challenge_id?: string;
  poll_id?: string;
  tournament_id?: string;
}
