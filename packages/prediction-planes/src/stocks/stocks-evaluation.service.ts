import type {
  ActualOutcome,
  EvaluationHorizon,
  EvaluationScore,
  PredictionPlaneEvaluation,
} from '../prediction-plane.interface';

export class StocksEvaluationService implements PredictionPlaneEvaluation {
  async evaluateOutcome(
    _instrumentId: string,
    _predictionDate: Date,
    _evaluationDate: Date,
  ): Promise<ActualOutcome> {
    // TODO: Integrate with market data API to fetch actual close prices.
    // For now, returns a placeholder that must be filled by the nightly job
    // or manual evaluation endpoint.
    return {
      data: {},
      direction: 'flat',
      determinedAt: new Date().toISOString(),
    };
  }

  scorePrediction(
    predicted: { direction: string; confidence: number },
    actual: ActualOutcome,
  ): EvaluationScore {
    const wasCorrect = predicted.direction === actual.direction;
    const normalizedConfidence = Math.min(Math.max(predicted.confidence, 0), 100) / 100;

    // Calibration: how well did confidence predict accuracy?
    // Perfect calibration: 70% confident calls are right 70% of the time.
    // For a single prediction, calibration = 1 - |confidence - accuracy|
    const accuracy = wasCorrect ? 1 : 0;
    const calibration = 1 - Math.abs(normalizedConfidence - accuracy);

    return {
      wasCorrect,
      accuracy,
      calibration,
      details: {
        predictedDirection: predicted.direction,
        actualDirection: actual.direction,
        confidenceAtPrediction: predicted.confidence,
      },
    };
  }

  getDefaultHorizons(): EvaluationHorizon[] {
    return [
      { value: 1, unit: 'days', label: '1 Day' },
      { value: 3, unit: 'days', label: '3 Days' },
      { value: 5, unit: 'days', label: '5 Days' },
    ];
  }
}
