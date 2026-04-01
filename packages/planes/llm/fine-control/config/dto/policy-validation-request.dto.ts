import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { SovereignModeType, AuditLevel } from './sovereign-policy.dto';

export class PolicyValidationRequestDto {
  @IsOptional()
  @IsBoolean()
  enforced?: boolean;

  @IsOptional()
  @IsEnum(SovereignModeType)
  defaultMode?: SovereignModeType;

  @IsOptional()
  @IsBoolean()
  userSovereignMode?: boolean;

  @IsOptional()
  @IsEnum(AuditLevel)
  auditLevel?: AuditLevel;
}
