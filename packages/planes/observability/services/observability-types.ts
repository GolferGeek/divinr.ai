/**
 * Types for the legacy observability event system.
 * Merged from apps/observability/server/src/types.ts
 *
 * These types support the original hook-based event ingestion,
 * WebSocket broadcasting, HITL interaction, and theme management.
 */

// Human-in-the-loop request interface
export interface HumanInTheLoop {
  question: string;
  responseWebSocketUrl: string;
  type: 'question' | 'permission' | 'choice';
  choices?: string[]; // For multiple choice questions
  timeout?: number; // Optional timeout in seconds
  requiresResponse?: boolean; // Whether response is required or optional
}

// Response interface
export interface HumanInTheLoopResponse {
  response?: string;
  permission?: boolean;
  choice?: string; // Selected choice from options
  hookEvent: HookEvent;
  respondedAt: number;
  respondedBy?: string; // Optional user identifier
}

// Status tracking interface
export interface HumanInTheLoopStatus {
  status: 'pending' | 'responded' | 'timeout' | 'error';
  respondedAt?: number;
  response?: HumanInTheLoopResponse;
}

// Input interface for hook data (supports both snake_case and camelCase)
export interface HookDataInput {
  source_app?: string;
  sourceApp?: string;
  session_id?: string;
  sessionId?: string;
  event_type?: string;
  hook_event_type?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  chat?: unknown[];
  summary?: string;
  timestamp?: number;
  model_name?: string;
  modelName?: string;
  humanInTheLoop?: HumanInTheLoop;
}

export interface HookEvent {
  id?: number;
  source_app: string;
  session_id: string;
  hook_event_type: string;
  payload: Record<string, unknown>;
  chat?: unknown[];
  summary?: string;
  timestamp?: number;
  model_name?: string;

  // Enriched fields for observability
  userId?: string;
  username?: string; // display_name or email (human-readable)
  conversationId?: string;
  taskId?: string;
  agentSlug?: string;
  mode?: string;

  // Optional HITL data
  humanInTheLoop?: HumanInTheLoop;
  humanInTheLoopStatus?: HumanInTheLoopStatus;
}

export interface FilterOptions {
  source_apps: string[];
  session_ids: string[];
  hook_event_types: string[];
}

// Theme-related interfaces for server-side storage and API
export interface ThemeColors {
  primary: string;
  primaryHover: string;
  primaryLight: string;
  primaryDark: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgQuaternary: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textQuaternary: string;
  borderPrimary: string;
  borderSecondary: string;
  borderTertiary: string;
  accentSuccess: string;
  accentWarning: string;
  accentError: string;
  accentInfo: string;
  shadow: string;
  shadowLg: string;
  hoverBg: string;
  activeBg: string;
  focusRing: string;
}

export interface Theme {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  colors: ThemeColors;
  isPublic: boolean;
  authorId?: string;
  authorName?: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  downloadCount?: number;
  rating?: number;
  ratingCount?: number;
}

export interface ThemeSearchQuery {
  query?: string;
  tags?: string[];
  authorId?: string;
  isPublic?: boolean;
  sortBy?: 'name' | 'created' | 'updated' | 'downloads' | 'rating';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ThemeValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  validationErrors?: ThemeValidationError[];
}

export interface ThemeExportData {
  version: string;
  theme: Partial<Theme>;
  exportedAt: string;
  exportedBy: string;
}

export interface ThemeStats {
  totalThemes: number;
  publicThemes: number;
  privateThemes: number;
  totalDownloads: number;
  averageRating: number;
}

export interface ThemeImportData {
  version?: string;
  theme: Partial<Theme>;
  exportedAt?: string;
  exportedBy?: string;
}
