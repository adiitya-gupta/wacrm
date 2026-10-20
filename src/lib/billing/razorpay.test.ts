import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import {
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
} from './razorpay';

describe('Razorpay Signature Verification', () => {
  const secret = 'test_secret_12345';

  it('correctly validates valid payment signature', () => {
    const originalSecret = process.env.RAZORPAY_KEY_SECRET;
    try {
      process.env.RAZORPAY_KEY_SECRET = secret;

      const orderId = 'order_ABC123';
      const paymentId = 'pay_XYZ789';
      const validSig = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      const isValid = verifyRazorpayPaymentSignature({
        orderId,
        paymentId,
        signature: validSig,
      });

      expect(isValid).toBe(true);
    } finally {
      process.env.RAZORPAY_KEY_SECRET = originalSecret;
    }
  });

  it('rejects tampered payment signature', () => {
    const originalSecret = process.env.RAZORPAY_KEY_SECRET;
    try {
      process.env.RAZORPAY_KEY_SECRET = secret;

      const isValid = verifyRazorpayPaymentSignature({
        orderId: 'order_ABC123',
        paymentId: 'pay_XYZ789',
        signature: 'invalid_hex_signature_deadbeef',
      });

      expect(isValid).toBe(false);
    } finally {
      process.env.RAZORPAY_KEY_SECRET = originalSecret;
    }
  });

  it('verifies valid webhook signature and rejects forged webhook', () => {
    const rawBody = JSON.stringify({ event: 'payment.captured', id: 'evt_1' });
    const validWebhookSig = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    expect(verifyRazorpayWebhookSignature(rawBody, validWebhookSig, secret)).toBe(true);
    expect(verifyRazorpayWebhookSignature(rawBody, 'forged_sig', secret)).toBe(false);
  });
});
