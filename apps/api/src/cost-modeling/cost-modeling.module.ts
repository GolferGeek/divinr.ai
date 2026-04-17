import { Module } from '@nestjs/common';
import { AdminCostController } from './admin-cost.controller';
import { BillingCostController } from './billing-cost.controller';
import { CostCalibrationService } from './cost-calibration.service';
import { CostPredictionService } from './cost-prediction.service';
import { PricingDefensibilityService } from './pricing-defensibility.service';
import { StudentBillingService } from './student-billing.service';
import { CostExperimentationService } from './cost-experimentation.service';
import { MarketsModule } from '../markets/markets.module';

@Module({
  imports: [MarketsModule],
  controllers: [AdminCostController, BillingCostController],
  providers: [
    CostCalibrationService,
    CostPredictionService,
    PricingDefensibilityService,
    StudentBillingService,
    CostExperimentationService,
  ],
  exports: [
    CostCalibrationService,
    CostPredictionService,
    PricingDefensibilityService,
    StudentBillingService,
    CostExperimentationService,
  ],
})
export class CostModelingModule {}
