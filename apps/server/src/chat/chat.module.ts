import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.ts';
import { ChatController } from './chat.controller.ts';
import { ChatService } from './chat.service.ts';

@Module({
  imports: [AgentModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
