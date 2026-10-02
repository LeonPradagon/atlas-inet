import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import type { AuthenticatedRequest } from './auth-session.guard.js'
import { AuthSessionGuard } from './auth-session.guard.js'

@Controller()
export class AuthController {
  @Get('me')
  @UseGuards(AuthSessionGuard)
  getCurrentUser(@Req() request: AuthenticatedRequest) {
    const { user } = request.authSession

    return {
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
        },
        entities: [],
        permissions: [],
      },
    }
  }
}
