import { Module } from '@nestjs/common';
import { CreditsController } from './credits.controller';
import { CreditsBillingService } from './credits-billing.service';
import { KickboxService } from './kickbox.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CreditsController],
  providers: [CreditsBillingService, KickboxService],
})
export class CreditsModule {}
