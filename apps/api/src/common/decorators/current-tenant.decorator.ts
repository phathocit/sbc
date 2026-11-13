import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Tenant, Location, Membership } from '@sbc/database';

export interface RequestTenantContext {
  tenant: Tenant;
  location?: Location;
  membership: Membership;
}

export const CurrentTenant = createParamDecorator(
  (data: keyof RequestTenantContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const context = request.tenantContext as RequestTenantContext;
    return data && context ? context[data] : context;
  },
);
