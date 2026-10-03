import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { entityPageSchema, parseInput } from '../../common/domain-input.js'
import { DatabaseService } from '../../database/database.service.js'
import { AccessService } from '../access/access.service.js'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'
@Controller('audit-logs')
@UseGuards(AuthSessionGuard)
export class AuditController {
  constructor(private readonly database: DatabaseService, private readonly access: AccessService) {}
  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const { entityId, page, pageSize } = parseInput(entityPageSchema, query)
    await this.access.requireEntityPermission(req.authSession.user.id, entityId, 'audit.read')
    const result = await this.database.db.execute<{ data: unknown[]; total: number }>(sql`WITH scoped AS (
      SELECT id, actor_id AS actor, action, resource_id AS resource, details, created_at FROM audit_logs WHERE entity_id = ${entityId}::uuid
      UNION ALL SELECT id, source AS actor, action, subject_user_id AS resource, details, created_at FROM access_audit WHERE entity_id = ${entityId}::uuid
    ), page AS (SELECT * FROM scoped ORDER BY created_at DESC,id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize})
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb) AS data,(SELECT count(*)::int FROM scoped) AS total`)
    return { data: result.rows[0].data, meta: { entityId, page, pageSize, total: result.rows[0].total } }
  }
}
