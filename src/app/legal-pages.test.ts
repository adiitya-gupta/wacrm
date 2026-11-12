import { describe, expect, it } from "vitest";
import PrivacyPolicyPage, { metadata as privacyMetadata } from "./privacy-policy/page";
import TermsOfServicePage, { metadata as termsMetadata } from "./terms-of-service/page";
import { renderToString } from "react-dom/server";

describe("Public Legal Compliance Pages", () => {
  describe("Metadata Configuration", () => {
    it("exports valid metadata for Privacy Policy enabling search indexing for OAuth reviewers", () => {
      expect(privacyMetadata.title).toBe("Privacy Policy");
      expect(privacyMetadata.description).toBeDefined();
      expect(privacyMetadata.robots).toEqual({
        index: true,
        follow: true,
      });
    });

    it("exports valid metadata for Terms of Service enabling search indexing for OAuth reviewers", () => {
      expect(termsMetadata.title).toBe("Terms of Service");
      expect(termsMetadata.description).toBeDefined();
      expect(termsMetadata.robots).toEqual({
        index: true,
        follow: true,
      });
    });
  });

  describe("Privacy Policy Content Compliance", () => {
    it("renders required Google Calendar OAuth compliance and confirmed OPSIYS details without placeholders", () => {
      const html = renderToString(PrivacyPolicyPage());

      // Google OAuth Scopes & Purpose
      expect(html).toContain("calendar.events");
      expect(html).toContain("calendar.readonly");
      expect(html).toContain("userinfo.email");
      expect(html).toContain("Google API Services User Data Policy");
      expect(html).toContain("Limited Use");

      // No ad tracking or selling
      expect(html).toContain("advertising, marketing, or behavioral profiling");

      // Revocation & Disconnection
      expect(html).toContain("Availability Rules");
      expect(html).toContain("myaccount.google.com/permissions");

      // WhatsApp & AI Policies
      expect(html).toContain("WhatsApp Cloud API");
      expect(html).toContain("Cloudflare Workers AI");
      expect(html).toContain("No Platform AI Model Training");

      // Security & Encryption
      expect(html).toContain("AES-256-GCM");
      expect(html).toContain("Row-Level Security");

      // Confirmed business details & zero placeholders
      expect(html).toContain("OPSIYS");
      expect(html).toContain("contact@opsiys.in");
      expect(html).toContain("India");
      expect(html).not.toContain("[Insert");
      expect(html).not.toContain("within 30 days of closure");
      expect(html).not.toContain("Hardware-Grade");
    });
  });

  describe("Terms of Service Content Compliance", () => {
    it("renders required WhatsApp acceptable use, Google terms, and confirmed OPSIYS provisions without placeholders", () => {
      const html = renderToString(TermsOfServicePage());

      // WhatsApp Acceptable Use & Meta Policies
      expect(html).toContain("WhatsApp Business Policy");
      expect(html).toContain("WhatsApp Commerce Policy");
      expect(html).toContain("Unsolicited Broadcasts (Spam)");
      expect(html).toContain("Meta Platform Autonomy &amp; Account Quality Disclaimer");

      // Google Calendar Terms
      expect(html).toContain("Google Calendar Integration Terms");
      expect(html).toContain("Scope of Authorization");

      // Accurate Billing
      expect(html).toContain("Subscriptions, Billing &amp; Payment Terms");
      expect(html).not.toContain("automatically convert into a paid recurring subscription");

      // Prohibited Activities & Security
      expect(html).toContain("Reverse engineer");
      expect(html).toContain("Row-Level Security");

      // Liability & Governing Law
      expect(html).toContain("Disclaimer of Warranties");
      expect(html).toContain("Monetary Liability Cap");
      expect(html).toContain("OPSIYS");
      expect(html).toContain("contact@opsiys.in");
      expect(html).toContain("India");
      expect(html).not.toContain("[Insert");
    });
  });
});

