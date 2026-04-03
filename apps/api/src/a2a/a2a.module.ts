import { Module } from '@nestjs/common';
import { A2AController } from './a2a.controller';
import { A2AInvokeController } from './a2a-invoke.controller';
import { MarketsModule } from '../markets/markets.module';

@Module({
  imports: [MarketsModule],
  controllers: [A2AController, A2AInvokeController],
})
export class A2AModule {}
