import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { PaginationDto } from '../common/pagination.js';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import { FirebaseModule } from '../firebase/firebase.module.js';
import { UsersModule, UsersService } from '../users/users.module.js';
import { NotificationDto, PreviewDto } from './notifications.dto.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsWorker } from './notifications.worker.js';
import { validatePayload, validateTarget } from './validation.js';

@Roles('admin')
@Controller('admin/notifications')
class NotificationsController {
  constructor(
    @Inject(NotificationsRepository)
    private readonly repository: NotificationsRepository,
    @Inject(NotificationsWorker) private readonly worker: NotificationsWorker,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('preview')
  preview(@Body() dto: PreviewDto) {
    return this.repository.preview(validateTarget(dto.target));
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(
    @CurrentUser() principal: Principal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: NotificationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!key || key.length > 128 || !/^[\x21-\x7e]+$/.test(key))
      throw new UnprocessableEntityException(
        'A valid Idempotency-Key header is required',
      );
    const target = validateTarget(dto.target);
    const payload = validatePayload(dto, this.config.nodeEnv === 'development');
    const user = await this.users.ensure(principal);
    const result = await this.repository.create(user.id, key, target, payload);
    if (!result.replay) this.worker.enqueue(result.notification.id);
    response.status(result.replay ? 200 : 202);
    return result.notification;
  }
  @Get() history(@Query() query: PaginationDto) {
    return this.repository.history(query.page, query.limit);
  }
  @Get(':id') detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.repository.detail(id);
  }
}

@Module({
  imports: [UsersModule, FirebaseModule],
  controllers: [NotificationsController],
  providers: [NotificationsRepository, NotificationsWorker],
})
export class NotificationsModule {}
