import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { App } from 'firebase-admin/app';
export declare const FIREBASE_USER = "firebaseUser";
export declare class FirebaseAuthGuard implements CanActivate {
    private readonly firebaseApp;
    private readonly reflector;
    constructor(firebaseApp: App, reflector: Reflector);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
