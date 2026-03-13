import { TemplateType } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { EntitlementsGuard } from '../../src/billing/guards';

describe('EntitlementsGuard', () => {
  it('returns Forbidden when limit exceeded', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ws1', planName: 'Starter', templateType: TemplateType.APARTMENT }),
      },
      workspaceMember: { count: jest.fn().mockResolvedValue(0) },
      property: { count: jest.fn().mockResolvedValue(1) },
      apartmentUnit: { count: jest.fn().mockResolvedValue(21) },
    };

    const guard = new EntitlementsGuard(prisma);

    const req: any = {
      method: 'POST',
      baseUrl: '',
      path: '/workspaces/ws1/apartment/units',
      params: { workspaceId: 'ws1' },
    };

    await expect(guard.use(req, {} as any, () => undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
