import type { SearchResult } from "../../MCP/logic/types.js";

export const COMMON_RULES = `# Used Market Automation Rules

너는 중고 거래 웹 자동화 보조 에이전트다.
목표: 사이트 검색, JSON 추출, 정규화 준비, 구매 메시지 초안 분리를 수행한다.
행동 규칙: 로그인 확인 우선, 광고/중복/판매완료 제외, JSON 우선, 확정 구매 동작 금지.`;

export function buildLoginPrompt(siteName: string): string {
  return `현재 사이트 ${siteName} 에서 로그인 상태만 확인해줘.

작업:
1. 현재 페이지 또는 홈 화면에서 로그인 여부를 확인해.
2. 로그인된 경우 "logged_in" 반환.
3. 로그인 안 된 경우 로그인 페이지로 이동 가능한지 확인하고 "logged_out" 반환.
4. 로그인에 추가 인증이 필요하면 "unknown" 또는 notes에 이유를 남겨.

JSON만 반환:
{
  "site": "${siteName}",
  "login_status": "logged_in | logged_out | unknown",
  "current_page": "",
  "notes": "",
  "errors": []
}`;
}

export function buildSearchPrompt(input: { siteName: string; siteType: string; locale: string; currency: string; keyword: string; limit: number; }): string {
  return `다음 전자상거래 또는 중고거래 사이트에서 매물을 검색해줘.

입력:
- site_name: ${input.siteName}
- site_type: ${input.siteType}
- keyword: ${input.keyword}
- locale: ${input.locale}
- currency: ${input.currency}
- max_items: ${input.limit}

목표:
- 로그인 상태 확인
- 검색 실행
- 검색 결과 상위 ${input.limit}개 추출
- 구조화 JSON 반환

JSON만 반환:
{
  "site": "${input.siteName}",
  "keyword": "${input.keyword}",
  "login_status": "unknown",
  "items": [
    {
      "title": "",
      "price": null,
      "currency": "${input.currency}",
      "seller": "",
      "status": "active",
      "condition": "",
      "shipping": "",
      "location": "",
      "posted_at": "",
      "url": "",
      "notes": "",
      "listing_type_hint": "full_pc | semi_pc | part | unknown",
      "warnings": []
    }
  ],
  "warnings": [],
  "quality_meta": {
    "extracted_count": 0,
    "filtered_count": 0,
    "duplicate_count": 0,
    "warning_count": 0
  },
  "next_action": "normalize",
  "errors": []
}`;
}

export function buildNormalizePrompt(siteName: string, keyword: string, searchResult: SearchResult): string {
  return `현재 수집한 매물 정보를 외부 가격 분석 툴에 넘길 수 있도록 정규화해줘.

사이트: ${siteName}
키워드: ${keyword}
입력 JSON:
${JSON.stringify(searchResult, null, 2)}

목표:
- 동일 의미 필드 정리
- 가격 숫자 정규화
- 부품명이 보이면 components에 추가
- listing_type 분류

반환 JSON 형식:
{
  "site": "${siteName}",
  "keyword": "${keyword}",
  "normalized_items": [
    {
      "title": "",
      "price_value": null,
      "currency": "KRW",
      "seller_name": "",
      "item_status": "unknown",
      "location": "",
      "posted_at": "",
      "url": "",
      "raw_notes": "",
      "listing_type": "full_pc | semi_pc | part | unknown",
      "components": [
        {
          "component_type": "gpu",
          "canonical_name": "NVIDIA GTX 1050",
          "confidence": 0.9,
          "source_text": "GTX 1050"
        }
      ]
    }
  ]
}

설명 없이 JSON만 반환해.`;
}

export function buildMessageDraftPrompt(input: { siteName: string; title: string; price: number | null; seller: string; url: string; }): string {
  return `외부 분석 툴이 아래 매물을 좋은 가격이라고 판단했다.
판매자에게 보낼 구매 문의 메시지 초안을 작성해줘.

매물 정보:
- 사이트: ${input.siteName}
- 상품명: ${input.title}
- 가격: ${input.price ?? "unknown"}
- 판매자명: ${input.seller}
- 링크: ${input.url}

조건:
- 공손하고 짧게 작성
- 아직 발송하지 말고 초안만 작성

반환 형식:
{
  "site": "${input.siteName}",
  "language": "",
  "message_draft": "",
  "send_recommended": true
}`;
}

export function buildValidationPrompt(input: { siteName: string; title: string; price: number | null; seller: string; url: string; }): string {
  const priceLiteral = input.price === null ? "null" : String(input.price);
  return `구매 메시지 발송 전에 현재 선택된 매물을 다시 검증해줘.

검증 항목:
- 상품명 일치 여부
- 가격 일치 여부
- 판매자 정보 존재 여부
- 링크 유효 여부
- 판매완료 여부
- 예약중 여부
- 메시지 입력 가능한 상태인지 여부

기준 정보:
- 사이트: ${input.siteName}
- 상품명: ${input.title}
- 가격: ${input.price ?? "unknown"}
- 판매자: ${input.seller}
- 링크: ${input.url}

JSON만 반환:
{
  "site": "${input.siteName}",
  "validated": true,
  "item": {
    "title": "${input.title}",
    "price": ${priceLiteral},
    "seller": "${input.seller}",
    "status": "active",
    "url": "${input.url}"
  },
  "message_ready": true,
  "warnings": [],
  "errors": []
}`;
}
