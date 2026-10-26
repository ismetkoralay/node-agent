import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { EnvService } from '../config/env.service.ts';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [EnvService],
      useFactory: (envService: EnvService) => {
        const isDev = envService.get('NODE_ENV') === 'development';

        return {
          pinoHttp: {
            level: envService.get('LOG_LEVEL'),
            transport: isDev
              ? {
                  target: 'pino-pretty',
                }
              : undefined,
            genReqId: (req, res): string => {
              let reqId: string;
              if (req.headers['x-request-id']) {
                reqId = req.headers['x-request-id'] as string;
              } else {
                reqId = crypto.randomUUID();
              }
              res.setHeader('x-request-id', reqId);
              return reqId;
            },
            quietReqLogger: true,
            redact: ['req.headers.authorization'],
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
