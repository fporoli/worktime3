import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authenticateToken, type AuthenticatedPrincipal } from './jwt';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface AuthenticatedRequest {
  headers?: Record<string, string | string[] | undefined>;
  user?: AuthenticatedPrincipal;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers?.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('missing-token');
    const principal = await authenticateToken(token);
    if (!principal) throw new UnauthorizedException('invalid-token');
    req.user = principal;
    return true;
  }
}
