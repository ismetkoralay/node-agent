import { TerminusModule } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { VERSION } from '@node-agent/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { HealthController } from './health.controller.ts';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  test('should be defined', () => {
    expect(controller).toBeDefined();
  });

  test('should return health check', async () => {
    const res = await controller.check();
    expect(res).toMatchObject({
      status: 'ok',
      version: VERSION,
    });
  });
});
