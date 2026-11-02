import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { UsersRepository } from './users.repository.js';
import { AdminUsersController } from './admin-users.controller.js';
@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersRepository) private readonly users: UsersRepository,
  ) {}
  ensure(principal: Principal, updateLogin = false) {
    return this.users.upsert(principal, updateLogin);
  }
}
@Controller()
class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}
  @Get('me') me(@CurrentUser() principal: Principal) {
    return this.users.ensure(principal, true);
  }
}
@Module({
  controllers: [UsersController, AdminUsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
