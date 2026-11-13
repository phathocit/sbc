import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '@sbc/contracts';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);
