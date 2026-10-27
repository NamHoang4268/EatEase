import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';

type ExceptionDetails = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  error?: unknown;
};

function normalizeExceptionDetail(detail: string | object, status: number) {
  if (typeof detail === 'string') {
    return { code: `HTTP_${status}`, message: detail, details: {} };
  }

  const value = detail as ExceptionDetails;
  const message = Array.isArray(value.message)
    ? value.message.join(', ')
    : typeof value.message === 'string'
      ? value.message
      : 'Request failed';
  const fallbackCode =
    typeof value.error === 'string'
      ? value.error.toUpperCase().replaceAll(' ', '_')
      : `HTTP_${status}`;

  return {
    code: typeof value.code === 'string' ? value.code : fallbackCode,
    message,
    details: typeof value.details === 'object' && value.details !== null ? value.details : {},
  };
}

@Catch()
export class FoundationExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';
    const requestId = randomUUID();

    response.setHeader('X-Request-Id', requestId);
    response.status(status).json({
      error: {
        ...normalizeExceptionDetail(detail, status),
        requestId,
      },
    });
  }
}
