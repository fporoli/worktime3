import { Controller, Get } from '@nestjs/common';
import { Public } from './jwt.guard';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
