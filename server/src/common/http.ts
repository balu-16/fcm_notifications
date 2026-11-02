import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
type RequestWithId = Request & { requestId: string };
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    request.requestId = randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    next();
  }
}
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const body =
      typeof detail === 'object' && detail !== null
        ? (detail as { message?: string | string[]; error?: string })
        : undefined;
    const message =
      body?.message ??
      (typeof detail === 'string' ? detail : 'Internal server error');
    if (status >= 500)
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'Request failed',
          statusCode: status,
          requestId: request.requestId,
        }),
      );
    response
      .status(status)
      .json({
        statusCode: status,
        error: body?.error ?? HttpStatus[status] ?? 'Error',
        message,
        requestId: request.requestId,
      });
  }
}
