/**
 * Application errors carry the HTTP status and the machine-readable code with
 * them, so a route can `throw` and the single error handler in `app.ts` renders
 * the envelope.
 */
export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }

  static notFound(resource: string): AppError {
    return new AppError(404, 'not_found', `That ${resource} no longer exists.`)
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'bad_request', message, details)
  }

  static conflict(message: string): AppError {
    return new AppError(409, 'conflict', message)
  }

  static unauthorized(message = 'Sign in to continue.'): AppError {
    return new AppError(401, 'unauthorized', message)
  }

  static forbidden(message = 'Your role does not allow this.'): AppError {
    return new AppError(403, 'forbidden', message)
  }
}
