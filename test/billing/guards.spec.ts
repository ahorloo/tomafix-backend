import { ForbiddenException } from '@nestjs/common';
import { EntitlementsGuard } from '../../src/billing/guards';

describe('EntitlementsGuard', () => {
  it('returns Forbidden when limit exceeded', async () => {
    const prisma: any = {
      workspace: { findUnique: jest.fn().mockResolvedValue({ id: 'ws1', planName: 'Starter' }) },
      property: { count: jest.fn().mockResolvedValue(1) },
      unit: { count: jest.fn().mockResolvedValue(21) },
    };

    const guard = new EntitlementsGuard(prisma);

    const req: any = {
      method: 'POST',
      route: { path: '/workspaces/:workspaceId/apartment/units' },
      params: { workspaceId: 'ws1' },
    };

    await expect(async () => guard.use(req, {} as any, () => undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
