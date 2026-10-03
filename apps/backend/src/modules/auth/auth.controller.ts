import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import type { AuthenticatedRequest } from './auth-session.guard.js'
import { AuthSessionGuard } from './auth-session.guard.js'
import { AccessService } from '../access/access.service.js'

@Controller()
export class AuthController {
  constructor(private readonly access: AccessService) {}

  @Get('me')
  @UseGuards(AuthSessionGuard)
  async getCurrentUser(@Req() request: AuthenticatedRequest) {
    const { user } = request.authSession
    const entityAccess = await this.access.getUserAccess(user.id)

    return {
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
        },
        entities: entityAccess.map((entity) => entity.id),
        // Union is informational only; authorization always checks entityAccess.
        permissions: [...new Set(entityAccess.flatMap((entity) => entity.permissions))].sort(),
        entityAccess,
      },
    }
  }
}
