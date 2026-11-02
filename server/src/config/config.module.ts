import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  cognitoRegion: string;
  cognitoUserPoolId: string;
  cognitoAppClientIds: string[];
  cognitoAdminGroup: string;
  firebaseServiceAccountPath: string;
}
const environment = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().trim().min(1),
  CORS_ORIGINS: z.string().trim().min(1),
  COGNITO_REGION: z.string().trim().min(1),
  COGNITO_USER_POOL_ID: z.string().trim().min(1),
  COGNITO_APP_CLIENT_IDS: z.string().trim().min(1),
  COGNITO_ADMIN_GROUP: z.string().trim().min(1),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().trim().min(1),
});
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = environment.safeParse(env);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.'))),
    ];
    throw new Error(
      `Invalid or missing environment variables: ${fields.join(', ')}`,
    );
  }
  const data = parsed.data;
  const corsOrigins = data.CORS_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const clientIds = data.COGNITO_APP_CLIENT_IDS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !corsOrigins.length ||
    corsOrigins.some((origin) => {
      try {
        return new URL(origin).origin !== origin;
      } catch {
        return true;
      }
    })
  )
    throw new Error(
      'Invalid CORS_ORIGINS: supply comma-separated exact origins',
    );
  if (!clientIds.length)
    throw new Error(
      'COGNITO_APP_CLIENT_IDS must contain at least one client ID',
    );
  if (!data.COGNITO_USER_POOL_ID.startsWith(`${data.COGNITO_REGION}_`))
    throw new Error('COGNITO_USER_POOL_ID must belong to COGNITO_REGION');
  if (!/^postgres(?:ql)?:\/\//.test(data.DATABASE_URL))
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  return {
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    corsOrigins,
    cognitoRegion: data.COGNITO_REGION,
    cognitoUserPoolId: data.COGNITO_USER_POOL_ID,
    cognitoAppClientIds: [...new Set(clientIds)],
    cognitoAdminGroup: data.COGNITO_ADMIN_GROUP,
    firebaseServiceAccountPath: data.FIREBASE_SERVICE_ACCOUNT_PATH,
  };
}
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig(process.env) },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
