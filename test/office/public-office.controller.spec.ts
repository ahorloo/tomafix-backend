import { NotFoundException } from '@nestjs/common';

import { PublicOfficeController } from '../../src/office/public-office.controller';

describe('PublicOfficeController', () => {
  it('returns workspace info and areas for an active office workspace', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ws-1',
          name: 'HQ',
          templateType: 'OFFICE',
          status: 'ACTIVE',
        }),
      },
      officeArea: {
        findMany: jest.fn().mockResolvedValue([{ id: 'area-1', name: 'Reception', type: 'OTHER' }]),
      },
    };

    const controller = new PublicOfficeController({} as any, prisma);
    await expect(controller.getPublicInfo('ws-1')).resolves.toEqual({
      workspace: { id: 'ws-1', name: 'HQ' },
      areas: [{ id: 'area-1', name: 'Reception', type: 'OTHER' }],
    });
  });

  it('throws a not found error when the workspace is unavailable', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      officeArea: {
        findMany: jest.fn(),
      },
    };

    const controller = new PublicOfficeController({} as any, prisma);
    await expect(controller.getPublicInfo('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.officeArea.findMany).not.toHaveBeenCalled();
  });
});
