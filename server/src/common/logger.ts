import type { LoggerService } from '@nestjs/common';

export function safeStartupMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^(Invalid or missing environment variables:|Invalid CORS_ORIGINS|COGNITO_APP_CLIENT_IDS|COGNITO_USER_POOL_ID|DATABASE_URL must|Firebase service-account file)/.test(
    message,
  )
    ? message
    : 'Server error; check configuration and connectivity';
}
export class JsonLogger implements LoggerService {
  private write(level: string, message: string): void {
    const entry = JSON.stringify({
      time: new Date().toISOString(),
      level,
      message,
    });
    if (level === 'error') console.error(entry);
    else console.log(entry);
  }
  log(message: unknown): void {
    this.write(
      'info',
      typeof message === 'string' ? message : 'Application event',
    );
  }
  warn(message: unknown): void {
    this.write(
      'warn',
      typeof message === 'string' ? message : 'Application warning',
    );
  }
  error(message: unknown): void {
    this.write('error', safeStartupMessage(message));
  }
  debug(message: unknown): void {
    this.write('debug', typeof message === 'string' ? message : 'Debug event');
  }
  verbose(message: unknown): void {
    this.write(
      'debug',
      typeof message === 'string' ? message : 'Verbose event',
    );
  }
}
