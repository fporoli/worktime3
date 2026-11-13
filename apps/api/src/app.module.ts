import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt.guard';
import { HealthController } from './health.controller';
import { AboutController } from './about.controller';
import { ProjectTimeService } from './project-time.service';
import { RbacService } from './rbac.service';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { WorkflowsService } from './workflows.service';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { OrgsController } from './orgs.controller';
import { PermissionsController } from './permissions.controller';
import { OrgRolesController, RolesController } from './roles.controller';
import { TeamsController } from './teams.controller';
import { ProjectsController } from './projects.controller';
import { ProjectTimeController } from './project-time.controller';
import { WorkTimeController } from './work-time.controller';
import { WorkTimeService } from './work-time.service';
import { DocumentsService } from './documents.service';
import { AbsencesController } from './absences.controller';
import { BalancesController } from './balances.controller';
import { WorkSchedulesController } from './work-schedules.controller';
import { TeamOverviewController } from './team-overview.controller';
import { EmploymentController } from './employment.controller';
import { WorkTimeModelService } from './work-time-model.service';
import { BalancesService } from './balances.service';
import { ProjectTimesheetsController } from './project-timesheets.controller';
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
import { FieldsController } from './fields.controller';
import { FieldsService } from './fields.service';
import { DbService } from './db.service';

@Module({
  controllers: [
    HealthController,
    AboutController,
    AuthController,
    UsersController,
    BasicDataController,
    FieldsController,
    OrgsController,
    PermissionsController,
    RolesController,
    OrgRolesController,
    TeamsController,
    ProjectsController,
    ProjectTimeController,
    WorkTimeController,
    AbsencesController,
    BalancesController,
    WorkSchedulesController,
    TeamOverviewController,
    EmploymentController,
    TimesheetsController,
    ProjectTimesheetsController,
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
    WorkTimeService,
    BalancesService,
    WorkTimeModelService,
    DocumentsService,
    RbacService,
    AuditService,
    VersionsService,
    WorkflowsService,
    AssistantService,
    NotificationsService,
    NotificationsGateway,
    BasicDataService,
    FieldsService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
