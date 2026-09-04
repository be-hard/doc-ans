import { Catch, type ArgumentsHost, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (res.headersSent) {
      return;
    }

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = this.extractMessage(exception, payload);

    this.logger.error(`${req.method} ${req.url} -> ${status} ${message}`, exception instanceof Error ? exception.stack : undefined);
    res.status(status).json({
      statusCode: status,
      message,
      path: req.url,
      timestamp: new Date().toISOString()
    });
  }

  private extractMessage(exception: unknown, payload?: unknown) {
    if (typeof payload === "string") {
      return payload;
    }
    if (payload && typeof payload === "object" && "message" in payload) {
      const message = payload.message;
      return Array.isArray(message) ? message.join(", ") : String(message);
    }
    if (exception instanceof Error) {
      return exception.message;
    }
    return "Internal server error";
  }
}
