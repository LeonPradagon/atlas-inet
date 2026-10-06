import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { entityPageSchema, parseInput } from '../../common/domain-input.js'
import { DatabaseService } from '../../database/database.service.js'
import { AccessService } from '../access/access.service.js'
import { AuthSessionGuard, type AuthenticatedRequest } from '../auth/auth-session.guard.js'

const auditQuerySchema = entityPageSchema.extend({
  search: z.string().trim().max(200).optional(),
  action: z.string().trim().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).strict().refine((query) => !query.from || !query.to || query.from <= query.to, {
  path: ['to'], message: 'Tanggal akhir harus sama atau setelah tanggal awal',
})

@Controller('audit-logs')
@UseGuards(AuthSessionGuard)
export class AuditController {
  constructor(private readonly database: DatabaseService, private readonly access: AccessService) {}
  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const { entityId, page, pageSize, search, action, from, to } = parseInput(auditQuerySchema, query)
    await this.access.requireEntityPermission(req.authSession.user.id, entityId, 'audit.read')
    const result = await this.database.db.execute<{ data: unknown[]; total: number }>(sql`WITH scoped AS (
      SELECT a.id, COALESCE(actor.name, actor.email, a.actor_id) AS actor, a.action, a.resource_id AS resource, a.details, a.created_at
        FROM audit_logs a LEFT JOIN "user" actor ON actor.id = a.actor_id WHERE a.entity_id = ${entityId}::uuid
      UNION ALL SELECT id, source AS actor, action, subject_user_id AS resource, details, created_at FROM access_audit WHERE entity_id = ${entityId}::uuid
    ), filtered AS (
      SELECT * FROM scoped WHERE
        (${search ?? null}::text IS NULL OR actor ILIKE '%' || ${search ?? ''} || '%' OR action ILIKE '%' || ${search ?? ''} || '%' OR COALESCE(resource, '') ILIKE '%' || ${search ?? ''} || '%' OR details::text ILIKE '%' || ${search ?? ''} || '%')
        AND (${action ?? null}::text IS NULL OR action ILIKE '%' || ${action ?? ''} || '%')
        AND (${from ?? null}::date IS NULL OR created_at >= ${from ?? null}::date)
        AND (${to ?? null}::date IS NULL OR created_at < (${to ?? null}::date + INTERVAL '1 day'))
    ), page AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize})
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb) AS data,(SELECT count(*)::int FROM filtered) AS total`)
    return { data: result.rows[0].data, meta: { entityId, page, pageSize, total: result.rows[0].total } }
  }
}
