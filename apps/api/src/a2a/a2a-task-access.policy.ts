import { ForbiddenException, Injectable } from '@nestjs/common';

export interface BoundAgentPrincipal {
  effectiveUserId: string;
  installationId: string;
  grantId: string;
  scopes: readonly string[];
}

export interface StoredTaskBinding {
  userId: string;
  installationId: string;
  grantId: string;
  originalSkillScope: string;
}

@Injectable()
export class A2ATaskAccessPolicy {
  assertAccess(
    principal: BoundAgentPrincipal,
    task: StoredTaskBinding,
  ): void {
    if (
      principal.effectiveUserId !== task.userId
      || principal.installationId !== task.installationId
      || principal.grantId !== task.grantId
      || !principal.scopes.includes(task.originalSkillScope)
    ) {
      throw new ForbiddenException('Task is not accessible to this agent grant');
    }
  }
}
