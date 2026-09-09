import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt.guard';
import { HealthController } from './health.controller';
import { WorktimeService } from './worktime.service';
import { RbacService } from './rbac.service';
import { AuditService } from './audit.service';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { OrgsController } from './orgs.controller';
import { RolesController } from './roles.controller';
import { TeamsController } from './teams.controller';
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
    RolesController,
    TeamsController,
    ProjectsController,
    WorktimeController,
    StaticDataController,
    AuditController,
  ],
  providers: [DbService, WorktimeService, RbacService, AuditService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
