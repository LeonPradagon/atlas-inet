import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import { AuthService, type AuthSession } from './auth.service.js'

export type AuthenticatedRequest = Request & { authSession: AuthSession }

@Injectable()
export class AuthSessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const session = await this.authService.getSession(request.headers)
    if (!session) throw new UnauthorizedException('A valid session is required')

    ;(request as AuthenticatedRequest).authSession = session
    return true
  }
}
