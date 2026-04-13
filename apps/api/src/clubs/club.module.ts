import { Module } from '@nestjs/common';
import { ClubController } from './club.controller';
import { ClubService } from './club.service';
import { ClubSchemaService } from './club-schema.service';
import { ClubAnalystService } from './club-analyst.service';
import { ClubActivityService } from './club-activity.service';
import { ClubAnalyticsService } from './club-analytics.service';
import { ClubRankingService } from './club-ranking.service';
import { MessagingService } from '../messaging/messaging.service';
import { MessagingSchemaService } from '../messaging/messaging-schema.service';
import { NotificationService } from '../markets/services/notification.service';
import { MarketsSchemaService } from '../markets/schema/markets-schema.service';

@Module({
  controllers: [ClubController],
  providers: [
    ClubSchemaService,
    ClubService,
    ClubAnalystService,
    ClubActivityService,
    ClubAnalyticsService,
    ClubRankingService,
    MessagingSchemaService,
    MessagingService,
    MarketsSchemaService,
    NotificationService,
  ],
  exports: [ClubService, ClubSchemaService],
})
export class ClubModule {}
