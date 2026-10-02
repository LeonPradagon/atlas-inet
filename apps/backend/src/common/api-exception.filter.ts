import {
  Catch,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { Response } from 'express'

const errorCodes = new Map<number, string>([
  [HttpStatus.BAD_REQUEST, 'BAD_REQUEST'],
  [HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED'],
  [HttpStatus.FORBIDDEN, 'FORBIDDEN'],
  [HttpStatus.NOT_FOUND, 'NOT_FOUND'],
  [HttpStatus.CONFLICT, 'CONFLICT'],
  [HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE_ENTITY'],
  [HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_REQUESTS'],
  [HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE'],
])

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const response = http.getResponse<Response>()
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR
    const detail = exception instanceof HttpException ? exception.getResponse() : undefined
    const message = typeof detail === 'string'
      ? detail
      : typeof detail === 'object' && detail !== null && 'message' in detail && typeof detail.message === 'string'
        ? detail.message
        : status >= 500
          ? 'Internal server error'
          : 'Request failed'

    response.status(status).json({
      error: {
        code: errorCodes.get(status) ?? (status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR'),
        message,
      },
      requestId: response.locals.requestId,
    })
  }
}
