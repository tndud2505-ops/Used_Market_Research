# USED PICK 사용자 시나리오 검토 · 2026-11-14 KST

## 범위와 판정
실제 클라우드 브라우저에서 20개 모델/그룹을 선택해 화면과 가격을 확인했다. **20개 부분실행, 모든 하위단계 완료 0개**다. 전체 모델 분모는 미확정이며 진행률은 계산하지 않았다. 과거 완료를 오늘 완료로 옮기지 않았다. 세부 조작 미완료가 많아 이번 회차 전체 정상/완료 판정은 하지 않는다.

출발 IP `2a13:9500:1e4:45f::48:5b`는 요청 /64에 포함된다. 같은 클라우드 브라우저 ipify 탭에서 확인했다. 보안 확인은 나타나지 않았다. IP 선택·고정 기능은 없다. UA/화면 크기는 안전한 평가에서 제공되지 않아 미확인, 모바일도 미실행이다. 검사 시각은 아래 증거 파일별 UTC+9로 기록한다.

## 확인한 문제·관찰
- B660M DS3H DDR4: 현재 중고나라 110,000원·1건·11/13의 등록가 참고가 보인다. 11/11 빈 기록에서 관측 상태가 달라졌지만 원인 수정/전체 복구로 단정하지 않는다. 유일 출처를 숨기면 `가격 자료 없음`으로 바뀌는 기존 문제는 새로고침 후 재현했다. 기존 유형의 재발견 알림은 하지 않는다.
- HGST >8–12TB와 NZXT501–650W: 선택 전 국내 최근60일 기록 없음 표시와 달리 선택 후 eBay 기록 또는 등록가 참고가 존재한다. 수집범위 차이를 사용자에게 명확히 안내할 필요가 있다. 동일범위 집계 오류로 단정하지 않는다.
- HGST >1–2TB 내부 목록에서 HUS724020ALA640 제목 35,000원과 HGST2TB 40,000원 2건을 확인했다. 과거 특정40,000원 오분류 건과 동일 매물인지는 확인 못해 전체 복구 처리하지 않는다.
- i3-6100: 실제 날짜 선택에서11/12 가격·집계방식·표본수 확인. 차트 위 일반 휠이 페이지 이동 대신 기간확장/이전자료 로드를 일으켰다. 재확인은 로딩 종료까지 확인하지 못했으므로 확정 오류가 아닌 사용성 관찰이다.
- 최초 시세 팝업 날짜필드/URL의 범위 차이는 새로고침 후 일치했다. 지속 오류로 단정하지 않는다.

## 패치와 특별 시나리오
11/14 공개 패치 3개를 찾았다: 매물의 별도 시세 창, 컴퓨터 시세 가격 기준 선택, 간결한 매물 목록. HGST2TB 내부 매물에서 별도 시세창을 열고 제목/가격/기간조작/새로고침/닫기와 원래 목록 유지를 직접 확인했다. 컴퓨터 시세 기준선택 및 목록변경 전체 비교는 미실행이다.
특별 시나리오는 별도창 왕복, 국내미리보기 빈기록과 해외기록/이전기간 차이 두 가지였다. 과거 특별시나리오 전수 중복확인은 미완료다.

## 개선 의견
가격선 숨김은 데이터 없음과 구분해 `표시 중인 가격선 없음`으로 안내하면 좋다. 최근60일 기록 없음에는 국내/해외 범위를 붙이면 오해가 줄어든다. 일반 세로 스크롤과 차트 확대는 분리하거나 조작 안내를 눈에 띄게 제공하는 편이 좋다. 모두 공개 UI에 대한 의견이며 계산/수집 로직 변경 요구가 아니다.

## 모델별 실제 근거

- `gpu:nvidia:gtx-950` | 부분실행 | 첫 증거 2026-11-14T03:44:49.003Z UTC | https://used-pick.com/price-analysis.html?model=gpu%3Anvidia%3Agtx-950&from=2026-09-16&to=2026-11-13 | evidence/01-start.png, evidence/02-b660-full.png

