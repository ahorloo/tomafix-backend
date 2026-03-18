import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AdminRoles } from './admin-roles.decorator';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Auth (no guard) ───────────────────────────────────────────────────────

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: { email: string; password: string }) {
    return this.adminService.login(body.email, body.password);
  }

  @Post('auth/logout')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: any) {
    const token = req.headers['authorization']?.slice(7) ?? '';
    return this.adminService.logout(token);
  }

  @Get('auth/me')
  @UseGuards(AdminGuard)
  me(@Req() req: any) {
    return this.adminService.me(req.adminUser.id);
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  @Get('dashboard')
  @UseGuards(AdminGuard)
  getDashboard() {
    return this.adminService.getDashboard();
  }

  // ── Workspaces ────────────────────────────────────────────────────────────

  @Get('workspaces')
  @UseGuards(AdminGuard)
  listWorkspaces(
    @Query('page') page?: string,
    @Query('status') status?: string,
    @Query('templateType') templateType?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.listWorkspaces(Number(page) || 1, 30, status, templateType, search);
  }

  @Get('workspaces/:id')
  @UseGuards(AdminGuard)
  getWorkspace(@Param('id') id: string) {
    return this.adminService.getWorkspace(id);
  }

  @Patch('workspaces/:id/activate')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'BILLING_ADMIN')
  activateWorkspace(@Param('id') id: string, @Req() req: any) {
    return this.adminService.activateWorkspace(id, req.adminUser.id, req.adminUser.email);
  }

  @Patch('workspaces/:id/suspend')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN')
  suspendWorkspace(@Param('id') id: string, @Req() req: any) {
    return this.adminService.suspendWorkspace(id, req.adminUser.id, req.adminUser.email);
  }

  @Patch('workspaces/:id/fix-payment')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'BILLING_ADMIN')
  fixPayment(@Param('id') id: string, @Req() req: any) {
    return this.adminService.fixWorkspacePayment(id, req.adminUser.id, req.adminUser.email);
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  @Get('users')
  @UseGuards(AdminGuard)
  listUsers(@Query('page') page?: string, @Query('search') search?: string) {
    return this.adminService.listUsers(Number(page) || 1, 30, search);
  }

  // ── Technician Applications ───────────────────────────────────────────────

  @Get('technician-applications')
  @UseGuards(AdminGuard)
  listTechApplications(@Query('page') page?: string, @Query('status') status?: string) {
    return this.adminService.listTechApplications(Number(page) || 1, 30, status);
  }

  @Get('technician-applications/:id')
  @UseGuards(AdminGuard)
  getTechApplication(@Param('id') id: string) {
    return this.adminService.getTechApplication(id);
  }

  @Patch('technician-applications/:id/approve')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'REVIEW_ADMIN')
  approveTech(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: any) {
    return this.adminService.approveTechApplication(id, req.adminUser.id, req.adminUser.email, body.note);
  }

  @Patch('technician-applications/:id/reject')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'REVIEW_ADMIN')
  rejectTech(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: any) {
    return this.adminService.rejectTechApplication(id, req.adminUser.id, req.adminUser.email, body.note);
  }

  @Patch('technician-applications/:id/suspend')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN')
  suspendTech(@Param('id') id: string, @Req() req: any) {
    return this.adminService.suspendTechApplication(id, req.adminUser.id, req.adminUser.email);
  }

  // ── Audit Logs ────────────────────────────────────────────────────────────

  @Get('audit-logs')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN')
  listAuditLogs(@Query('page') page?: string) {
    return this.adminService.listAuditLogs(Number(page) || 1);
  }

  // ── Admin Users (SUPER_ADMIN only) ────────────────────────────────────────

  @Get('admins')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN')
  listAdmins() {
    return this.adminService.listAdminUsers();
  }

  @Post('admins')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN')
  createAdmin(@Body() body: { email: string; fullName: string; password: string; role: string }) {
    return this.adminService.createAdminUser(body.email, body.fullName, body.password, body.role);
  }
}
