import { Module } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { CHAT_STORE } from '../agent/tokens.ts';
import { DatabaseModule, DB } from '../database/database.module.ts';
import { PostgresChatStore } from './postgres-chat-store.ts';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: CHAT_STORE,
      useFactory: (db: NodePgDatabase) => new PostgresChatStore(db),
      inject: [DB],
    },
  ],
  exports: [CHAT_STORE],
})
export class ChatStoreModule {}
