# USED MARKET workspace

국내 검색과 해외 검색을 서로 참조하지 않는 두 개의 독립 애플리케이션으로 관리합니다. Git에는 소스·하네스·문서·안전한 설정 예시만 포함하며, 실제 키·토큰·검색 결과·브라우저 캐시·백업 파일은 포함하지 않습니다.

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

The setup script runs `npm ci` independently in both apps and creates local `.env` files from the committed examples only when they do not already exist. Add private values only to those ignored `.env` files.

## Applications

| App | Path | Main verification |
| --- | --- | --- |
| Domestic | `used_market_gemini_cli_full_docs/apps/domestic` | `npm test` |
| Global | `used_market_gemini_cli_full_docs/apps/global` | `npm test` and `npm run test:ui` |

Run both deterministic suites with `powershell -File .\scripts\verify.ps1` or `bash scripts/verify.sh`.

Configuration and deployment details:

- [Portable setup](used_market_gemini_cli_full_docs/SETUP.md)
- [Domestic app](used_market_gemini_cli_full_docs/apps/domestic/README.md)
- [Global app](used_market_gemini_cli_full_docs/apps/global/README.md)
- [Global project wiki](used_market_gemini_cli_full_docs/apps/global/docs/WIKI.md)

The two app directories must remain independent. Do not add cross-app imports, shared runtime packages, shared harnesses, or shared result storage.
