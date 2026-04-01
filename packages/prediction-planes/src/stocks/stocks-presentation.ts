import type {
  CardFieldDefinition,
  DashboardLayout,
  PredictionDisplayConfig,
  PredictionPlanePresentation,
  VisualizationType,
} from '../prediction-plane.interface';

export class StocksPresentation implements PredictionPlanePresentation {
  getDashboardLayout(): DashboardLayout {
    return {
      title: 'Financial Markets',
      sections: [
        { id: 'instruments', title: 'Instruments', type: 'cards', config: {} },
        { id: 'predictions', title: 'Recent Predictions', type: 'table', config: { columns: ['instrument', 'direction', 'confidence', 'analyst', 'time'] } },
        { id: 'risk', title: 'Risk Overview', type: 'gauge', config: { metric: 'composite_score' } },
        { id: 'performance', title: 'Analyst Performance', type: 'chart', config: { type: 'bar', metric: 'accuracy_rate' } },
      ],
    };
  }

  getInstrumentCardFields(): CardFieldDefinition[] {
    return [
      { key: 'symbol', label: 'Symbol', type: 'text' },
      { key: 'price', label: 'Price', type: 'number', format: '$0.00' },
      { key: 'change_pct', label: 'Change', type: 'percentage' },
      { key: 'prediction_direction', label: 'Direction', type: 'badge' },
      { key: 'confidence', label: 'Confidence', type: 'percentage' },
    ];
  }

  getPredictionDisplayFormat(): PredictionDisplayConfig {
    return {
      directionFormat: 'arrow',
      confidenceFormat: 'bar',
      horizonFormat: 'relative',
    };
  }

  getVisualizationTypes(): VisualizationType[] {
    return [
      { id: 'candlestick', label: 'Candlestick Chart', component: 'StockCandlestickChart' },
      { id: 'prediction-timeline', label: 'Prediction Timeline', component: 'PredictionTimeline' },
      { id: 'risk-radar', label: 'Risk Radar', component: 'RiskRadarChart' },
      { id: 'analyst-comparison', label: 'Analyst Comparison', component: 'AnalystComparisonChart' },
    ];
  }
}
