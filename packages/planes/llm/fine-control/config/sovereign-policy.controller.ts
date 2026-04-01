import {
  Controller,
  Get,
  Post,
  Body,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  SovereignPolicyService,
  SovereignPolicy,
} from './sovereign-policy.service';
import {
  SovereignPolicyDto,
  SovereignPolicyStatusDto,
  PolicyValidationResponseDto,
  ApiErrorResponseDto,
} from './dto/sovereign-policy.dto';
import { PolicyValidationRequestDto } from './dto/policy-validation-request.dto';

@ApiTags('sovereign-policy')
@Controller('api/sovereign-policy')
export class SovereignPolicyController {
  private readonly logger = new Logger(SovereignPolicyController.name);

  constructor(
    private readonly sovereignPolicyService: SovereignPolicyService,
  ) {}

  /**
   * Get the current sovereign mode policy
   * GET /api/sovereign-policy
   */
  @Get()
  @ApiOperation({
    summary: 'Get current sovereign mode policy',
    description:
      'Returns the current sovereign mode policy configuration including validation status',
  })
  @ApiResponse({
    status: 200,
    description: 'Current sovereign mode policy',
    type: SovereignPolicyDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
    type: ApiErrorResponseDto,
  })
  getPolicy(): SovereignPolicy & {
    validation: { valid: boolean; warnings: string[] };
  } {
    this.logger.debug('Fetching sovereign mode policy');

    const policy = this.sovereignPolicyService.getPolicy();
    const validation = this.sovereignPolicyService.validatePolicy();

    return {
      ...policy,
      validation,
    };
  }

  /**
   * Get sovereign mode status (simplified endpoint)
   * GET /api/sovereign-policy/status
   */
  @Get('status')
  @ApiOperation({
    summary: 'Get sovereign mode status',
    description:
      'Returns simplified sovereign mode status including allowed providers',
  })
  @ApiResponse({
    status: 200,
    description: 'Sovereign mode status',
    type: SovereignPolicyStatusDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
    type: ApiErrorResponseDto,
  })
  getStatus(): {
    enforced: boolean;
    defaultMode: string;
    allowedProviders: string[];
  } {
    const policy = this.sovereignPolicyService.getPolicy();

    return {
      enforced: policy.enforced,
      defaultMode: policy.defaultMode,
      allowedProviders: policy.enforced
        ? ['ollama']
        : ['ollama', 'openai', 'anthropic'],
    };
  }

  /**
   * Validate sovereign mode policy configuration
   * POST /api/sovereign-policy/validate
   */
  @Post('validate')
  @ApiOperation({
    summary: 'Validate policy configuration',
    description:
      'Validates sovereign mode policy configuration and returns effective settings based on precedence rules',
  })
  @ApiResponse({
    status: 200,
    description: 'Policy validation result',
    type: PolicyValidationResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
    type: ApiErrorResponseDto,
  })
  validatePolicy(
    @Body() request: PolicyValidationRequestDto,
  ): PolicyValidationResponseDto {
    this.logger.debug('Validating policy configuration', request);

    try {
      // Get current organization policy
      const orgPolicy = this.sovereignPolicyService.getPolicy();
      const orgValidation = this.sovereignPolicyService.validatePolicy();

      // Apply precedence rules: Organization enforced > User preference > Default
      const effectiveEnforced = request.enforced ?? orgPolicy.enforced;
      const effectiveUserMode = request.userSovereignMode ?? false;
      const effectiveSovereignMode = effectiveEnforced || effectiveUserMode;

      // Collect warnings and errors
      const warnings: string[] = [...orgValidation.warnings];
      const errors: string[] = [];

      // Validate precedence logic
      let precedenceExplanation = '';
      if (effectiveEnforced && !effectiveUserMode) {
        precedenceExplanation =
          'Organization enforcement takes precedence over user preference';
      } else if (effectiveEnforced && effectiveUserMode) {
        precedenceExplanation =
          'Organization enforcement and user preference both enable sovereign mode';
      } else if (!effectiveEnforced && effectiveUserMode) {
        precedenceExplanation =
          'User preference enables sovereign mode (organization allows user choice)';
      } else {
        precedenceExplanation =
          'Sovereign mode disabled (neither organization nor user enables it)';
      }

      // Additional validation warnings
      if (
        request.enforced === true &&
        String(request.defaultMode) === 'relaxed'
      ) {
        warnings.push('Enforced mode with relaxed default may cause confusion');
      }

      if (request.enforced === true && String(request.auditLevel) === 'none') {
        warnings.push(
          'Enforced mode should have audit logging enabled for compliance',
        );
      }

      return {
        valid: errors.length === 0,
        effectiveSovereignMode,
        warnings,
        errors,
        precedenceExplanation,
      };
    } catch (error) {
      this.logger.error('Error validating policy configuration', error);
      throw new HttpException(
        'Failed to validate policy configuration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
