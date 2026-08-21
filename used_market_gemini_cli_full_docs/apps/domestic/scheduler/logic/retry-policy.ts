/**
 * 재시도 정책 정의
 * - 1차 재시도: 1분 대기
 * - 2차 재시도: 5분 대기
 * - 3차 이후: 실패 확정
 */

export interface RetryPolicy {
  max_attempts: number;        // 최대 시도 횟수
  initial_delay_ms: number;    // 초기 대기 시간 (ms)
  backoff_multiplier: number;  // 지수 백오프 배수
  max_delay_ms: number;        // 최대 대기 시간 (ms)
  retry_on: readonly string[]; // 재시도 가능한 오류 타입
}

export const RETRY_POLICY_TEMPLATES = {
  transient_error: {
    max_attempts: 3,
    initial_delay_ms: 60000,     // 1분
    backoff_multiplier: 5,       // 5배: 1분 -> 5분 -> 25분 (capped at max)
    max_delay_ms: 900000,        // 15분 (1차 1분, 2차 5분, 3차 15분)
    retry_on: ['TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMIT', 'TEMPORARY_ERROR']
  },
  login_required: {
    max_attempts: 1,
    initial_delay_ms: 0,
    backoff_multiplier: 1,
    max_delay_ms: 0,
    retry_on: ['LOGIN_REQUIRED'],
    note: 'record and stop - do not retry'
  },
  schema_error: {
    max_attempts: 2,
    initial_delay_ms: 30000,     // 30초
    backoff_multiplier: 2,
    max_delay_ms: 60000,         // 1분
    retry_on: ['SCHEMA_ERROR', 'DATA_FORMAT_ERROR'],
    note: 'send to merge AI docs feedback'
  }
} as const;

/**
 * 오류 타입별 재시도 가능 여부 판별
 */
export const NON_RETRYABLE_ERRORS = [
  'VALIDATION_ERROR',           // 입력값 검증 실패
  'AUTHENTICATION_ERROR',       // 인증 실패
  'INVALID_KEYWORD',            // 키워드 문제
  'FILE_NOT_FOUND',             // 파일 누락
  'INVALID_SITE',               // 사이트 검증 실패
  'PLACEHOLDER_INPUT',          // placeholder 입력값
  'LOGIN_REQUIRED'              // 로그인 필요는 재시도해도 상태가 바뀌지 않음
] as const;

/**
 * 지수 백오프 계산
 * @param attempt 현재 시도 번호 (1부터 시작)
 * @param policy 재시도 정책
 * @returns 대기 시간 (ms)
 */
export function calculateBackoffDelay(attempt: number, policy: RetryPolicy): number {
  if (attempt <= 1) return 0; // 첫 시도는 즉시
  
  const baseDelay = policy.initial_delay_ms;
  const multiplier = Math.pow(policy.backoff_multiplier, attempt - 2);
  const calculatedDelay = baseDelay * multiplier;
  
  // max_delay_ms로 제한
  return Math.min(calculatedDelay, policy.max_delay_ms);
}

/**
 * 특정 오류가 재시도 가능한지 판별
 */
export function isRetryableError(errorType: string, policy: RetryPolicy): boolean {
  // NON_RETRYABLE_ERRORS에 포함되면 재시도 불가
  if ((NON_RETRYABLE_ERRORS as readonly string[]).includes(errorType)) {
    return false;
  }
  
  // policy.retry_on에 포함되면 재시도 가능
  return policy.retry_on.includes(errorType);
}
