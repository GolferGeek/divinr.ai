import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Req,
} from '@nestjs/common';
import { AttributionQueryService } from './attribution-query.service';

interface AuthenticatedUser {
  id: string;
  email?: string;
}

@Controller('attribution')
export class AuthorAttributionController {
  constructor(
    @Inject(AttributionQueryService) private readonly query: AttributionQueryService,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) {
      throw new BadRequestException('Authentication required');
    }
    return req.user;
  }

  @Get('my-summary')
  async mySummary(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.query.queryMySummary(user.id);
  }

  @Get('instrument/:id')
  async instrument(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
  ) {
    const user = this.getUser(req);
    if (!id) throw new BadRequestException('instrument id required');
    return this.query.queryInstrument(id, user.id);
  }
}
