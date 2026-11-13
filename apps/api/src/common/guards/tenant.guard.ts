import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { User } from '@sbc/database';
import { and, eq, or } from 'drizzle-orm';
import {
  locations,
  memberships,
  tenants,
} from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';
import { RequestTenantContext } from '../decorators/current-tenant.decorator';

@Injectable()
export class TenantGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as User | undefined;

    if (!user) {
      throw new ForbiddenException('User authentication required before tenant resolution');
    }

    const tenantHeader = request.headers['x-tenant-id'] as string | undefined;
    const routeTenantId = (request.params?.tenantId || request.params?.slug) as string | undefined;
    const identifier = tenantHeader || routeTenantId;

    if (!identifier) {
      throw new BadRequestException('Tenant identifier (x-tenant-id header) is required');
    }

    // Tenant ID is resolved server-side and verified against DB
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(or(eq(tenants.id, identifier), eq(tenants.slug, identifier)))
      .limit(1);

    if (!tenant) {
      throw new NotFoundException({
        statusCode: 404,
        errorCode: 'TENANT_NOT_FOUND',
        message: `Tenant '${identifier}' not found`,
      });
    }

    if (tenant.status === 'suspended') {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'TENANT_SUSPENDED',
        message: 'This tenant organization has been suspended',
      });
    }

    // Verify user belongs to this tenant and has active membership
    const [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenant.id),
          eq(memberships.userId, user.id),
        ),
      )
      .limit(1);

    if (!membership || membership.status !== 'active') {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        message: 'You do not have active membership in this tenant',
      });
    }

    // Fetch active location for MVP (<= 1 active location per tenant)
    const [location] = await db
      .select()
      .from(locations)
      .where(and(eq(locations.tenantId, tenant.id), eq(locations.active, true)))
      .limit(1);

    const tenantContext: RequestTenantContext = {
      tenant,
      location,
      membership,
    };

    request.tenantContext = tenantContext;
    request.tenant = tenant;

    return true;
  }
}
