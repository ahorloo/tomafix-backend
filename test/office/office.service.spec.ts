import { MemberRole, OfficeCommunityChannelKey, RequestStatus, TemplateType } from '@prisma/client';
import { OfficeService } from '../../src/office/office.service';

describe('OfficeService notifications', () => {
  it('sends an assignment email when a work order is created with an assignee', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ws-1', templateType: TemplateType.OFFICE }),
      },
      officeWorkOrder: {
        create: jest.fn().mockResolvedValue({ id: 'wo-1', title: 'Fix AC' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'tech-1', email: 'tech@example.com', fullName: 'Tech One' }),
      },
    };
    const mail: any = {
      sendWoAssigned: jest.fn().mockResolvedValue(undefined),
      sendRequestStatusUpdate: jest.fn(),
    };

    const service = new OfficeService(prisma, mail);
    await service.createWorkOrder('ws-1', {
      assignedToUserId: 'tech-1',
      title: 'Fix AC',
    } as any);

    expect(mail.sendWoAssigned).toHaveBeenCalledWith(
      'tech@example.com',
      'Tech One',
      'Fix AC',
      'ws-1',
    );
  });

  it('sends a requester email when request status changes', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ws-1', templateType: TemplateType.OFFICE }),
      },
      officeRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'req-1',
          workspaceId: 'ws-1',
          submitterUserId: 'user-1',
          title: 'Printer issue',
          status: RequestStatus.PENDING,
          resolvedAt: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'req-1', status: RequestStatus.RESOLVED }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'requester@example.com', fullName: 'Requester' }),
      },
    };
    const mail: any = {
      sendWoAssigned: jest.fn(),
      sendRequestStatusUpdate: jest.fn().mockResolvedValue(undefined),
    };

    const service = new OfficeService(prisma, mail);
    await service.updateRequest('ws-1', 'req-1', { status: RequestStatus.RESOLVED });

    expect(mail.sendRequestStatusUpdate).toHaveBeenCalledWith(
      'requester@example.com',
      'Requester',
      'Printer issue',
      RequestStatus.RESOLVED,
      'ws-1',
    );
  });

  it('provisions the default office community channels and returns them in product order', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ws-1', templateType: TemplateType.OFFICE }),
      },
      officeCommunityChannel: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ key: OfficeCommunityChannelKey.GENERAL_HELP }])
          .mockResolvedValueOnce([
            {
              id: 'c-1',
              key: OfficeCommunityChannelKey.UPDATES,
              name: 'Office Updates',
              description: 'Fast office updates',
              _count: { messages: 1 },
              messages: [],
            },
            {
              id: 'c-2',
              key: OfficeCommunityChannelKey.GENERAL_HELP,
              name: 'General Help',
              description: 'Quick office questions',
              _count: { messages: 0 },
              messages: [],
            },
            {
              id: 'c-3',
              key: OfficeCommunityChannelKey.ADMIN_HELP,
              name: 'Admin Help',
              description: 'Admin help',
              _count: { messages: 0 },
              messages: [],
            },
            {
              id: 'c-4',
              key: OfficeCommunityChannelKey.COVERAGE,
              name: 'Today / Availability',
              description: 'Availability',
              _count: { messages: 0 },
              messages: [],
            },
          ]),
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };
    const mail: any = {
      sendWoAssigned: jest.fn(),
      sendRequestStatusUpdate: jest.fn(),
    };

    const service = new OfficeService(prisma, mail);
    const channels = await service.listCommunityChannels('ws-1');

    expect(prisma.officeCommunityChannel.createMany).toHaveBeenCalled();
    expect(channels.map((channel: any) => channel.key)).toEqual([
      OfficeCommunityChannelKey.GENERAL_HELP,
      OfficeCommunityChannelKey.ADMIN_HELP,
      OfficeCommunityChannelKey.COVERAGE,
      OfficeCommunityChannelKey.UPDATES,
    ]);
  });

  it('blocks technicians from posting inside the office updates channel', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ws-1', templateType: TemplateType.OFFICE }),
      },
      officeCommunityChannel: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { key: OfficeCommunityChannelKey.GENERAL_HELP },
            { key: OfficeCommunityChannelKey.ADMIN_HELP },
            { key: OfficeCommunityChannelKey.COVERAGE },
            { key: OfficeCommunityChannelKey.UPDATES },
          ])
          .mockResolvedValueOnce([
            {
              id: 'updates-1',
              workspaceId: 'ws-1',
              key: OfficeCommunityChannelKey.UPDATES,
              name: 'Office Updates',
              description: 'Fast office updates',
              _count: { messages: 0 },
              messages: [],
            },
          ]),
        createMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({
          id: 'updates-1',
          workspaceId: 'ws-1',
          key: OfficeCommunityChannelKey.UPDATES,
          name: 'Office Updates',
        }),
      },
    };
    const mail: any = {
      sendWoAssigned: jest.fn(),
      sendRequestStatusUpdate: jest.fn(),
    };

    const service = new OfficeService(prisma, mail);

    await expect(
      service.addCommunityMessage('ws-1', 'updates-1', {
        senderUserId: 'tech-1',
        body: 'Front desk internet is back',
        actorRole: MemberRole.TECHNICIAN,
      }),
    ).rejects.toThrow('Only owner admins and managers can post in Office Updates');
  });

  it('locks preventive maintenance asset fields on Starter office plans', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ws-1',
          templateType: TemplateType.OFFICE,
          planName: 'Starter',
        }),
      },
      officeAsset: {
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const mail: any = {
      sendWoAssigned: jest.fn(),
      sendRequestStatusUpdate: jest.fn(),
    };

    const service = new OfficeService(prisma, mail);

    await expect(
      service.createAsset('ws-1', {
        name: 'Generator',
        pmAutoCreate: true,
      } as any),
    ).rejects.toThrow('Preventive maintenance fields are available on Growth and above.');
  });

  it('allows core asset creation on Starter when PM is left disabled', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'ws-1',
            templateType: TemplateType.OFFICE,
          })
          .mockResolvedValueOnce({
            id: 'ws-1',
            templateType: TemplateType.OFFICE,
            planName: 'Starter',
          }),
      },
      officeAsset: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'asset-1', name: 'Printer' }),
      },
    };
    const mail: any = {
      sendWoAssigned: jest.fn(),
      sendRequestStatusUpdate: jest.fn(),
    };

    const service = new OfficeService(prisma, mail);

    await expect(
      service.createAsset('ws-1', {
        name: 'Printer',
        pmAutoCreate: false,
      } as any),
    ).resolves.toEqual({ id: 'asset-1', name: 'Printer' });
  });
});
