import { Module } from '@nestjs/common';
import { TournamentController } from './tournament.controller';
import { TournamentService } from './tournament.service';
import { TournamentSchemaService } from './tournament-schema.service';
import { TournamentPortfolioService } from './tournament-portfolio.service';
import { TournamentLeaderboardService } from './tournament-leaderboard.service';
import { TournamentLifecycleService } from './tournament-lifecycle.service';
import { TournamentInviteService } from './tournament-invite.service';
import { MessagingService } from '../messaging/messaging.service';
import { MessagingSchemaService } from '../messaging/messaging-schema.service';
import { NotificationService } from '../markets/services/notification.service';
import { MarketsSchemaService } from '../markets/schema/markets-schema.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [TournamentController],
  providers: [
    TournamentSchemaService,
    TournamentService,
    TournamentPortfolioService,
    TournamentLeaderboardService,
    TournamentLifecycleService,
    TournamentInviteService,
    MessagingSchemaService,
    MessagingService,
    MarketsSchemaService,
    NotificationService,
  ],
  exports: [TournamentService, TournamentSchemaService, TournamentPortfolioService, TournamentLeaderboardService],
})
export class TournamentModule {}
