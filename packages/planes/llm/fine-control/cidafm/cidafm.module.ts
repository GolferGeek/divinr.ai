import { Module } from '@nestjs/common';
import { CIDAFMController } from './cidafm.controller';
import { CIDAFMService } from './cidafm.service';
import { AuthModule } from '@/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CIDAFMController],
  providers: [CIDAFMService],
  exports: [CIDAFMService],
})
export class CIDAFMModule {}
