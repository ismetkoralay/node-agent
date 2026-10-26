import { Module } from '@nestjs/common';
import { InMemoryChatStore } from '@node-agent/core';
import { CHAT_STORE } from '../agent/tokens.ts';

@Module({
  providers: [
    {
      provide: CHAT_STORE,
      useFactory: () => new InMemoryChatStore(),
    },
  ],
  exports: [CHAT_STORE],
})
export class ChatStoreModule {}
