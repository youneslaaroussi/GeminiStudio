"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditsModule = void 0;
const common_1 = require("@nestjs/common");
const credits_controller_1 = require("./credits.controller");
const credits_billing_service_1 = require("./credits-billing.service");
const kickbox_service_1 = require("./kickbox.service");
const auth_module_1 = require("../auth/auth.module");
let CreditsModule = class CreditsModule {
};
exports.CreditsModule = CreditsModule;
exports.CreditsModule = CreditsModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule],
        controllers: [credits_controller_1.CreditsController],
        providers: [credits_billing_service_1.CreditsBillingService, kickbox_service_1.KickboxService],
    })
], CreditsModule);
//# sourceMappingURL=credits.module.js.map