import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class TargetDto {
  @IsIn(['all', 'users', 'platform']) type!: 'all' | 'users' | 'platform';
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  userIds?: string[];
  @IsOptional() @IsIn(['web', 'android']) platform?: 'web' | 'android';
}
export class PreviewDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => TargetDto)
  target!: TargetDto;
}
export class NotificationDto extends PreviewDto {
  @Transform(trim) @IsString() @Length(1, 100) title!: string;
  @Transform(trim) @IsString() @Length(1, 500) body!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2048) imageUrl?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2048)
  clickAction?: string;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
}
