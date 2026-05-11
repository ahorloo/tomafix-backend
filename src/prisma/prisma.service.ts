import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // Default to lean logs in every environment. Noisy `query` + `info`
    // logging buffers SQL strings in memory and was the largest contributor
    // to a 512MB OOM on small Render dynos. Opt-in for verbose via env.
    const verbose = String(process.env.DEBUG_PRISMA_QUERIES || '').toLowerCase() === 'true';
    super({
      log: verbose ? ['query', 'info', 'warn', 'error'] : ['error', 'warn'],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}