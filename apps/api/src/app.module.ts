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
import { WorkTimeController } from './work-time.controller';
import { WorkTimeService } from './work-time.service';
import { DocumentsService } from './documents.service';
import { AbsencesController } from './absences.controller';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';
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
import { BasicDataController } from './basicdata.controller';
import { BasicDataService } from './basicdata.service';
import { DbService } from './db.service';
import { SystemAdminController } from './system-admin.controller';
import { DocumentsController } from './documents.controller';

@Module({
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    BasicDataController,
    OrgsController,
    RolesController,
    TeamsController,
    ProjectsController,
    ProjectTimeController,
    WorkTimeController,
    AbsencesController,
    BalancesController,
    TimesheetsController,
    ExpensesController,
    ExpenseReportsController,
    WorkflowsController,
    StaticDataController,
    AuditController,
    AssistantController,
    NotificationsController,
    SystemAdminController,
    DocumentsController,
  ],
  providers: [
    DbService,
    ProjectTimeService,
    WorkTimeService,
    BalancesService,
    DocumentsService,
    RbacService,
    AuditService,
    VersionsService,
    WorkflowsService,
    AssistantService,
    NotificationsService,
    NotificationsGateway,
    BasicDataService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
