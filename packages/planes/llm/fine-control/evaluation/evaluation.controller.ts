import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
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
import { SupabaseAuthUserDto } from '@/auth/dto/auth.dto';
import { RequirePermission } from '@/rbac/decorators/require-permission.decorator';
import { EvaluationService } from './evaluation.service';
import {
  MessageEvaluationDto,
  EnhancedMessageResponseDto,
} from '../dto/llm-evaluation.dto';
import {
  AdminEvaluationFiltersDto,
  EvaluationAnalyticsDto,
  EnhancedEvaluationMetadataDto,
  AgentLLMRecommendationDto,
} from '../dto/enhanced-evaluation.dto';

@ApiTags('Message Evaluation')
@Controller('evaluation')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Post('messages/:messageId')
  @ApiOperation({ summary: 'Submit evaluation for a message' })
  @ApiParam({ name: 'messageId', description: 'Message UUID' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation submitted successfully',
    type: EnhancedMessageResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Message not found' })
  @ApiResponse({
    status: 403,
    description: 'Not authorized to evaluate this message',
  })
  async evaluateMessage(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Param('messageId') messageId: string,
    @Body() evaluationDto: MessageEvaluationDto,
  ): Promise<EnhancedMessageResponseDto> {
    const result = await this.evaluationService.evaluateMessage(
      user.id,
      messageId,
      evaluationDto,
    );
    if (!result) {
      throw new HttpException('Message not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Get('messages/:messageId')
  @ApiOperation({ summary: 'Get evaluation for a specific message' })
  @ApiParam({ name: 'messageId', description: 'Message UUID' })
  @ApiResponse({
    status: 200,
    description: 'Message evaluation details',
    type: EnhancedMessageResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async getMessageEvaluation(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Param('messageId') messageId: string,
  ): Promise<EnhancedMessageResponseDto> {
    const message = await this.evaluationService.getMessageWithEvaluation(
      user.id,
      messageId,
    );
    if (!message) {
      throw new HttpException('Message not found', HttpStatus.NOT_FOUND);
    }
    return message;
  }

  @Get('sessions/:sessionId/messages')
  @ApiOperation({ summary: 'Get all evaluated messages in a session' })
  @ApiParam({ name: 'sessionId', description: 'Session UUID' })
  @ApiQuery({
    name: 'min_rating',
    required: false,
    type: Number,
    description: 'Filter by minimum user rating (1-5)',
  })
  @ApiQuery({
    name: 'has_notes',
    required: false,
    type: Boolean,
    description: 'Filter messages with user notes',
  })
  @ApiResponse({
    status: 200,
    description: 'List of evaluated messages in session',
    type: [EnhancedMessageResponseDto],
  })
  async getSessionEvaluations(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Param('sessionId') sessionId: string,
    @Query('min_rating') minRating?: number,
    @Query('has_notes') hasNotes?: boolean,
  ): Promise<EnhancedMessageResponseDto[]> {
    return this.evaluationService.getSessionEvaluations(user.id, sessionId, {
      minRating,
      hasNotes,
    });
  }

  @Get('agents/:agentIdentifier/llm-recommendations')
  @ApiOperation({
    summary:
      'Get recommended LLM models for an agent based on user evaluations',
  })
  @ApiParam({
    name: 'agentIdentifier',
    description: 'Agent identifier or name',
  })
  @ApiQuery({
    name: 'minRating',
    required: false,
    type: Number,
    description: 'Minimum average rating (default: 3)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of recommended models for the agent',
    type: [AgentLLMRecommendationDto],
  })
  async getAgentLLMRecommendations(
    @Param('agentIdentifier') agentIdentifier: string,
    @Query('minRating') minRating?: string,
  ): Promise<AgentLLMRecommendationDto[]> {
    const parsedMinRating = minRating !== undefined ? Number(minRating) : 3;
    return this.evaluationService.getAgentLLMRecommendations(
      agentIdentifier,
      Number.isFinite(parsedMinRating) ? parsedMinRating : 3,
    );
  }

  @Get('user/all')
  @ApiOperation({ summary: 'Get all evaluations for the current user' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiQuery({
    name: 'minRating',
    required: false,
    type: Number,
    description: 'Filter by minimum user rating (1-5)',
  })
  @ApiQuery({
    name: 'hasNotes',
    required: false,
    type: Boolean,
    description: 'Filter evaluations with user notes',
  })
  @ApiQuery({
    name: 'agentName',
    required: false,
    type: String,
    description: 'Filter by agent name',
  })
  @ApiResponse({
    status: 200,
    description: 'List of all user evaluations with pagination',
    schema: {
      type: 'object',
      properties: {
        evaluations: {
          type: 'array',
          items: { $ref: '#/components/schemas/EnhancedMessageResponseDto' },
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  async getAllUserEvaluations(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('minRating') minRating?: number,
    @Query('hasNotes') hasNotes?: boolean,
    @Query('agentName') agentName?: string,
  ): Promise<{
    evaluations: EnhancedMessageResponseDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    // Ensure reasonable pagination limits
    const sanitizedLimit = Math.min(Math.max(limit, 1), 100);
    const sanitizedPage = Math.max(page, 1);

    return this.evaluationService.getAllUserEvaluations(user.id, {
      page: sanitizedPage,
      limit: sanitizedLimit,
      minRating,
      hasNotes,
      agentName,
    });
  }

  @Get('stats/summary')
  @ApiOperation({ summary: 'Get evaluation statistics summary for user' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'providerId',
    required: false,
    description: 'Filter by provider UUID',
  })
  @ApiQuery({
    name: 'modelId',
    required: false,
    description: 'Filter by model UUID',
  })
  @ApiResponse({
    status: 200,
    description: 'Evaluation statistics summary',
    schema: {
      type: 'object',
      properties: {
        totalEvaluations: { type: 'number' },
        averageOverallRating: { type: 'number' },
        averageSpeedRating: { type: 'number' },
        averageAccuracyRating: { type: 'number' },
        evaluationDistribution: {
          type: 'object',
          properties: {
            '1': { type: 'number' },
            '2': { type: 'number' },
            '3': { type: 'number' },
            '4': { type: 'number' },
            '5': { type: 'number' },
          },
        },
        modelPerformance: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              model: { $ref: '#/components/schemas/ModelResponseDto' },
              avgRating: { type: 'number' },
              evaluationCount: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async getEvaluationStats(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('providerId') providerId?: string,
    @Query('modelId') modelId?: string,
  ): Promise<{
    totalEvaluations: number;
    averageOverallRating: number;
    averageSpeedRating: number;
    averageAccuracyRating: number;
    evaluationDistribution: Record<string, number>;
    modelPerformance: Array<{
      model: string;
      avgRating: number;
      evaluationCount: number;
    }>;
  }> {
    return this.evaluationService.getEvaluationStats(user.id, {
      startDate,
      endDate,
      providerId,
      modelId,
    });
  }

  @Get('feedback/export')
  @ApiOperation({ summary: 'Export user feedback and evaluations' })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['json', 'csv'],
    description: 'Export format',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'includeContent',
    required: false,
    type: Boolean,
    description: 'Include message content in export',
  })
  @ApiResponse({
    status: 200,
    description: 'Exported evaluation data',
    schema: {
      oneOf: [
        {
          type: 'array',
          description: 'JSON format export',
        },
        {
          type: 'string',
          description: 'CSV format export',
        },
      ],
    },
  })
  async exportFeedback(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Query('format') format: 'json' | 'csv' = 'json',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('includeContent') includeContent?: boolean,
  ): Promise<Record<string, unknown>[] | string> {
    return this.evaluationService.exportUserFeedback(user.id, {
      format,
      startDate,
      endDate,
      includeContent,
    });
  }

  @Put('messages/:messageId')
  @ApiOperation({ summary: 'Update evaluation for a message' })
  @ApiParam({ name: 'messageId', description: 'Message UUID' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation updated successfully',
    type: EnhancedMessageResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Message not found' })
  @ApiResponse({
    status: 403,
    description: 'Not authorized to update this evaluation',
  })
  async updateMessageEvaluation(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Param('messageId') messageId: string,
    @Body() evaluationDto: MessageEvaluationDto,
  ): Promise<EnhancedMessageResponseDto> {
    const result = await this.evaluationService.updateMessageEvaluation(
      user.id,
      messageId,
      evaluationDto,
    );
    if (!result) {
      throw new HttpException('Message not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Get('insights/model-comparison')
  @ApiOperation({ summary: 'Get model performance comparison insights' })
  @ApiQuery({
    name: 'models',
    required: true,
    description: 'Comma-separated list of model UUIDs to compare',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date (YYYY-MM-DD)',
  })
  @ApiResponse({
    status: 200,
    description: 'Model comparison insights',
    schema: {
      type: 'object',
      properties: {
        comparison: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              model: { $ref: '#/components/schemas/ModelResponseDto' },
              metrics: {
                type: 'object',
                properties: {
                  avgOverallRating: { type: 'number' },
                  avgSpeedRating: { type: 'number' },
                  avgAccuracyRating: { type: 'number' },
                  avgResponseTimeMs: { type: 'number' },
                  avgCost: { type: 'number' },
                  evaluationCount: { type: 'number' },
                },
              },
            },
          },
        },
        recommendations: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  })
  async getModelComparison(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Query('models') models: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<{
    comparison: Array<{
      model: string;
      metrics: {
        avgOverallRating: number;
        avgSpeedRating: number;
        avgAccuracyRating: number;
        avgResponseTimeMs: number;
        avgCost: number;
        evaluationCount: number;
      };
    }>;
    recommendations: string[];
  }> {
    const modelIds = models.split(',').map((id) => id.trim());
    return this.evaluationService.compareModels(user.id, modelIds, {
      startDate,
      endDate,
    });
  }

  // Task Evaluation Endpoints
  @Post('tasks/:taskId')
  @ApiOperation({ summary: 'Submit evaluation for a task' })
  @ApiParam({ name: 'taskId', description: 'Task UUID' })
  @ApiResponse({
    status: 200,
    description: 'Task evaluation submitted successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        evaluation: {
          type: 'object',
          properties: {
            user_rating: { type: 'number' },
            speed_rating: { type: 'number' },
            accuracy_rating: { type: 'number' },
            user_notes: { type: 'string' },
            evaluation_timestamp: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({
    status: 403,
    description: 'Not authorized to evaluate this task',
  })
  async evaluateTask(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Param('taskId') taskId: string,
    @Body() evaluationDto: MessageEvaluationDto,
  ): Promise<unknown> {
    const result = (await this.evaluationService.evaluateTask(
      user.id,
      taskId,
      evaluationDto,
    )) as unknown;
    if (!result) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Get('tasks/:taskId')
  @ApiOperation({ summary: 'Get evaluation for a specific task' })
  @ApiParam({ name: 'taskId', description: 'Task UUID' })
  @ApiResponse({
    status: 200,
    description: 'Task evaluation details',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        evaluation: {
          type: 'object',
          properties: {
            user_rating: { type: 'number' },
            speed_rating: { type: 'number' },
            accuracy_rating: { type: 'number' },
            user_notes: { type: 'string' },
            evaluation_timestamp: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async getTaskEvaluation(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Param('taskId') taskId: string,
  ): Promise<unknown> {
    const task = (await this.evaluationService.getTaskWithEvaluation(
      user.id,
      taskId,
    )) as unknown;
    if (!task) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }
    return task;
  }

  @Put('tasks/:taskId')
  @ApiOperation({ summary: 'Update evaluation for a task' })
  @ApiParam({ name: 'taskId', description: 'Task UUID' })
  @ApiResponse({
    status: 200,
    description: 'Task evaluation updated successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        evaluation: {
          type: 'object',
          properties: {
            user_rating: { type: 'number' },
            speed_rating: { type: 'number' },
            accuracy_rating: { type: 'number' },
            user_notes: { type: 'string' },
            evaluation_timestamp: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({
    status: 403,
    description: 'Not authorized to update this task evaluation',
  })
  async updateTaskEvaluation(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Param('taskId') taskId: string,
    @Body() evaluationDto: MessageEvaluationDto,
  ): Promise<unknown> {
    const result = (await this.evaluationService.updateTaskEvaluation(
      user.id,
      taskId,
      evaluationDto,
    )) as unknown;
    if (!result) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Get('conversations/:conversationId/tasks')
  @ApiOperation({ summary: 'Get all evaluated tasks in a conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation UUID' })
  @ApiQuery({
    name: 'min_rating',
    required: false,
    type: Number,
    description: 'Filter by minimum user rating (1-5)',
  })
  @ApiQuery({
    name: 'has_notes',
    required: false,
    type: Boolean,
    description: 'Filter tasks with user notes',
  })
  @ApiResponse({
    status: 200,
    description: 'List of evaluated tasks in conversation',
    type: 'array',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          evaluation: {
            type: 'object',
            properties: {
              user_rating: { type: 'number' },
              speed_rating: { type: 'number' },
              accuracy_rating: { type: 'number' },
              user_notes: { type: 'string' },
              evaluation_timestamp: { type: 'string' },
            },
          },
        },
      },
    },
  })
  async getConversationTaskEvaluations(
    @CurrentUser() user: SupabaseAuthUserDto,
    @Param('conversationId') conversationId: string,
    @Query('min_rating') minRating?: number,
    @Query('has_notes') hasNotes?: boolean,
  ): Promise<Record<string, unknown>[]> {
    return this.evaluationService.getConversationTaskEvaluations(
      user.id,
      conversationId,
      {
        minRating,
        hasNotes,
      },
    );
  }

  // =========================
  // ADMIN EVALUATION ENDPOINTS
  // =========================

  @Get('admin/all')
  @UseGuards(JwtAuthGuard)
  @RequirePermission('admin:audit')
  @ApiOperation({
    summary: 'Get all evaluations across all users (Admin/Monitor only)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of all evaluations with enhanced metadata',
    type: [EnhancedEvaluationMetadataDto],
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getAllEvaluationsForAdmin(
    @Query() filters: AdminEvaluationFiltersDto,
  ): Promise<{
    evaluations: EnhancedEvaluationMetadataDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    return this.evaluationService.getAllEvaluationsForAdmin(filters);
  }

  @Get('admin/analytics/overview')
  @UseGuards(JwtAuthGuard)
  @RequirePermission('admin:audit')
  @ApiOperation({
    summary: 'Get comprehensive evaluation analytics (Admin only)',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date filter (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date filter (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'userRole',
    required: false,
    description: 'Filter by user role',
  })
  @ApiResponse({
    status: 200,
    description: 'System-wide evaluation analytics',
    type: EvaluationAnalyticsDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getEvaluationAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<EvaluationAnalyticsDto> {
    return this.evaluationService.getEvaluationAnalytics({
      startDate,
      endDate,
    });
  }

  @Get('admin/analytics/workflow')
  @UseGuards(JwtAuthGuard)
  @RequirePermission('admin:audit')
  @ApiOperation({
    summary: 'Get workflow step performance analytics (Monitor only)',
  })
  @ApiQuery({
    name: 'stepName',
    required: false,
    description: 'Filter by specific workflow step',
  })
  @ApiQuery({
    name: 'agentName',
    required: false,
    description: 'Filter by agent name',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date filter (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date filter (YYYY-MM-DD)',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow performance analytics',
    schema: {
      type: 'object',
      properties: {
        overallMetrics: {
          type: 'object',
          properties: {
            totalWorkflows: { type: 'number' },
            averageCompletionRate: { type: 'number' },
            averageDuration: { type: 'number' },
            commonFailurePoints: { type: 'array', items: { type: 'string' } },
          },
        },
        stepAnalytics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              stepName: { type: 'string' },
              completionRate: { type: 'number' },
              averageDuration: { type: 'number' },
              failureRate: { type: 'number' },
              commonErrors: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getWorkflowAnalytics(
    @Query('stepName') stepName?: string,
    @Query('agentName') agentName?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<unknown> {
    return this.evaluationService.getWorkflowAnalytics({
      // stepName, // TODO: Add stepName to AdminEvaluationFiltersDto
      agentName,
      startDate,
      endDate,
    });
  }

  @Get('admin/analytics/constraints')
  @UseGuards(JwtAuthGuard)
  @RequirePermission('admin:audit')
  @ApiOperation({
    summary: 'Get CIDAFM constraint effectiveness analytics (Monitor only)',
  })
  @ApiQuery({
    name: 'constraintType',
    required: false,
    description: 'Filter by constraint type (active, response, command)',
  })
  @ApiQuery({
    name: 'minEffectiveness',
    required: false,
    type: Number,
    description: 'Filter by minimum effectiveness score (1-5)',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date filter (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date filter (YYYY-MM-DD)',
  })
  @ApiResponse({
    status: 200,
    description: 'CIDAFM constraint effectiveness analytics',
    schema: {
      type: 'object',
      properties: {
        overallMetrics: {
          type: 'object',
          properties: {
            totalConstraintUsages: { type: 'number' },
            averageEffectiveness: { type: 'number' },
            averageCompliance: { type: 'number' },
            topPerformingConstraints: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        constraintAnalytics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              constraintName: { type: 'string' },
              constraintType: { type: 'string' },
              usageCount: { type: 'number' },
              averageEffectiveness: { type: 'number' },
              averageCompliance: { type: 'number' },
              impactDescription: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getConstraintAnalytics(
    @Query('constraintType') constraintType?: string,
    @Query('minEffectiveness') minEffectiveness?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<unknown> {
    return this.evaluationService.getConstraintAnalytics({
      // constraintType,
      // minEffectiveness, // TODO: Add these filters to AdminEvaluationFiltersDto
      startDate,
      endDate,
    });
  }

  @Get('admin/export')
  @UseGuards(JwtAuthGuard)
  @RequirePermission('admin:audit')
  @ApiOperation({
    summary: 'Export enhanced evaluation data for admin analysis (Admin only)',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['json', 'csv', 'xlsx'],
    description: 'Export format',
  })
  @ApiQuery({
    name: 'includeUserData',
    required: false,
    type: Boolean,
    description: 'Include user personal information in export',
  })
  @ApiQuery({
    name: 'includeContent',
    required: false,
    type: Boolean,
    description: 'Include task/message content in export',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date filter (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date filter (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'userRole',
    required: false,
    description: 'Filter by user role',
  })
  @ApiResponse({
    status: 200,
    description: 'Exported enhanced evaluation data',
    schema: {
      oneOf: [
        {
          type: 'array',
          description: 'JSON format export',
        },
        {
          type: 'string',
          description: 'CSV/XLSX format export',
        },
      ],
    },
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async exportEnhancedEvaluations(
    @Query('format') format: 'json' | 'csv' = 'json',
    @Query('includeUserData') includeUserData?: boolean,
    @Query('includeContent') includeContent?: boolean,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<Record<string, unknown>[] | string> {
    return this.evaluationService.exportEnhancedEvaluations(
      {
        startDate,
        endDate,
        // userRole, // TODO: Add userRole filter
      },
      {
        format,
        includeWorkflowDetails: includeContent,
        includeConstraintDetails: includeContent,
        anonymizeUsers: !includeUserData,
      },
    );
  }

  @Get('admin/users/:userId/evaluations')
  @UseGuards(JwtAuthGuard)
  @RequirePermission('admin:audit')
  @ApiOperation({
    summary: 'Get evaluations for a specific user (Monitor only)',
  })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiQuery({
    name: 'includeDetails',
    required: false,
    type: Boolean,
    description: 'Include detailed metadata',
  })
  @ApiResponse({
    status: 200,
    description: 'User evaluations with enhanced metadata',
    type: [EnhancedEvaluationMetadataDto],
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserEvaluationsForAdmin(
    @Param('userId') userId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ): Promise<{
    evaluations: EnhancedEvaluationMetadataDto[];
    user: {
      id: string;
      email: string;
      displayName: string;
      roles: string[];
    };
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    // Sanitize pagination
    const sanitizedLimit = Math.min(Math.max(limit, 1), 100);
    const sanitizedPage = Math.max(page, 1);

    // TODO: Implement getUserEvaluationsForAdmin method
    const result = await this.evaluationService.getAllEvaluationsForAdmin({
      page: sanitizedPage,
      limit: sanitizedLimit,
      userEmail: userId, // Temporary workaround - should filter by userId
    });

    return {
      ...result,
      user: {
        id: userId,
        email: 'user@example.com', // TODO: Get actual user data
        displayName: 'User',
        roles: ['user'],
      },
    };
  }

  @Get('admin/performance/agents')
  @UseGuards(JwtAuthGuard)
  @RequirePermission('admin:audit')
  @ApiOperation({ summary: 'Get agent performance comparison (Monitor only)' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date filter (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date filter (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'minEvaluations',
    required: false,
    type: Number,
    description: 'Minimum number of evaluations for inclusion',
  })
  @ApiResponse({
    status: 200,
    description: 'Agent performance comparison data',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          agentName: { type: 'string' },
          evaluationCount: { type: 'number' },
          averageRating: { type: 'number' },
          averageSpeedRating: { type: 'number' },
          averageAccuracyRating: { type: 'number' },
          averageResponseTime: { type: 'number' },
          averageCost: { type: 'number' },
          workflowCompletionRate: { type: 'number' },
          topConstraints: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getAgentPerformance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<Record<string, unknown>[]> {
    // TODO: Implement getAgentPerformanceComparison method
    const analytics = await this.evaluationService.getEvaluationAnalytics({
      startDate,
      endDate,
    });

    // Convert to array format expected by return type
    return analytics.topPerformingAgents || [];
  }

  @Get('admin/trends/time-series')
  @UseGuards(JwtAuthGuard)
  @RequirePermission('admin:audit')
  @ApiOperation({ summary: 'Get evaluation trends over time (Admin only)' })
  @ApiQuery({
    name: 'timeframe',
    required: false,
    enum: ['daily', 'weekly', 'monthly'],
    description: 'Time aggregation level',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date filter (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date filter (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'metric',
    required: false,
    enum: ['rating', 'volume', 'cost', 'response_time'],
    description: 'Primary metric to track',
  })
  @ApiResponse({
    status: 200,
    description: 'Time series evaluation trend data',
    schema: {
      type: 'object',
      properties: {
        timeframe: { type: 'string' },
        metric: { type: 'string' },
        dataPoints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              value: { type: 'number' },
              evaluationCount: { type: 'number' },
              metadata: { type: 'object' },
            },
          },
        },
        summary: {
          type: 'object',
          properties: {
            trend: { type: 'string' },
            percentageChange: { type: 'number' },
            insights: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getEvaluationTrends(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<unknown> {
    // TODO: Implement getEvaluationTrends method
    return this.evaluationService.getEvaluationAnalytics({
      startDate,
      endDate,
    });
  }
}
