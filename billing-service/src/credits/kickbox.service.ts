import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Kickbox verification result: deliverable, undeliverable, risky, unknown */
export type KickboxResult = 'deliverable' | 'undeliverable' | 'risky' | 'unknown';

export interface KickboxVerifyResponse {
  result: KickboxResult;
  reason?: string;
  success: boolean;
  email?: string;
  disposable?: boolean;
}

@Injectable()
export class KickboxService {
  private readonly logger = new Logger(KickboxService.name);
  private readonly apiKey: string | null;
  private readonly baseUrl = 'https://api.kickbox.com/v2/verify';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('KICKBOX_API_KEY') ?? null;
  }

  /**
   * Verify an email address via Kickbox API.
   * Returns true only if result is 'deliverable'.
   * Returns false for undeliverable, risky, unknown, or API errors.
   */
  async verify(email: string): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.warn('KICKBOX_API_KEY not set; skipping email verification');
      return true; // Allow bonus when Kickbox not configured (e.g. local dev)
    }

    const encoded = encodeURIComponent(email);
    const url = `${this.baseUrl}?email=${encoded}&apikey=${this.apiKey}`;

    try {
      const res = await fetch(url);
      const data = (await res.json()) as KickboxVerifyResponse;

      if (!data.success) {
        this.logger.warn('Kickbox API error', { email: email.slice(0, 3) + '***', success: data.success });
        return false;
      }

      const ok = data.result === 'deliverable';
      if (!ok) {
        this.logger.log('Email verification failed', {
          email: email.slice(0, 3) + '***',
          result: data.result,
          reason: data.reason,
        });
      }
      return ok;
    } catch (err) {
      this.logger.error('Kickbox verification failed', { err });
      return false;
    }
  }
}