- `motherboard:gigabyte:b660m-ds3h-ddr4` | 부분실행 | 첫 증거 2026-11-14T03:45:18.772Z UTC | https://used-pick.com/price-analysis.html?model=motherboard%3Agigabyte%3Ab660m-ds3h-ddr4&from=2026-09-16&to=2026-11-14 | evidence/03-b660-chart.png, evidence/04-b660-hidden.png, evidence/05-b660-reloaded.png, evidence/06-b660-hidden-reproduced.png, evidence/09-hgst-search.png

- `hdd:hgst:capacity-bucket:gt-1-tb-le-2-tb` | 부분실행 | 첫 증거 2026-11-14T03:47:36.705Z UTC | https://used-pick.com/price-analysis.html?model=hdd%3Ahgst%3Acapacity-bucket%3Agt-1-tb-le-2-tb&from=2026-10-15&to=2026-11-13 | evidence/10-hgst2-chart.png, evidence/16-popup-dates.png, evidence/18-popup-reload.png, evidence/20-popup-after-reload.png

- `hdd:hgst:capacity-bucket:gt-8-tb-le-12-tb` | 부분실행 | 첫 증거 2026-11-14T03:47:59.587Z UTC | https://used-pick.com/price-analysis.html?model=hdd%3Ahgst%3Acapacity-bucket%3Agt-8-tb-le-12-tb&from=2026-11-07&to=2026-11-07 | evidence/12-hgst12-no-data.png, evidence/13-hgst12-year.png, evidence/14-hgst12-reload.png, evidence/17-nzxt-search.png

- `psu:nzxt:watts-bucket:651-750` | 부분실행 | 첫 증거 2026-11-14T03:51:29.362Z UTC | https://used-pick.com/price-analysis.html?model=psu%3Anzxt%3Awatts-bucket%3A651-750&from=2026-09-16&to=2026-11-14 | evidence/19-nzxt651.png, evidence/21-nzxt651-year.png

- `psu:nzxt:watts-bucket:501-650` | 부분실행 | 첫 증거 2026-11-14T03:52:10.972Z UTC | https://used-pick.com/price-analysis.html?model=psu%3Anzxt%3Awatts-bucket%3A501-650&from=2026-09-16&to=2026-11-14 | evidence/22-nzxt501.png

- `cpu:intel:i3-6100` | 부분실행 | 첫 증거 2026-11-14T03:52:28.791Z UTC | https://used-pick.com/price-analysis.html?model=cpu%3Aintel%3Ai3-6100&from=2026-09-16&to=2026-11-13 | evidence/23-i36100-chart.png, evidence/24-i36100-wheel.png, evidence/25-i36100-wheel-recheck.png

- `cpu:intel:i5-6400` | 부분실행 | 첫 증거 2026-11-14T03:53:17.003Z UTC | https://used-pick.com/price-analysis.html?model=cpu%3Aintel%3Ai5-6400&from=2026-09-16&to=2026-11-13 | evidence/26-i56400.png

- `gpu:amd:rx-580` | 부분실행 | 첫 증거 2026-11-14T03:53:35.972Z UTC | https://used-pick.com/price-analysis.html?model=gpu%3Aamd%3Arx-580&from=2026-09-16&to=2026-11-13 | evidence/27-rx580.png

- `ram:samsung:ddr3:16gb` | 부분실행 | 첫 증거 2026-11-14T03:53:58.984Z UTC | https://used-pick.com/price-analysis.html?model=ram%3Asamsung%3Addr3%3A16gb&from=2026-09-16&to=2026-11-13 | evidence/28-ddr3-16.png

- `ram:samsung:ddr3:64gb` | 부분실행 | 첫 증거 2026-11-14T03:54:11.896Z UTC | https://used-pick.com/price-analysis.html?model=ram%3Asamsung%3Addr3%3A64gb&from=2026-09-16&to=2026-11-14 | evidence/29-ddr3-64.png

- `ssd:crucial:capacity-bucket:513-gb-1-tb` | 부분실행 | 첫 증거 2026-11-14T03:54:35.622Z UTC | https://used-pick.com/price-analysis.html?model=ssd%3Acrucial%3Acapacity-bucket%3A513-gb-1-tb&from=2026-09-16&to=2026-11-13 | evidence/30-crucial1tb.png, evidence/31-crucial1tb-sold.png

