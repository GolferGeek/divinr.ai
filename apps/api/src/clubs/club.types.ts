export interface Club {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  is_public: boolean;
  created_by: string;
  channel_id: string | null;
  created_at: string;
}

export interface ClubMember {
  id: string;
  club_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
  display_name?: string;
}

export interface ClubInvite {
  id: string;
  club_id: string;
  invite_token: string;
  invited_by: string;
  invited_email: string | null;
  invited_user_id: string | null;
  status: 'pending' | 'accepted' | 'expired';
  created_at: string;
}

export interface ClubAnalyst {
  id: string;
  club_id: string;
  analyst_id: string;
  created_by: string;
  created_at: string;
}

export interface ClubPredictionChallenge {
  id: string;
  club_id: string;
  created_by: string;
  instrument_id: string;
  symbol: string;
  prompt: string | null;
  status: 'open' | 'revealed' | 'closed';
  created_at: string;
  revealed_at: string | null;
}

export interface ClubChallengeResponse {
  id: string;
  challenge_id: string;
  user_id: string;
  direction: 'bull' | 'bear' | 'neutral';
  thesis: string;
  submitted_at: string;
}

export interface ClubConsensusPoll {
  id: string;
  club_id: string;
  created_by: string;
  instrument_id: string;
  symbol: string;
  status: 'open' | 'revealed' | 'closed';
  created_at: string;
  revealed_at: string | null;
}

export interface ClubConsensusVote {
  id: string;
  poll_id: string;
  user_id: string;
  direction: 'bull' | 'bear' | 'neutral';
  voted_at: string;
}

export interface ClubStrategyJournal {
  id: string;
  club_id: string;
  user_id: string;
  tournament_id: string | null;
  symbol: string | null;
  entry: string;
  created_at: string;
}

export interface CreateClubInput {
  name: string;
  description?: string;
  is_public?: boolean;
}

export interface UpdateClubInput {
  name?: string;
  description?: string;
  is_public?: boolean;
}
