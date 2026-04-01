import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SupabaseAuthUserDto } from '../dto/auth.dto';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): SupabaseAuthUserDto => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: SupabaseAuthUserDto }>();
    return request.user;
  },
);
