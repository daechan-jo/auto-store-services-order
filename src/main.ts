import * as process from 'node:process';

import { setupGlobalConsoleLogging } from '@daechanjo/log';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import * as dotenv from 'dotenv';
import { initializeTransactionalContext } from 'typeorm-transactional';

import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';

dotenv.config({
  path: '/Users/daechanjo/codes/project/auto-store/.env',
});

async function bootstrap() {
  const appConfig = AppConfig.getInstance();
  appConfig.appName = 'Order';
  initializeTransactionalContext();
  setupGlobalConsoleLogging({ appName: appConfig.appName });

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
      urls: [String(process.env.RABBITMQ_URL)],
      queue: 'order-queue',
      queueOptions: { durable: false },
    },
  });

  await app.listen();
  console.log('주문 서비스 시작');
}

bootstrap();
