import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  health(): { status: 'ok'; service: 'api' } {
    return { status: 'ok', service: 'api' };
  }

  @Get('ready')
  async readiness(): Promise<{ status: 'ready'; database: 'reachable' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'reachable' };
    } catch (error: unknown) {
      this.logger.error(
        'Database readiness check failed',
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('Database is not reachable');
    }
  }
}
