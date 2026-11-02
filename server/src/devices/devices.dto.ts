import { IsIn, IsString, Length, Matches } from 'class-validator';
export class DeviceDto {
  @IsString() @Length(1, 4096) @Matches(/^\S+$/u) token!: string;
  @IsIn(['web', 'android']) platform!: 'web' | 'android';
}
export class DeleteDeviceDto {
  @IsString() @Length(1, 4096) @Matches(/^\S+$/u) token!: string;
}
