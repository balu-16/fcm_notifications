import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../database/database.module.js';
import type { Principal, Role } from '../auth/auth.types.js';
export interface UserRecord {
  id: string;
  email: string;
  role: Role;
}
@Injectable()
export class UsersRepository {
  constructor(@Inject(Database) private readonly database: Database) {}
  async upsert(
    principal: Principal,
    updateLogin: boolean,
  ): Promise<UserRecord> {
    // A single upsert is safe when requests for a new user arrive together.
    const result = await this.database.query<UserRecord>(
      `INSERT INTO users (cognito_sub, email, role, last_login_at)
       VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN now() ELSE NULL END)
       ON CONFLICT (cognito_sub) DO UPDATE SET
         email = EXCLUDED.email, role = EXCLUDED.role,
         last_login_at = COALESCE(EXCLUDED.last_login_at, users.last_login_at), updated_at = now()
       RETURNING id, email, role`,
      [principal.sub, principal.email, principal.role, updateLogin],
    );
    return result.rows[0];
  }
}
