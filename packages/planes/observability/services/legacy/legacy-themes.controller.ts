/**
 * LegacyThemesController
 * Merged from apps/observability/server/src/themes/themes.controller.ts
 *
 * Theme CRUD endpoints:
 *   POST   /observability-legacy/api/themes
 *   GET    /observability-legacy/api/themes
 *   GET    /observability-legacy/api/themes/stats
 *   GET    /observability-legacy/api/themes/:id
 *   PUT    /observability-legacy/api/themes/:id
 *   DELETE /observability-legacy/api/themes/:id
 *   GET    /observability-legacy/api/themes/:id/export
 *   POST   /observability-legacy/api/themes/import
 */
import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Response } from 'express';
import { LegacyThemesService } from './legacy-themes.service';
import type {
  ThemeSearchQuery,
  ThemeColors,
  ThemeStats,
  ApiResponse,
} from '../observability-types';

// DTOs for controller endpoints
interface CreateThemeDto {
  name: string;
  displayName: string;
  description?: string;
  colors: ThemeColors;
  isPublic: boolean;
  tags?: string[];
  authorId?: string;
  authorName?: string;
}

interface UpdateThemeDto {
  displayName?: string;
  description?: string;
  colors?: ThemeColors;
  isPublic?: boolean;
  tags?: string[];
  authorName?: string;
}

interface ImportThemeDto {
  theme: Record<string, unknown>;
  version?: string;
  exportedAt?: string;
  exportedBy?: string;
}

@Controller('observability-legacy/api/themes')
export class LegacyThemesController {
  constructor(@Inject(LegacyThemesService) private readonly themesService: LegacyThemesService) {}

  @Post()
  async createTheme(@Body() themeData: CreateThemeDto, @Res() res: Response) {
    const result = await this.themesService.createTheme(themeData);
    const status = result.success ? HttpStatus.CREATED : HttpStatus.BAD_REQUEST;
    return res.status(status).json(result);
  }

  @Get()
  async searchThemes(
    @Query('query') query?: string,
    @Query('isPublic') isPublic?: string,
    @Query('authorId') authorId?: string,
    @Query('sortBy')
    sortBy?: 'name' | 'created' | 'updated' | 'downloads' | 'rating',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const searchQuery: ThemeSearchQuery = {
      query: query || undefined,
      isPublic: isPublic ? isPublic === 'true' : undefined,
      authorId: authorId || undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    };

    return this.themesService.searchThemes(searchQuery);
  }

  @Get('stats')
  async getStats(): Promise<ApiResponse<ThemeStats>> {
    return this.themesService.getThemeStats();
  }

  @Get(':id')
  async getTheme(@Param('id') id: string, @Res() res: Response) {
    const result = await this.themesService.getThemeById(id);
    const status = result.success ? HttpStatus.OK : HttpStatus.NOT_FOUND;
    return res.status(status).json(result);
  }

  @Put(':id')
  async updateTheme(
    @Param('id') id: string,
    @Body() updates: UpdateThemeDto,
    @Res() res: Response,
  ) {
    const result = await this.themesService.updateThemeById(id, updates);
    const status = result.success ? HttpStatus.OK : HttpStatus.BAD_REQUEST;
    return res.status(status).json(result);
  }

  @Delete(':id')
  async deleteTheme(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('authorId') authorId?: string,
  ) {
    const result = await this.themesService.deleteThemeById(id, authorId);
    const status = result.success
      ? HttpStatus.OK
      : result.error?.includes('not found')
        ? HttpStatus.NOT_FOUND
        : HttpStatus.FORBIDDEN;
    return res.status(status).json(result);
  }

  @Get(':id/export')
  async exportTheme(@Param('id') id: string, @Res() res: Response) {
    const result = await this.themesService.exportThemeById(id);
    if (!result.success) {
      const status = result.error?.includes('not found')
        ? HttpStatus.NOT_FOUND
        : HttpStatus.BAD_REQUEST;
      return res.status(status).json(result);
    }

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.data!.theme.name}.json"`,
    );
    return res.json(result.data);
  }

  @Post('import')
  async importTheme(
    @Body() importData: ImportThemeDto,
    @Res() res: Response,
    @Query('authorId') authorId?: string,
  ) {
    const result = await this.themesService.importTheme(importData, authorId);
    const status = result.success ? HttpStatus.CREATED : HttpStatus.BAD_REQUEST;
    return res.status(status).json(result);
  }
}
