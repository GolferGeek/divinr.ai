import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import {
  REQUEST_SCHEMA_BOOTSTRAP_LOCK,
  RuntimeSchemaBootstrapCoordinator,
} from '../bootstrap/runtime-schema-bootstrap-coordinator';

/**
 * Manages all DDL for the messaging schema.
 * All tables use CREATE TABLE IF NOT EXISTS so the schema is idempotent.
 */
@Injectable()
export class MessagingSchemaService {
  private static schemaReady = false;
  private static schemaReadyPromise: Promise<void> | null = null;
  private readonly logger = new Logger(MessagingSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (MessagingSchemaService.schemaReady) return;
    await RuntimeSchemaBootstrapCoordinator.runExclusive(REQUEST_SCHEMA_BOOTSTRAP_LOCK, async () => {
      if (MessagingSchemaService.schemaReady) return;
      if (MessagingSchemaService.schemaReadyPromise) {
        await MessagingSchemaService.schemaReadyPromise;
        return;
      }

      MessagingSchemaService.schemaReadyPromise = (async () => {
        const ddl = `
      CREATE SCHEMA IF NOT EXISTS messaging;

      -- Channels
      CREATE TABLE IF NOT EXISTS messaging.channels (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        scope TEXT NOT NULL CHECK (scope IN ('dm', 'club', 'tournament', 'system')),
        scope_id TEXT,
        name TEXT,
        is_archived BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      -- Channel members (with read tracking)
      CREATE TABLE IF NOT EXISTS messaging.channel_members (
        channel_id TEXT NOT NULL REFERENCES messaging.channels(id),
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
        last_read_at TIMESTAMPTZ DEFAULT now(),
        is_blocked BOOLEAN DEFAULT false,
        PRIMARY KEY (channel_id, user_id)
      );

      -- Messages
      CREATE TABLE IF NOT EXISTS messaging.messages (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        channel_id TEXT NOT NULL REFERENCES messaging.channels(id),
        sender_id TEXT NOT NULL,
        body TEXT NOT NULL,
        parent_message_id TEXT REFERENCES messaging.messages(id),
        attached_entity_type TEXT CHECK (
          attached_entity_type IS NULL OR
          attached_entity_type IN ('prediction', 'instrument', 'tournament', 'analyst', 'position')
        ),
        attached_entity_id TEXT,
        is_pinned BOOLEAN DEFAULT false,
        is_deleted BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      -- Emoji reactions
      CREATE TABLE IF NOT EXISTS messaging.message_reactions (
        message_id TEXT NOT NULL REFERENCES messaging.messages(id),
        user_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (message_id, user_id, emoji)
      );

      -- DM blocks (user-level)
      CREATE TABLE IF NOT EXISTS messaging.user_blocks (
        blocker_id TEXT NOT NULL,
        blocked_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (blocker_id, blocked_id)
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_messages_channel_created
        ON messaging.messages(channel_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_parent
        ON messaging.messages(parent_message_id) WHERE parent_message_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_channel_members_user
        ON messaging.channel_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_channels_scope
        ON messaging.channels(scope, scope_id);
    `;

        const result = await this.db.rawQuery(ddl);
        if (result.error) {
          throw new Error(`Messaging schema creation failed: ${result.error.message}`);
        }

        MessagingSchemaService.schemaReady = true;
        this.logger.log('Messaging schema ready');
      })();

      try {
        await MessagingSchemaService.schemaReadyPromise;
      } finally {
        if (!MessagingSchemaService.schemaReady) {
          MessagingSchemaService.schemaReadyPromise = null;
        }
      }
    });
  }
}
