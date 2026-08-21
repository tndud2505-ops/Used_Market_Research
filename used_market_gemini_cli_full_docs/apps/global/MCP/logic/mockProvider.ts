import { z } from "zod";
import type { ModelProvider, ModelRequest, ProviderCheckResult, ProviderMetadata } from "./types.js";

export class MockProvider implements ModelProvider {
  readonly name = "mock";

  getMetadata(): ProviderMetadata {
    return {
      provider_name: this.name,
      model_name: "mock-static",
      auth_mode: "not_required"
    };
  }

  providerCheck(): ProviderCheckResult {
    return {
      ...this.getMetadata(),
      ready: true,
      command: null,
      checked_at: new Date().toISOString(),
      notes: ["mock provider is always available"]
    };
  }

  async runJson<T>(request: ModelRequest, schema: z.ZodType<T>): Promise<T> {
    const prompt = request.prompt;

    if (prompt.includes("로그인 상태만 확인")) {
      const site = /현재 사이트 (.+?) 에서 로그인 상태만 확인/.exec(prompt)?.[1] ?? "unknown";
      return schema.parse({
        site,
        login_status: "logged_in",
        current_page: "home",
        notes: "mock provider",
        errors: []
      });
    }

    if (prompt.includes("매물을 검색해줘") || prompt.includes("전자상거래 또는 중고거래 사이트에서 매물을 검색")) {
      const site = /site_name: (.+)/.exec(prompt)?.[1] ?? "mock-site";
      const keyword = /keyword: (.+)/.exec(prompt)?.[1] ?? "mock-keyword";
      const price = keyword.toLowerCase().includes("3060") ? 185000 : 99000;
      return schema.parse({
        site,
        keyword,
        login_status: "logged_in",
        items: [
          {
            title: `${keyword} sample listing`,
            price,
            currency: "JPY",
            seller: "mock-seller",
            status: "active",
            condition: "used",
            shipping: "unknown",
            location: "Suwon",
            posted_at: "2026-04-18",
            url: "https://example.com/item/1",
            notes: "mock item",
            listing_type_hint: "part",
            warnings: [],
            // Item 13-14: Real transaction pricing
            sale_status: "active",
            estimated_deal_price: price * 0.95,
            price_change_count: 1,
            // Item 15-16: Fraud signal data
            upload_date: "2026-04-18",
            seller_upload_count: 2,
            description_length: 45,
            has_photo: true
          },
          {
            title: `${keyword} full pc`,
            price: price + 150000,
            currency: "JPY",
            seller: "mock-builder",
            status: "active",
            condition: "used",
            shipping: "pickup",
            location: "Seoul",
            posted_at: "2026-04-17",
            url: "https://example.com/item/2",
            notes: "5600x / 3060 / ram16 / ssd500",
            listing_type_hint: "full_pc",
            warnings: [],
            // Item 13-14: Real transaction pricing
            sale_status: "active",
            estimated_deal_price: (price + 150000) * 0.92,
            price_change_count: 3,
            // Item 15-16: Fraud signal data
            upload_date: "2026-04-17",
            seller_upload_count: 5,
            description_length: 120,
            has_photo: true
          }
        ],
        warnings: [],
        quality_meta: {
          extracted_count: 2,
          filtered_count: 0,
          duplicate_count: 0,
          warning_count: 0
        },
        next_action: "normalize",
        errors: []
      });
    }

    if (prompt.includes("외부 가격 분석 툴에 넘길 수 있도록 정규화")) {
      return schema.parse({
        site: "mock-site",
        keyword: "mock-keyword",
        normalized_items: []
      });
    }

    if (prompt.includes("좋은 가격이라고 판단")) {
      return schema.parse({
        site: "Mercari JP",
        language: "en",
        message_draft: "Hello. Is this item still available for purchase?",
        send_recommended: true
      });
    }

    if (prompt.includes("발송 전에 현재 선택된 매물을 다시 검증")) {
      return schema.parse({
        site: "Mercari JP",
        validated: true,
        item: {
          title: "mock item",
          price: 100000,
          seller: "mock-seller",
          status: "active",
          url: "https://example.com/item/1"
        },
        message_ready: true,
        warnings: [],
        errors: []
      });
    }

    throw new Error(`Unhandled mock prompt: ${prompt}`);
  }
}
