import { Injectable } from '@nestjs/common';
import { getPaystackConfig } from './paystack.config';

type PaystackInitResponse = {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

@Injectable()
export class PaystackService {
  private baseUrl = 'https://api.paystack.co';

  getConfigSummary() {
    const config = getPaystackConfig(process.env, { allowUnconfigured: true });
    return {
      mode: config.mode,
      configured: config.configured,
    };
  }

  async initializeTransaction(input: {
    email: string;
    amount: number; // pesewas
    reference: string;
    currency?: string; // GHS
    callback_url?: string;
    metadata?: any;
  }) {
    const config = getPaystackConfig(process.env);

    const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: input.email,
        amount: input.amount,
        reference: input.reference,
        currency: input.currency || 'GHS',
        callback_url: input.callback_url,
        metadata: input.metadata,
      }),
    });

    const json = (await res.json()) as PaystackInitResponse;

    if (!res.ok || !json.status || !json.data) {
      throw new Error(`Paystack init failed: ${JSON.stringify(json)}`);
    }

    return json.data;
  }
}
