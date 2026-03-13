import { NotFoundException } from '@nestjs/common';

import { PublicOfficeController } from '../../src/office/public-office.controller';

describe('PublicOfficeController', () => {
  it('returns workspace info and areas for an active office workspace', async () => {
    const office: any = {
      getPublicWorkspaceInfo: jest.fn().mockResolvedValue({
        workspace: { id: 'ws-1', name: 'HQ' },
        areas: [{ id: 'area-1', name: 'Reception', type: 'OTHER' }],
      }),
    };

    const controller = new PublicOfficeController(office);
    await expect(controller.getPublicInfo('ws-1')).resolves.toEqual({
      workspace: { id: 'ws-1', name: 'HQ' },
      areas: [{ id: 'area-1', name: 'Reception', type: 'OTHER' }],
    });
    expect(office.getPublicWorkspaceInfo).toHaveBeenCalledWith('ws-1');
  });

  it('throws a not found error when the workspace is unavailable', async () => {
    const office: any = {
      getPublicWorkspaceInfo: jest.fn().mockRejectedValue(new NotFoundException('Workspace not available')),
    };

    const controller = new PublicOfficeController(office);
    await expect(controller.getPublicInfo('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(office.getPublicWorkspaceInfo).toHaveBeenCalledWith('missing');
  });
});
