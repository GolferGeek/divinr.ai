import {
  Injectable,
  Inject,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';
import { CIDAFMCommandResponseDto } from '../dto/llm-evaluation.dto';
import { CIDAFMCommandType } from '../types/llm-evaluation';

interface CommandFilters {
  type?: CIDAFMCommandType;
  builtinOnly?: boolean;
  includeUserCommands?: boolean;
}

@Injectable()
export class CIDAFMService {
  private readonly logger = new Logger(CIDAFMService.name);

  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {}

  async findAllCommands(
    userId: string,
    filters: CommandFilters = {},
  ): Promise<CIDAFMCommandResponseDto[]> {
    // Get built-in commands
    let builtinQuery = this.db
      .from(null, 'cidafm_commands')
      .select('*')
      .eq('is_builtin', true)
      .order('type')
      .order('name');

    if (filters.type) {
      builtinQuery = builtinQuery.eq('type', filters.type);
    }

    const { data: builtinCommands, error: builtinError } =
      (await builtinQuery) as QueryResult<unknown>;

    if (builtinError) {
      throw new HttpException(
        `Failed to fetch built-in commands: ${builtinError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const builtinCmds = builtinCommands as CIDAFMCommandResponseDto[] | null;
    let allCommands: CIDAFMCommandResponseDto[] = [...(builtinCmds || [])];

    // Get user commands if requested (skip if userId is 'system' or not a valid UUID)
    if (
      !filters.builtinOnly &&
      filters.includeUserCommands !== false &&
      userId &&
      userId !== 'system'
    ) {
      // Validate UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) {
        // Invalid UUID format, skip user commands
        return allCommands;
      } else {
        // First check if user has any commands
        const { data: userCommandIds } = (await this.db
          .from(null, 'user_cidafm_commands')
          .select('command_id')
          .eq('user_id', userId)
          .eq('is_active', true)) as QueryResult<unknown>;

        const typedUserCommandIds = userCommandIds as Array<{
          command_id: string;
        }> | null;
        if (!typedUserCommandIds || typedUserCommandIds.length === 0) {
          return []; // User has no commands
        }

        // Get the actual command details
        const commandIds = typedUserCommandIds.map((uc) => uc.command_id);
        let commandQuery = this.db
          .from(null, 'cidafm_commands')
          .select('*')
          .in('id', commandIds)
          .order('type')
          .order('name');

        if (filters.type) {
          commandQuery = commandQuery.eq('type', filters.type);
        }

        const { data: userCommands, error: userError } =
          (await commandQuery) as QueryResult<unknown>;

        if (userError) {
          throw new HttpException(
            `Failed to fetch user commands: ${userError.message}`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }

        // Transform user commands to match built-in command structure
        const transformedUserCommands = (
          (userCommands || []) as Array<Record<string, unknown>>
        ).map(
          (cmd: Record<string, unknown>) =>
            ({
              ...cmd,
              default_active: false,
              is_builtin: false,
            }) as unknown as CIDAFMCommandResponseDto,
        );

        allCommands = [...allCommands, ...transformedUserCommands];
      }
    }

    return allCommands;
  }

  async findCommandById(id: string): Promise<CIDAFMCommandResponseDto | null> {
    // Try built-in commands first
    const { data: builtinCommand } = (await this.db
      .from(null, 'cidafm_commands')
      .select('*')
      .eq('id', id)
      .single()) as { data: CIDAFMCommandResponseDto | null };

    if (builtinCommand) {
      return builtinCommand;
    }

    // If not found in built-in, try regular commands
    const { data: userCommand } = (await this.db
      .from(null, 'cidafm_commands')
      .select('*')
      .eq('id', id)
      .single()) as { data: CIDAFMCommandResponseDto | null };

    if (userCommand) {
      return {
        ...(userCommand as unknown as Record<string, unknown>),
        default_active: false,
        is_builtin: false,
      } as unknown as CIDAFMCommandResponseDto;
    }

    return null;
  }

  async addUserCommand(
    userId: string,
    commandId: string,
  ): Promise<CIDAFMCommandResponseDto> {
    // Check if the command exists in the catalog
    const { data: command } = (await this.db
      .from(null, 'cidafm_commands')
      .select('*')
      .eq('id', commandId)
      .single()) as { data: CIDAFMCommandResponseDto | null };

    if (!command) {
      throw new HttpException(
        'Command not found in catalog',
        HttpStatus.NOT_FOUND,
      );
    }

    // Check if user already has this command
    const { data: existingUserCommand } = (await this.db
      .from(null, 'user_cidafm_commands')
      .select('id')
      .eq('user_id', userId)
      .eq('command_id', commandId)
      .single()) as QueryResult<unknown>;

    if (existingUserCommand) {
      throw new HttpException(
        'User already has this command in their list',
        HttpStatus.CONFLICT,
      );
    }

    // Add the command to user's list
    const { error: linkError } = (await this.db
      .from(null, 'user_cidafm_commands')
      .insert({
        user_id: userId,
        command_id: commandId,
        is_active: true,
      })) as QueryResult<unknown>;

    if (linkError) {
      throw new HttpException(
        `Failed to add command to user list: ${linkError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      ...(command as unknown as Record<string, unknown>),
      default_active: false,
    } as unknown as CIDAFMCommandResponseDto;
  }

  async updateUserCommand(
    userId: string,
    commandId: string,
    isActive: boolean,
  ): Promise<CIDAFMCommandResponseDto | null> {
    // Check if user has this command and update its active status
    const { data: userCommand, error } = (await this.db
      .from(null, 'user_cidafm_commands')
      .update({ is_active: isActive })
      .eq('command_id', commandId)
      .eq('user_id', userId)
      .select(
        `
        *,
        cidafm_commands (
          id,
          name,
          type,
          description,
          default_active,
          is_builtin
        )
      `,
      )
      .single()) as {
      data: { cidafm_commands: Record<string, unknown> } | null;
      error: unknown;
    };

    if (error || !userCommand) {
      return null; // User doesn't have this command
    }

    const userCommandTyped = userCommand as {
      cidafm_commands: Record<string, unknown>;
    };
    return {
      ...userCommandTyped.cidafm_commands,
      default_active: false,
    } as unknown as CIDAFMCommandResponseDto;
  }

  async deleteUserCommand(userId: string, commandId: string): Promise<boolean> {
    const { error } = (await this.db
      .from(null, 'user_cidafm_commands')
      .delete()
      .eq('id', commandId)
      .eq('user_id', userId)) as QueryResult<unknown>;

    if (error) {
      if (error.code === 'PGRST116') {
        return false; // Not found
      }
      throw new HttpException(
        `Failed to delete user command: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return true;
  }

  async processMessage(
    userId: string,
    message: string,
    currentState?: Record<string, unknown>,
    _sessionId?: string,
  ): Promise<{
    modifiedPrompt: string;
    activeStateModifiers: string[];
    executedCommands: string[];
    processingNotes: string[];
  }> {
    const commands = await this.findAllCommands(userId, {
      includeUserCommands: true,
    });

    // Initialize state
    const state = currentState || { active_state_modifiers: [] };
    const executedCommands: string[] = [];
    const processingNotes: string[] = [];
    let modifiedPrompt = message;

    // Parse CIDAFM commands from the message
    const commandPattern = /([^&!]|^)([&^!])([a-zA-Z0-9_-]+)/g;
    const foundCommands: Array<{ type: string; name: string; full: string }> =
      [];

    let match;
    while ((match = commandPattern.exec(message)) !== null) {
      foundCommands.push({
        type: match[2] || '',
        name: match[3] || '',
        full: match[0].trim(),
      });
    }

    // Process each command
    for (const foundCommand of foundCommands) {
      const command = commands.find(
        (cmd) =>
          cmd.type === foundCommand.type && cmd.name === foundCommand.name,
      );

      if (!command) {
        processingNotes.push(`Unknown command: ${foundCommand.full}`);
        continue;
      }

      switch (foundCommand.type) {
        case '^': // Response modifier
          processingNotes.push(
            `Applied response modifier: ${foundCommand.name}`,
          );
          // Remove the command from the prompt
          modifiedPrompt = modifiedPrompt.replace(foundCommand.full, '').trim();
          break;

        case '&': {
          // State modifier
          const isActive = (state.active_state_modifiers as string[]).includes(
            foundCommand.name,
          );
          if (isActive) {
            // Toggle off
            state.active_state_modifiers = (
              state.active_state_modifiers as string[]
            ).filter((mod: string) => mod !== foundCommand.name);
            processingNotes.push(
              `Disabled state modifier: ${foundCommand.name}`,
            );
          } else {
            // Toggle on
            (state.active_state_modifiers as string[]).push(foundCommand.name);
            processingNotes.push(
              `Enabled state modifier: ${foundCommand.name}`,
            );
          }
          // Remove the command from the prompt
          modifiedPrompt = modifiedPrompt.replace(foundCommand.full, '').trim();
          break;
        }

        case '!': // Execution command
          executedCommands.push(foundCommand.name);
          processingNotes.push(`Executed command: ${foundCommand.name}`);
          // Handle specific execution commands
          this.handleExecutionCommand(
            foundCommand.name,
            state,
            processingNotes,
          );
          // Remove the command from the prompt
          modifiedPrompt = modifiedPrompt.replace(foundCommand.full, '').trim();
          break;
      }
    }

    // Apply state modifiers to the prompt
    modifiedPrompt = this.applyStateModifiers(
      modifiedPrompt,
      (state.active_state_modifiers as string[] | undefined) || [],
      commands,
    );

    return {
      modifiedPrompt: modifiedPrompt,
      activeStateModifiers:
        (state.active_state_modifiers as string[] | undefined) || [],
      executedCommands: executedCommands,
      processingNotes: processingNotes,
    };
  }

  async getSessionState(
    userId: string,
    sessionId: string,
  ): Promise<{
    activeStateModifiers: string[];
    session_state: Record<string, unknown>;
    available_commands: CIDAFMCommandResponseDto[];
  }> {
    // Get session state from the last message with CIDAFM options
    const { data: lastMessage } = (await this.db
      .from(null, 'messages')
      .select('cidafm_options')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .not('cidafm_options', 'is', null)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single()) as QueryResult<unknown>;

    const state = ((lastMessage as Record<string, unknown> | null)
      ?.cidafm_options as
      | { active_state_modifiers?: string[] }
      | undefined) || { active_state_modifiers: [] };
    const commands = await this.findAllCommands(userId, {
      includeUserCommands: true,
    });

    return {
      activeStateModifiers:
        ((state as Record<string, unknown>).active_state_modifiers as
          | string[]
          | undefined) || [],
      session_state: state as Record<string, unknown>,
      available_commands: commands,
    };
  }

  resetSessionState(
    _userId: string,
    _sessionId: string,
  ): Promise<{
    message: string;
    reset_state: Record<string, unknown>;
  }> {
    const resetState = {
      activeStateModifiers: ['token-efficient'], // Default state
      custom_options: {},
    };

    return Promise.resolve({
      message: 'Session state reset successfully',
      reset_state: resetState,
    });
  }

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
    const commands = await this.findAllCommands('', { builtinOnly: true });

    return {
      overview:
        'CIDAFM (Context Import Document + AI Function Module) is a protocol for modifying AI behavior through structured commands.',
      command_types: {
        '^': 'Response Modifiers - Apply only to the current response',
        '&': 'State Modifiers - Persistent until toggled off',
        '!': 'Execution Commands - Single-use functions that execute immediately',
      },
      examples: [
        {
          command: '^concise',
          description: 'Make only the current response concise',
          example: '^concise Explain quantum computing',
        },
        {
          command: '&disciplined',
          description: 'Enable disciplined mode for all future responses',
          example: '&disciplined (toggles on/off)',
        },
        {
          command: '!state-check',
          description: 'Show current active state modifiers',
          example: '!state-check',
        },
      ],
      built_in_commands: commands.map((cmd) => ({
        type: cmd.type,
        name: cmd.name,
        description: cmd.description || '',
      })),
    };
  }

  private handleExecutionCommand(
    commandName: string,
    state: Record<string, unknown>,
    processingNotes: string[],
  ): void {
    switch (commandName) {
      case 'state-check':
        processingNotes.push(
          `Active state modifiers: ${(state.active_state_modifiers as string[] | undefined)?.join(', ') || 'none'}`,
        );
        break;
      case 'export-context':
        processingNotes.push(
          'Context export requested - provide session summary',
        );
        break;
      case 'step-by-step':
        processingNotes.push(
          'Step-by-step mode activated - break response into steps',
        );
        break;
      default:
        processingNotes.push(`Execution command '${commandName}' processed`);
    }
  }

  private applyStateModifiers(
    prompt: string,
    activeModifiers: string[],
    commands: CIDAFMCommandResponseDto[],
  ): string {
    let modifiedPrompt = prompt;

    // Ensure activeModifiers is an array
    const modifiersArray = Array.isArray(activeModifiers)
      ? activeModifiers
      : [];

    for (const modifierName of modifiersArray) {
      const command = commands.find(
        (cmd) => cmd.type === '&' && cmd.name === modifierName,
      );

      if (command && command.description) {
        // Add the modifier instruction to the prompt
        modifiedPrompt = `[CIDAFM &${modifierName}: ${command.description}]\n\n${modifiedPrompt}`;
      }
    }

    return modifiedPrompt;
  }
}
