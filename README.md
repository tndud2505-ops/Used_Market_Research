# USED MARKET workspace

국내 중고 검색 애플리케이션 하나로 운영하며 eBay를 검색 사이트로 포함합니다. Git에는 소스·하네스·문서·안전한 설정 예시만 포함하며, 실제 키·토큰·검색 결과·브라우저 캐시·백업 파일은 포함하지 않습니다.

## Clone and prepare

Requirements: Git, Node.js 22+, npm 10+, and Chrome or Chromium for live collection.

```powershell
git clone https://github.com/tndud2505-ops/Used_Market_Research.git
cd Used_Market_Research
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

Linux/macOS:

```bash
git clone https://github.com/tndud2505-ops/Used_Market_Research.git
cd Used_Market_Research
bash scripts/setup.sh
```

The setup script runs `npm ci` and creates a local `.env` from the committed example only when it does not already exist. Add private values only to that ignored `.env` file.

## Applications

| App | Path | Main verification |
| --- | --- | --- |
| USED MARKET | `used_market_gemini_cli_full_docs/apps/domestic` | `npm test` |

Run the deterministic suite with `powershell -File .\scripts\verify.ps1` or `bash scripts/verify.sh`.

Configuration and deployment details:

- [Portable setup](used_market_gemini_cli_full_docs/SETUP.md)
- [Application](used_market_gemini_cli_full_docs/apps/domestic/README.md)
