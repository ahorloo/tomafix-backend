import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TemplateType, type Workspace } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type WorkspaceScope = Pick<Workspace, 'id' | 'name' | 'templateType' | 'planName'>;

export async function assertWorkspaceTemplate<T extends TemplateType>(
  prisma: PrismaService,
  workspaceId: string,
  allowedTemplates: readonly T[],
  unsupportedMessage: string,
): Promise<WorkspaceScope & { templateType: T }> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, templateType: true, planName: true },
  });

  if (!workspace) throw new NotFoundException('Workspace not found');
  if (!allowedTemplates.includes(workspace.templateType as T)) {
    throw new BadRequestException(unsupportedMessage);
  }

  return workspace as WorkspaceScope & { templateType: T };
}
