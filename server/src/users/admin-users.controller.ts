import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Roles } from '../auth/auth.decorators.js';
import { UserSearchDto } from '../common/pagination.js';
import { Database } from '../database/database.module.js';

@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Get()
  async list(@Query() query: UserSearchDto) {
    const search = `%${query.search.trim()}%`;
    const offset = (query.page - 1) * query.limit;
    const [items, count] = await Promise.all([
      this.database.query(
        `SELECT u.id, u.email, u.role, u.last_login_at AS "lastLoginAt",
          count(d.id) FILTER (WHERE d.platform = 'web')::int AS "webDevices",
          count(d.id) FILTER (WHERE d.platform = 'android')::int AS "androidDevices"
         FROM users u LEFT JOIN device_tokens d ON d.user_id = u.id AND d.is_active
         WHERE u.email ILIKE $1 GROUP BY u.id ORDER BY lower(u.email), u.id LIMIT $2 OFFSET $3`,
        [search, query.limit, offset],
      ),
      this.database.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM users WHERE email ILIKE $1',
        [search],
      ),
    ]);
    return {
      items: items.rows,
      total: count.rows[0].total,
      page: query.page,
      limit: query.limit,
    };
  }
}
