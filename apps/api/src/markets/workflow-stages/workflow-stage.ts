/**
 * Five-stage workflow taxonomy for the markets prediction pipeline.
 *
 * Foundation of the architecture restructure block. Downstream efforts
 * (stage-keyed-analyst-contracts, instrument-contracts, etc.) key off
 * these values, so they are a stable vocabulary — do not rename casually.
 */
export enum WorkflowStage {
  ArticleProcessing = 'article_processing',
  PredictorGeneration = 'predictor_generation',
  RiskAssessment = 'risk_assessment',
  PredictionGeneration = 'prediction_generation',
  Learning = 'learning',
}

export const WORKFLOW_STAGE_ORDER: readonly WorkflowStage[] = [
  WorkflowStage.ArticleProcessing,
  WorkflowStage.PredictorGeneration,
  WorkflowStage.RiskAssessment,
  WorkflowStage.PredictionGeneration,
  WorkflowStage.Learning,
];

export const WORKFLOW_STAGE_LABELS: Record<WorkflowStage, string> = {
  [WorkflowStage.ArticleProcessing]: 'Article Processing',
  [WorkflowStage.PredictorGeneration]: 'Predictor Generation',
  [WorkflowStage.RiskAssessment]: 'Risk Assessment',
  [WorkflowStage.PredictionGeneration]: 'Prediction Generation',
  [WorkflowStage.Learning]: 'Learning',
};
