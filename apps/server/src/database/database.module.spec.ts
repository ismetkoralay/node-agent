import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseModule, DB, PG_POOL } from './database.module.ts';

describe('DatabaseModule Shutdown Hook', () => {
  let databaseModule: DatabaseModule;
  let mockPool: { end: ReturnType<typeof vi.fn> };
  let mockLogger: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockPool = {
      end: vi.fn().mockResolvedValue(undefined),
    };
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseModule,
        {
          provide: PG_POOL,
          useValue: mockPool, // Bypass the real PG client network request
        },
        {
          provide: DB,
          useValue: {}, // Pass an empty object placeholder for Drizzle
        },
        {
          provide: getLoggerToken(DatabaseModule.name),
          useValue: mockLogger,
        },
      ],
    }).compile();

    databaseModule = moduleFixture.get<DatabaseModule>(DatabaseModule);
  });

  test('closes the pool and logs both steps on shutdown', async () => {
    await databaseModule.onApplicationShutdown('SIGTERM');

    expect(mockPool.end).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenNthCalledWith(
      1,
      'received SIGTERM; closing connection pool...',
    );
    expect(mockLogger.info).toHaveBeenNthCalledWith(2, 'database pool closed cleanly.');
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  test('logs the error with the err key and does not rethrow when pool.end() fails', async () => {
    const mockError = new Error('Database pool termination timeout');
    mockPool.end.mockRejectedValueOnce(mockError);

    // An internal error must not bubble up and break Nest application unmounts
    await expect(databaseModule.onApplicationShutdown('SIGTERM')).resolves.toBeUndefined();

    expect(mockPool.end).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
      { err: mockError },
      'error closing database pool',
    );
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).not.toHaveBeenCalledWith('database pool closed cleanly.');
  });
});
