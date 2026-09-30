import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentPlatformUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.platformUser;
    return data ? user?.[data] : user;
  },
);