- `ssd:crucial:capacity-bucket:gt-4-tb-le-8-tb` | 부분실행 | 첫 증거 2026-11-14T03:54:52.107Z UTC | https://used-pick.com/price-analysis.html?model=ssd%3Acrucial%3Acapacity-bucket%3Agt-4-tb-le-8-tb&from=2026-09-16&to=2026-11-14 | evidence/32-crucial8tb.png

- `ssd:crucial:capacity-bucket:gt-8-tb` | 부분실행 | 첫 증거 2026-11-14T03:55:07.075Z UTC | https://used-pick.com/price-analysis.html?model=ssd%3Acrucial%3Acapacity-bucket%3Agt-8-tb&from=2026-09-16&to=2026-11-14 | evidence/33-crucial-over8.png

- `ssd:crucial:capacity-bucket:257-512-gb` | 부분실행 | 첫 증거 2026-11-14T03:55:15.294Z UTC | https://used-pick.com/price-analysis.html?model=ssd%3Acrucial%3Acapacity-bucket%3A257-512-gb&from=2026-09-16&to=2026-11-13 | evidence/34-crucial512.png

- `ssd:crucial:capacity-bucket:le-256-gb` | 부분실행 | 첫 증거 2026-11-14T03:55:25.177Z UTC | https://used-pick.com/price-analysis.html?model=ssd%3Acrucial%3Acapacity-bucket%3Ale-256-gb&from=2026-09-16&to=2026-11-13 | evidence/35-crucial256.png

- `psu:nzxt:watts-bucket:751-850` | 부분실행 | 첫 증거 2026-11-14T03:55:37.505Z UTC | https://used-pick.com/price-analysis.html?model=psu%3Anzxt%3Awatts-bucket%3A751-850&from=2026-09-16&to=2026-11-14 | evidence/36-nzxt850.png

- `psu:nzxt:watts-bucket:851-1000` | 부분실행 | 첫 증거 2026-11-14T03:55:52.262Z UTC | https://used-pick.com/price-analysis.html?model=psu%3Anzxt%3Awatts-bucket%3A851-1000&from=2026-09-16&to=2026-11-14 | evidence/37-nzxt1000.png

- `motherboard:msi:h110m-pro-d` | 부분실행 | 첫 증거 2026-11-14T03:56:07.396Z UTC | https://used-pick.com/price-analysis.html?model=motherboard%3Amsi%3Ah110m-pro-d&from=2026-10-08&to=2026-11-13 | evidence/38-h110.png

- `motherboard:asus:rog-crosshair-viii-impact` | 부분실행 | 첫 증거 2026-11-14T03:56:28.230Z UTC | https://used-pick.com/price-analysis.html?model=motherboard%3Aasus%3Arog-crosshair-viii-impact&from=2026-09-16&to=2026-11-13 | evidence/39-crosshair.png, evidence/40-no-result.png, evidence/41-restored-selected-model.png

## 미실행·다음 시작점
모델별 모든 필터조합·내부매물·정렬·페이지·리로드/뒤로가기·차트 모든 제어는 아직 끝나지 않았다. 모바일, 전체목록 확보, 내부집계 정확성은 미검증이다. B660 조합필터 이후 리로드복원, HGST2TB 정렬/페이지부터 이어간다. 세부 실행 집합은 run.json에 남겼다.

## 근거 재사용
오늘 부품누락 조사 PM9A3 M.2/U.2 후보와 소켓목록 근거는 재사용만 했고 이번 신규검사 수에 합산하지 않았다. 판매자 외부 링크 방문·로그인·등록·변경은 하지 않았다.

## 저장
HOME 및 Space 저장 결과는 별도 확인 후 run.json에 기록한다. 저장 성공 전 완료라고 표시하지 않는다.

### 저장 결과 갱신
HOME 지정 경로 저장·내용 재확인 완료. Space 정본은 기존 v69 최신 확인 후 병합했으나 준비 업로드 실패로 새 버전 반영되지 않았다. 재시도하지 않았으며 실행 JSON과82개 증거 파일은 작업 공간에 보존했다. 후속 최신판 병합이 필요하다.

