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

  @Post('auth/otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() body: { token: string; code: string }) {
    return this.adminService.verifyAdminOtp(body.token, body.code);
  }

  @Post('auth/password-reset/request')
  @HttpCode(HttpStatus.OK)
  requestPasswordReset(@Body() body: { email: string }) {
    return this.adminService.requestPasswordReset(body.email);
  }

  @Post('auth/password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  confirmPasswordReset(@Body() body: { token: string; password: string }) {
    return this.adminService.resetAdminPassword(body.token, body.password);
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
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'BILLING_ADMIN', 'REVIEW_ADMIN', 'CONTENT_ADMIN')
  getDashboard() {
    return this.adminService.getDashboard();
  }

  @Get('analytics')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'BILLING_ADMIN', 'REVIEW_ADMIN')
  getAnalytics() {
    return this.adminService.getAnalyticsOverview();
  }

  @Get('risk-center')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'REVIEW_ADMIN', 'BILLING_ADMIN')
  getRiskCenter() {
    return this.adminService.getRiskCenter();
  }

  @Get('system-health')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN')
  getSystemHealth() {
    return this.adminService.getSystemHealth();
  }

  // ── Workspaces ────────────────────────────────────────────────────────────

  @Get('workspaces')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'BILLING_ADMIN')
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
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'BILLING_ADMIN')
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

  @Patch('workspaces/:id/notes')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'BILLING_ADMIN')
  updateWorkspaceNotes(@Param('id') id: string, @Body() body: { notes: string }, @Req() req: any) {
    return this.adminService.updateWorkspaceNotes(id, req.adminUser.id, req.adminUser.email, body.notes ?? '');
  }

  @Patch('workspaces/:id/owner-phone')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'BILLING_ADMIN')
  updateWorkspaceOwnerPhone(@Param('id') id: string, @Body() body: { phone: string }, @Req() req: any) {
    return this.adminService.updateWorkspaceOwnerPhone(id, req.adminUser.id, req.adminUser.email, body.phone ?? '');
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  @Get('users')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN')
  listUsers(@Query('page') page?: string, @Query('search') search?: string) {
    return this.adminService.listUsers(Number(page) || 1, 30, search);
  }

  // ── Technician Applications ───────────────────────────────────────────────

  @Get('technician-applications')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'REVIEW_ADMIN')
  listTechApplications(@Query('page') page?: string, @Query('status') status?: string) {
    return this.adminService.listTechApplications(Number(page) || 1, 30, status);
  }

  @Get('technician-applications/:id')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'REVIEW_ADMIN')
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
  @AdminRoles('SUPER_ADMIN')
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

  @Patch('admins/:id')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN')
  updateAdmin(
    @Param('id') id: string,
    @Body() body: { role?: string; isActive?: boolean },
    @Req() req: any,
  ) {
    return this.adminService.updateAdminUser(id, req.adminUser.id, req.adminUser.email, body);
  }
}
