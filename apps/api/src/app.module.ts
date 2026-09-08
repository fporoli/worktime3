import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { WorktimeService } from './worktime.service';
import { RbacService } from './rbac.service';
import { AuditService } from './audit.service';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { OrgsController } from './orgs.controller';
import { ProjectsController } from './projects.controller';
import { WorktimeController } from './worktime.controller';
import { StaticDataController } from './static-data.controller';
import { AuditController } from './audit.controller';
import { DbService } from './db.service';

@Module({
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    OrgsController,
    ProjectsController,
    WorktimeController,
    StaticDataController,
    AuditController,
  ],
  providers: [DbService, WorktimeService, RbacService, AuditService],
})
export class AppModule {}
