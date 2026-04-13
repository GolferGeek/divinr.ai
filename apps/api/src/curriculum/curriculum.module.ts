import { Module } from '@nestjs/common';
import { CurriculumController } from './curriculum.controller';
import { CurriculumService } from './curriculum.service';
import { CurriculumSchemaService } from './curriculum-schema.service';
import { ClubService } from '../clubs/club.service';
import { ClubSchemaService } from '../clubs/club-schema.service';
import { MessagingService } from '../messaging/messaging.service';
import { MessagingSchemaService } from '../messaging/messaging-schema.service';
import { NotificationService } from '../markets/services/notification.service';
import { MarketsSchemaService } from '../markets/schema/markets-schema.service';

@Module({
  controllers: [CurriculumController],
  providers: [
    CurriculumSchemaService,
    CurriculumService,
    ClubSchemaService,
    ClubService,
    MessagingSchemaService,
    MessagingService,
    MarketsSchemaService,
    NotificationService,
  ],
  exports: [CurriculumService, CurriculumSchemaService],
})
export class CurriculumModule {}
