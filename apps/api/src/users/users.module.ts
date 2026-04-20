import { Module } from '@nestjs/common';
import { SocialOptOutService } from './social-opt-out.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [SocialOptOutService],
  exports: [SocialOptOutService],
})
export class UsersModule {}
