import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getAuth } from 'firebase-admin/auth';
import type { App } from 'firebase-admin/app';

export const FIREBASE_USER = 'firebaseUser';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    @Inject('FIREBASE_ADMIN') private readonly firebaseApp: App,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.get<boolean>('skipAuth', context.getHandler());
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const auth = request.headers?.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    const token = auth.slice(7);
    try {
      const decoded = await getAuth(this.firebaseApp).verifyIdToken(token);
      request[FIREBASE_USER] = { 
        uid: decoded.uid, 
        email: decoded.email,
        emailVerified: decoded.email_verified ?? false,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
