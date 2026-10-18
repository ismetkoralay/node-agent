import { describeChatStore } from '../testing/index.ts';
import { InMemoryChatStore } from './in_memory_chat_store.ts';

describeChatStore('InMemoryChatStore', () => new InMemoryChatStore());
