import { Module } from '@nestjs/common';
import { SovereignPolicyService } from './sovereign-policy.service';
import { SovereignPolicyController } from './sovereign-policy.controller';

@Module({
  providers: [SovereignPolicyService],
  controllers: [SovereignPolicyController],
  exports: [SovereignPolicyService], // Export for use in other modules
})
export class SovereignPolicyModule {}
