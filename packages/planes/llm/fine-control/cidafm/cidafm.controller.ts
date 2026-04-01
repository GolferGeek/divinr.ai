import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Public } from '@/auth/decorators/public.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { CIDAFMService } from './cidafm.service';
import { CIDAFMCommandResponseDto } from '../dto/llm-evaluation.dto';

@ApiTags('CIDAFM Commands')
@Controller('cidafm')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CIDAFMController {
  constructor(private readonly cidafmService: CIDAFMService) {}

  @Get('commands')
  @Public()
  @ApiOperation({ summary: 'Get all available CIDAFM commands' })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['^', '&', '!'],
    description: 'Filter by command type',
  })
  @ApiQuery({
    name: 'builtin_only',
    required: false,
    type: Boolean,
    description: 'Show only built-in commands',
  })
  @ApiQuery({
    name: 'include_user_commands',
    required: false,
    type: Boolean,
    description: 'Include user custom commands',
  })
  @ApiResponse({
    status: 200,
    description: 'List of CIDAFM commands',
    type: [CIDAFMCommandResponseDto],
  })
  async getCommands(
    @CurrentUser() user?: Record<string, unknown>,
    @Query('type') type?: '^' | '&' | '!',
    @Query('builtin_only') builtinOnly?: boolean,
    @Query('include_user_commands') includeUserCommands?: boolean,
  ): Promise<CIDAFMCommandResponseDto[]> {
    // For public access, use empty string for user ID to get only builtin commands
    const userId = (user?.id as string | undefined) || '';
    return this.cidafmService.findAllCommands(userId, {
      type,
      builtinOnly: builtinOnly ?? true, // Default to builtin only for public access
      includeUserCommands: includeUserCommands ?? false, // Don't include user commands for public access
    });
  }

  @Get('commands/by-type/:type')
  @ApiOperation({ summary: 'Get CIDAFM commands by type' })
  @ApiParam({
    name: 'type',
    enum: ['^', '&', '!'],
    description: 'Command type: ^ (response), & (state), ! (execution)',
  })
  @ApiResponse({
    status: 200,
    description: 'Commands of the specified type',
    type: [CIDAFMCommandResponseDto],
  })
  async getCommandsByType(
    @CurrentUser() user: { userId: string },
    @Param('type') type: '^' | '&' | '!',
  ): Promise<CIDAFMCommandResponseDto[]> {
    return this.cidafmService.findAllCommands(user.userId, { type });
  }

  @Get('commands/:id')
  @ApiOperation({ summary: 'Get a specific CIDAFM command by ID' })
  @ApiParam({ name: 'id', description: 'Command UUID' })
  @ApiResponse({
    status: 200,
    description: 'Command details',
    type: CIDAFMCommandResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Command not found' })
  async getCommand(@Param('id') id: string): Promise<CIDAFMCommandResponseDto> {
    const command = await this.cidafmService.findCommandById(id);
    if (!command) {
      throw new HttpException('Command not found', HttpStatus.NOT_FOUND);
    }
    return command;
  }

  @Post('commands')
  @ApiOperation({ summary: 'Create a custom CIDAFM command' })
  @ApiResponse({
    status: 201,
    description: 'Custom command created successfully',
    type: CIDAFMCommandResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({
    status: 409,
    description: 'Command name already exists for user',
  })
  async createUserCommand(
    @CurrentUser() user: { userId: string },
    @Body() createCommandDto: { commandId: string },
  ): Promise<CIDAFMCommandResponseDto> {
    return this.cidafmService.addUserCommand(
      user.userId,
      createCommandDto.commandId,
    );
  }

  @Put('commands/:id')
  @ApiOperation({ summary: 'Update a custom CIDAFM command' })
  @ApiParam({ name: 'id', description: 'Command UUID' })
  @ApiResponse({
    status: 200,
    description: 'Command updated successfully',
    type: CIDAFMCommandResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Command not found' })
  @ApiResponse({ status: 403, description: 'Cannot modify built-in commands' })
  async updateUserCommand(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() updateCommandDto: { isActive: boolean },
  ): Promise<CIDAFMCommandResponseDto> {
    const command = await this.cidafmService.updateUserCommand(
      user.userId,
      id,
      updateCommandDto.isActive,
    );
    if (!command) {
      throw new HttpException('Command not found', HttpStatus.NOT_FOUND);
    }
    return command;
  }

  @Delete('commands/:id')
  @ApiOperation({ summary: 'Delete a custom CIDAFM command' })
  @ApiParam({ name: 'id', description: 'Command UUID' })
  @ApiResponse({ status: 200, description: 'Command deleted successfully' })
  @ApiResponse({ status: 404, description: 'Command not found' })
  @ApiResponse({ status: 403, description: 'Cannot delete built-in commands' })
  async deleteUserCommand(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    const deleted = await this.cidafmService.deleteUserCommand(user.userId, id);
    if (!deleted) {
      throw new HttpException('Command not found', HttpStatus.NOT_FOUND);
    }
    return { message: 'Command deleted successfully' };
  }

  @Post('process')
  @ApiOperation({ summary: 'Process CIDAFM commands in a message' })
  @ApiResponse({
    status: 200,
    description: 'CIDAFM processing result',
    schema: {
      type: 'object',
      properties: {
        modifiedPrompt: { type: 'string' },
        activeStateModifiers: { type: 'array', items: { type: 'string' } },
        executedCommands: { type: 'array', items: { type: 'string' } },
        processingNotes: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async processCommands(
    @CurrentUser() user: { userId: string },
    @Body()
    body: {
      message: string;
      current_state?: Record<string, unknown>;
      session_id?: string;
    },
  ): Promise<{
    modifiedPrompt: string;
    activeStateModifiers: string[];
    executedCommands: string[];
    processingNotes: string[];
  }> {
    return this.cidafmService.processMessage(
      user.userId,
      body.message,
      body.current_state,
      body.session_id,
    );
  }

  @Get('state/:sessionId')
  @ApiOperation({ summary: 'Get current CIDAFM state for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session UUID' })
  @ApiResponse({
    status: 200,
    description: 'Current CIDAFM state',
    schema: {
      type: 'object',
      properties: {
        activeStateModifiers: { type: 'array', items: { type: 'string' } },
        session_state: { type: 'object' },
        available_commands: {
          type: 'array',
          items: { $ref: '#/components/schemas/CIDAFMCommandResponseDto' },
        },
      },
    },
  })
  async getSessionState(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
  ): Promise<{
    activeStateModifiers: string[];
    session_state: Record<string, unknown>;
    available_commands: CIDAFMCommandResponseDto[];
  }> {
    return this.cidafmService.getSessionState(user.userId, sessionId);
  }

  @Post('state/:sessionId/reset')
  @ApiOperation({ summary: 'Reset CIDAFM state for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session UUID' })
  @ApiResponse({
    status: 200,
    description: 'State reset successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        reset_state: { type: 'object' },
      },
    },
  })
  async resetSessionState(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
  ): Promise<{
    message: string;
    reset_state: Record<string, unknown>;
  }> {
    return this.cidafmService.resetSessionState(user.userId, sessionId);
  }

  @Get('help')
  @ApiOperation({ summary: 'Get CIDAFM help and documentation' })
  @ApiResponse({
    status: 200,
    description: 'CIDAFM help documentation',
    schema: {
      type: 'object',
      properties: {
        overview: { type: 'string' },
        command_types: { type: 'object' },
        examples: { type: 'array' },
        built_in_commands: { type: 'array' },
      },
    },
  })
  async getHelp(): Promise<{
    overview: string;
    command_types: Record<string, string>;
    examples: Array<{ command: string; description: string; example: string }>;
    built_in_commands: Array<{
      type: string;
      name: string;
      description: string;
    }>;
  }> {
    return this.cidafmService.getHelp();
  }
}
