import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from './admin.guard';
import { AdminRoles } from './admin-roles.decorator';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Auth (no guard, but rate-limited to deter brute-force) ───────────────

  @Post('auth/login')
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  @HttpCode(HttpStatus.OK)
  login(@Body() body: { email: string; password: string }) {
    return this.adminService.login(body.email, body.password);
  }

  @Post('auth/otp/verify')
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() body: { token: string; code: string }) {
    return this.adminService.verifyAdminOtp(body.token, body.code);
  }

  @Post('auth/password-reset/request')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  requestPasswordReset(@Body() body: { email: string }) {
    return this.adminService.requestPasswordReset(body.email);
  }

  @Post('auth/password-reset/confirm')
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
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

  @Patch('users/:id/phone')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN')
  updateUserPhone(@Param('id') id: string, @Body() body: { phone: string }, @Req() req: any) {
    return this.adminService.updateUserPhone(id, req.adminUser.id, req.adminUser.email, body.phone ?? '');
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

  // ── Broadcasts ────────────────────────────────────────────────────────────

  @Get('broadcasts')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'CONTENT_ADMIN')
  listBroadcasts() {
    return this.adminService.listBroadcasts();
  }

  @Post('broadcasts/send')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'CONTENT_ADMIN')
  @HttpCode(HttpStatus.OK)
  sendBroadcast(
    @Body() body: { subject: string; body: string; audience: 'WORKSPACE_OWNERS' | 'ALL_USERS' | 'TEST'; testEmail?: string },
    @Req() req: any,
  ) {
    return this.adminService.sendBroadcast(req.adminUser.id, body);
  }

  // ── Plans (SUPER_ADMIN, BILLING_ADMIN) ────────────────────────────────────

  @Get('plans')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'BILLING_ADMIN')
  listPlans() {
    return this.adminService.listPlans();
  }

  @Post('plans')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'BILLING_ADMIN')
  createPlan(
    @Body() body: { templateId: string; name: string; interval: 'MONTHLY' | 'YEARLY'; amountPesewas: number; currency?: string },
    @Req() req: any,
  ) {
    return this.adminService.createPlan(req.adminUser.id, req.adminUser.email, body);
  }

  @Patch('plans/:id')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'BILLING_ADMIN')
  updatePlan(
    @Param('id') id: string,
    @Body() body: { name?: string; amountPesewas?: number; currency?: string; isActive?: boolean },
    @Req() req: any,
  ) {
    return this.adminService.updatePlan(req.adminUser.id, req.adminUser.email, id, body);
  }

  // ── Feature Flag Overrides (SUPER_ADMIN, OPS_ADMIN) ──────────────────────

  @Get('feature-overrides/:workspaceId')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN')
  getFeatureOverrides(@Param('workspaceId') workspaceId: string) {
    return this.adminService.getFeatureOverrides(workspaceId);
  }

  @Patch('feature-overrides/:workspaceId')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN')
  setFeatureOverrides(
    @Param('workspaceId') workspaceId: string,
    @Body() body: { features?: Record<string, boolean | null>; limits?: Record<string, number | null> },
    @Req() req: any,
  ) {
    return this.adminService.setFeatureOverrides(req.adminUser.id, req.adminUser.email, workspaceId, body);
  }

  // ── Compliance / GDPR (SUPER_ADMIN) ──────────────────────────────────────

  @Get('compliance/user-data/:userId')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN')
  exportUserData(@Param('userId') userId: string, @Req() req: any) {
    return this.adminService.exportUserData(req.adminUser.id, req.adminUser.email, userId);
  }

  @Post('compliance/erase-user/:userId')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN')
  eraseUser(@Param('userId') userId: string, @Req() req: any) {
    return this.adminService.eraseUser(req.adminUser.id, req.adminUser.email, userId);
  }

  // ── Impersonation (SUPER_ADMIN only — highly audited) ────────────────────

  @Post('impersonation/:userId')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN')
  impersonate(
    @Param('userId') userId: string,
    @Body() body: { reason?: string; workspaceId?: string },
    @Req() req: any,
  ) {
    return this.adminService.impersonateUser(req.adminUser.id, req.adminUser.email, userId, body);
  }

  // ── Churn metrics (SUPER_ADMIN, BILLING_ADMIN, OPS_ADMIN) ────────────────

  @Get('metrics/churn')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'BILLING_ADMIN', 'OPS_ADMIN')
  churnMetrics() {
    return this.adminService.churnMetrics();
  }

  // ── Reconciliation (BILLING_ADMIN, SUPER_ADMIN) ──────────────────────────

  @Get('reconciliation')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'BILLING_ADMIN')
  reconciliation(@Query('days') days?: string) {
    return this.adminService.reconciliation(Number(days) || 30);
  }

  // ── Workspace Health (OPS_ADMIN, SUPER_ADMIN) ────────────────────────────

  @Get('workspace-health')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN')
  workspaceHealth() {
    return this.adminService.workspaceHealth();
  }

  // ── Onboarding funnel (OPS_ADMIN, SUPER_ADMIN) ───────────────────────────

  @Get('metrics/onboarding-funnel')
  @UseGuards(AdminGuard)
  @AdminRoles('SUPER_ADMIN', 'OPS_ADMIN', 'BILLING_ADMIN')
  onboardingFunnel(@Query('days') days?: string) {
    return this.adminService.onboardingFunnel(Number(days) || 30);
  }
}
