import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/config.module.js';
import { HttpErrorFilter } from './common/http.js';
import { JsonLogger, safeStartupMessage } from './common/logger.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    logger: new JsonLogger(),
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  app.use(helmet());
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => callback(null, !origin || config.corsOrigins.includes(origin)),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'API listening',
      port: config.port,
    }),
  );
}
void bootstrap().catch((error: unknown) => {
  console.error(
    JSON.stringify({ level: 'error', message: safeStartupMessage(error) }),
  );
  process.exitCode = 1;
});
