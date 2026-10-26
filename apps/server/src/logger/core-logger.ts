import type { Logger } from '@node-agent/core';
import type { PinoLogger } from 'nestjs-pino';

export type PinoLike = Pick<PinoLogger, 'debug' | 'info' | 'warn' | 'error'>;

export function toCoreLogger(pinoLogger: PinoLike): Logger {
  return {
    info: (message, meta) => pinoLogger.info(meta ?? {}, message),
    debug: (message, meta) => pinoLogger.debug(meta ?? {}, message),
    warn: (message, meta) => pinoLogger.warn(meta ?? {}, message),
    error: (message, meta) => pinoLogger.error(meta ?? {}, message),
  };
}
