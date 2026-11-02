import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Post,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { UsersModule, UsersService } from '../users/users.module.js';
import { DeleteDeviceDto, DeviceDto } from './devices.dto.js';
import { DevicesRepository } from './devices.repository.js';

@Injectable()
class DevicesService {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(DevicesRepository) private readonly devices: DevicesRepository,
  ) {}
  async register(principal: Principal, dto: DeviceDto, userAgent?: string) {
    const user = await this.users.ensure(principal);
    await this.devices.register(user.id, dto, userAgent);
    return { registered: true };
  }
  async deactivate(principal: Principal, dto: DeleteDeviceDto) {
    const user = await this.users.ensure(principal);
    await this.devices.deactivate(user.id, dto.token);
  }
  @Cron('0 0 * * *') async cleanStale() {
    await this.devices.deactivateStale();
  }
}
@Controller('devices')
class DevicesController {
  constructor(
    @Inject(DevicesService) private readonly devices: DevicesService,
  ) {}
  @Post() register(
    @CurrentUser() user: Principal,
    @Body() dto: DeviceDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.devices.register(user, dto, userAgent);
  }
  @Delete() @HttpCode(204) deactivate(
    @CurrentUser() user: Principal,
    @Body() dto: DeleteDeviceDto,
  ) {
    return this.devices.deactivate(user, dto);
  }
}
@Module({
  imports: [UsersModule],
  controllers: [DevicesController],
  providers: [DevicesService, DevicesRepository],
})
export class DevicesModule {}
