import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { RunMetadataService } from './run-metadata.service';

@Controller('api/llm-usage')
export class LlmUsageController {
  constructor(private readonly runMetadataService: RunMetadataService) {}

  /**
   * Get LLM usage records with filtering
   */
  @Get('records')
  async getUsageRecords(
    @Query('userId') userId?: string,
    @Query('callerType') callerType?: string,
    @Query('callerName') callerName?: string,
    @Query('conversationId') conversationId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('route') route?: 'local' | 'remote',
    @Query('limit') limit?: string,
  ) {
    const filters = {
      userId,
      callerType,
      callerName,
      conversationId,
      startDate,
      endDate,
      route,
      limit: limit ? parseInt(limit, 10) : undefined,
    };

    // Remove undefined values
    const cleanFilters = Object.fromEntries(
      Object.entries(filters).filter(([_, v]) => v !== undefined),
    );

    const records = await this.runMetadataService.getUsageRecords(cleanFilters);

    return {
      success: true,
      data: records,
      count: records.length,
      filters: cleanFilters,
    };
  }

  /**
   * Get LLM usage analytics
   */
  @Get('analytics')
  async getUsageAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('callerType') callerType?: string,
    @Query('route') route?: 'local' | 'remote',
  ) {
    const filters = {
      startDate,
      endDate,
      callerType,
      route,
    };

    // Remove undefined values
    const cleanFilters = Object.fromEntries(
      Object.entries(filters).filter(([_, v]) => v !== undefined),
    );

    const analytics =
      await this.runMetadataService.getUsageAnalytics(cleanFilters);

    return {
      success: true,
      data: analytics,
      count: analytics.length,
      filters: cleanFilters,
    };
  }

  /**
   * Get current service statistics
   */
  @Get('stats')
  async getStats() {
    const stats = await this.runMetadataService.getStats();

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * Get active runs (for monitoring)
   */
  @Get('active')
  getActiveRuns() {
    const activeRuns = this.runMetadataService.getActiveRuns();

    return {
      success: true,
      data: activeRuns,
      count: activeRuns.length,
    };
  }

  /**
   * Get detailed usage information for a specific run
   */
  @Get('details/:runId')
  async getUsageDetails(@Param('runId') runId: string) {
    const details = await this.runMetadataService.getUsageDetails(runId);
    if (!details) {
      throw new NotFoundException(`Usage record not found for runId: ${runId}`);
    }
    return {
      success: true,
      data: details,
    };
  }
}
