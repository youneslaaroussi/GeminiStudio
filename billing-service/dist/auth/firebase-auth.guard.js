"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirebaseAuthGuard = exports.FIREBASE_USER = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const auth_1 = require("firebase-admin/auth");
exports.FIREBASE_USER = 'firebaseUser';
let FirebaseAuthGuard = class FirebaseAuthGuard {
    firebaseApp;
    reflector;
    constructor(firebaseApp, reflector) {
        this.firebaseApp = firebaseApp;
        this.reflector = reflector;
    }
    async canActivate(context) {
        const skip = this.reflector.get('skipAuth', context.getHandler());
        if (skip)
            return true;
        const request = context.switchToHttp().getRequest();
        const auth = request.headers?.authorization;
        if (!auth?.startsWith('Bearer ')) {
            throw new common_1.UnauthorizedException('Missing or invalid Authorization header');
        }
        const token = auth.slice(7);
        try {
            const decoded = await (0, auth_1.getAuth)(this.firebaseApp).verifyIdToken(token);
            request[exports.FIREBASE_USER] = { uid: decoded.uid, email: decoded.email };
            return true;
        }
        catch {
            throw new common_1.UnauthorizedException('Invalid or expired token');
        }
    }
};
exports.FirebaseAuthGuard = FirebaseAuthGuard;
exports.FirebaseAuthGuard = FirebaseAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)('FIREBASE_ADMIN')),
    __metadata("design:paramtypes", [Object, core_1.Reflector])
], FirebaseAuthGuard);
//# sourceMappingURL=firebase-auth.guard.js.map