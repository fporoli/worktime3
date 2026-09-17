import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt.guard';
import { HealthController } from './health.controller';
import { ProjectTimeService } from './project-time.service';
import { RbacService } from './rbac.service';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { WorkflowsService } from './workflows.service';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { OrgsController } from './orgs.controller';
import { RolesController } from './roles.controller';
import { TeamsController } from './teams.controller';
import { ProjectsController } from './projects.controller';
import { ProjectTimeController } from './project-time.controller';
import { TimesheetsController } from './timesheets.controller';
import { ExpensesController } from './expenses.controller';
import { ExpenseReportsController } from './expense-reports.controller';
import { WorkflowsController } from './workflows.controller';
import { StaticDataController } from './static-data.controller';
import { AuditController } from './audit.controller';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
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
    ProjectTimeController,
    TimesheetsController,
    ExpensesController,
    ExpenseReportsController,
    WorkflowsController,
    StaticDataController,
    AuditController,
    AssistantController,
    NotificationsController,
  ],
  providers: [
    DbService,
    ProjectTimeService,
    RbacService,
    AuditService,
    VersionsService,
    WorkflowsService,
    AssistantService,
    NotificationsService,
    NotificationsGateway,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
