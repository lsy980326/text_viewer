# NOVELIER

NOVELIER는 macOS, Windows, iOS, Android에서 사용할 수 있도록 설계한
로컬 우선 TXT 소설 뷰어입니다. 하나의 Tauri 2 + React + TypeScript
코드베이스에서 가로 페이지, 세로 스크롤, 검색, 북마크, 글자 수, 읽기
설정과 플랫폼별 투명 경험을 제공합니다.

현재 저장소에는 반응형 리더, TXT 가져오기, 로컬 영속 저장, 검색,
북마크, 읽기 설정, 간단보기, 집중 모드, 데스크톱 몰래보기 미니 창,
프레임리스 투명 모드와 Tauri 네이티브 셸이 구현되어 있습니다. 최신
본문 드래그 차단·몰래보기 투명도 연동 UI 소스로 macOS arm64 개발
앱을 다시 만들고 ad-hoc 서명·기동까지 확인했습니다. Android arm64
APK는 음량 버튼, 네이티브 safe-area, 실제 문서 제목과 다크 시스템
바, 빠르고 안정적인 provider TXT 가져오기, 상·하단 전용 UI 호출
영역과 숨김 상태의 본문까지 포함한 세로·양방향 가로 시스템 바 보호를
적용하고, 가로 페이지의 마지막 줄을 실제 렌더링 경계로 재검사하는
0.1.7 release
빌드로 최적화했으며, 334 MiB 디버그
산출물을 14.2 MiB 설치용 APK로 교체하고 서명을 확인했습니다.
Windows NSIS는 PC 단순화 작업 전
소스이므로 배포 전 다시 빌드해야 합니다.
iOS는 생성 Xcode 프로젝트와 Rust 타깃까지 준비됐으며, 현재
호스트에 전체 Xcode·Apple iOS SDK·Simulator runtime이 없어 `.app`
생성만 차단되어 있습니다.

## 제품 방향

- TXT 파일과 독서 기록을 외부 서버로 전송하지 않는 로컬 전용 구조
- 파일명에서 만든 제목과 로컬 생성 표지
- 데스크톱 3단 레이아웃과 모바일 한 열 리더
- PC의 네 가지 핵심 메뉴: 내 서재, 페이지 이동, 북마크, 읽기 설정
- 중복 진입점을 없앤 통합 `화면 설정`과 접힌 고급 타이포 설정
- 데스크톱 간단보기와 `720×560` 문맥 드로어
- 타이틀바의 단일 `몰래보기` 진입점과 `430×760` 모바일형 미니 창
- 몰래보기 진입 시 간단보기·28% 배경·항상 위와 전체 도구 숨김 자동 적용
- 데스크톱 프레임리스 투명 창, 모바일 반투명 도구 UI
- 글꼴·크기·간격·테마·밝기와 집중 모드
- Android 리더의 기본 활성 음량 버튼 페이지 넘김
  (올림: 이전, 내림: 다음)
- Android의 현재·안정 navigation inset과 60px 최소 보호 여백 위로
  진행 정보·도구 라벨뿐 아니라 숨김 상태의 소설 본문 뷰포트 자체를
  올리는 safe-area 연동
- 가로 페이지의 모든 실제 줄 경계를 측정해 마지막 줄이 본문 경계
  안에 완전히 들어오지 않으면 줄 전체를 다음 페이지로 재배치
- 휴대폰 가로 회전에서는 시스템 버튼이 어느 쪽으로 이동해도 본문,
  진행 정보와 도구가 겹치지 않도록 좌우 각각 최소 60px 보호
- 숨김 상태에서는 실제 상·하단 바가 차지하는 영역만 UI를 다시 여는
  터치 분리. 본문 좌·우·가운데 탭은 숨긴 UI를 열지 않음
- 문서 제공자의 실제 파일명 조회와 해시 검증 제목 복구
- metadata 조회를 지원하지 않는 Android 문서도 직접 읽는 가져오기
- 긴 단일 문단의 저메모리 분할과 SQLite 본문 블록 일괄 저장
- `8~36px` 본문 글꼴, 중립 슬라이더와 수동 저장 다크 테마
- Unicode 기준 전체/현재 화면 글자 수
- 원문 복사 없는 offset 페이지와 최대 59문단 세로 가상화
- 소설 본문의 실수 선택·선택문 드래그 차단
- 배경 농도 `0~100%`, 본문 글자·일반 아이콘은 항상 100% 불투명
- 화면 설정의 `100 / 82 / 55 / 0%` 배경 프리셋 자동 적용
- 배경과 함께 희미해지고 hover·focus에서 드러나는 몰래보기 농도
  슬라이더
- 몰래보기 본문 좌·우 탭은 이전·다음, 가운데 탭은 독서 도구 숨김,
  상단 빠른 설정까지 숨긴 뒤 상·하단 조작 영역 탭으로만 복원
- 몰래보기 상단의 창 이동, 안전 접기와 일반 PC 창 즉시 복원
- `Cmd/Ctrl+Shift+M` 몰래보기 전환,
  `Cmd/Ctrl+Shift+H` 전역 안전 접기/복구
- `Cmd/Ctrl+Shift+S` 간단보기, `Cmd/Ctrl+Shift+T` 투명 모드,
  `Cmd/Ctrl+Shift+0` 안전 복구

몰래보기 기능은 macOS와 Windows에만 표시됩니다. iOS·Android에서는
버튼과 단축키를 노출하지 않으며, 몰래보기 중 새로고침해도 저장한
일반 PC 창의 크기와 위치로 복구됩니다.

Android 앱에서는 `글꼴 → 읽기 설정`의 `음량 버튼으로 페이지
넘기기`가 기본으로 켜져 있으며, 리더가 활성 상태일 때만 음량
올림/내림으로 이전/다음 읽기 구간을 이동합니다. 사용자가 끈 값은
이후에도 보존되고, 서재나 바텀시트에서는 캡처를 즉시 풀어 시스템
음량 조절을 보존합니다. iOS는 공개 API로 물리 음량 버튼을
페이지 키로 안전하게 가로챌 수 없고 표준 스위치 기능 변경은 App Store
심사 제약이 있으므로 이 옵션을 노출하지 않습니다. iPhone/iPad에서는
기존 좌우 탭·스와이프와 외장 키보드 방향키를 사용합니다.

PC와 모바일 참고 이미지는 디자인 검증에만 사용하며 앱 패키지에는
포함하지 않습니다.

## 문서

- [프로젝트 계획](./docs/PROJECT_PLAN.md)
- [UI 명세](./docs/UI_SPEC.md)
- [몰래보기 상단 이동·자동 접기 계획](./docs/STEALTH_AUTO_FOLD_PLAN.md)
- [오케스트레이션 로그](./docs/ORCHESTRATION_LOG.md)
- [에이전트 작업 규칙](./AGENTS.md)

## 개발 환경

기본 도구:

- Node.js 20 이상
- pnpm 10
- Rust stable 및 Cargo
- 대상 플랫폼에 필요한 [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)

iOS 빌드에는 macOS의 전체 Xcode, iOS SDK와 Simulator runtime이
필요합니다. Android 빌드에는 Android SDK·NDK가 필요하고, Windows
NSIS cross-build에는 MSVC Rust 타깃, `cargo-xwin`, LLVM/LLD와 NSIS가
필요합니다. 생성된 Windows 패키지의 설치·투명 창·몰래보기 geometry·
단축키·자동 항상 위 동작은 Windows 환경에서 별도 검증해야 합니다.

```bash
pnpm install
pnpm dev
```

`pnpm dev`는 웹 UI 개발 서버를 실행합니다. Tauri 프로젝트가 구성된
뒤에는 다음 명령으로 플랫폼 개발 셸을 실행합니다.

```bash
pnpm desktop
pnpm android
pnpm ios
```

## 품질 확인

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm tauri build --debug --no-bundle
pnpm tauri build --debug --bundles app
```

`test:e2e`는 여섯 Playwright 프로젝트의 기본 승인 크기와 별도
`430×720` 몰래보기 스냅샷, 리더 상호작용, 접근성 이름, overflow,
네이티브 좁은 데스크톱과 고비용 리더 계약을 검사합니다. 실제
네이티브 몰래보기 창 목표는 타이틀바를 포함한 `430×760`입니다.
현재 Vitest는 14개 파일의 74개 테스트를 통과합니다.
Playwright는 여섯 프로젝트에서 90개 case를 발견하며 49개를 실행해
통과했고 범위가 맞지 않는 41개는 의도적으로 skip합니다. 실제 성공
결과와 플랫폼 산출물은
[오케스트레이션 로그](./docs/ORCHESTRATION_LOG.md)에 기록합니다.

## 현재 구현·검증 범위

- UTF-8/BOM, UTF-16 LE/BE, CP949/EUC-KR, CRLF, 빈 파일, 50MB 제한
- Unicode grapheme 글자 수, 문단 블록, 안정적 읽기 locator
- 원문을 복제하지 않는 UTF-16 offset 페이지와 Unicode 경계 보호
- 최대 59문단 가상 창 및 50MiB 형태 단일문단 5초 성능 가드
- 메모리 구현 기반 저장소·persistence 변환 계약과 브라우저
  IndexedDB 가져오기 흐름
- 데스크톱 3단·2단, 모바일 세로·가로 화면의 시각 회귀
- `720×560` 데스크톱 타이틀바·320px 드로어·간단보기 복구
- `430×760` 데스크톱 몰래보기 모바일형 레이아웃과 일반 창 복구
- 몰래보기 상단 농도 조절 바의 투명도 연동과 본문 선택·드래그 차단
- 검색, 페이지 이동, 북마크, 간단보기, 투명 모드, 집중 모드와
  다이얼로그 포커스 복구
- 가로↔세로 및 집중 모드 복귀 후 첫 가시 문단 ±1문단 유지
- 페이지 재계산 중 이전 전체 페이지 수를 숨기고 직접 입력을 잠그는
  계산 상태 구현

## 플랫폼 빌드 상태

| 플랫폼 | 현재 상태 | 남은 확인 |
| --- | --- | --- |
| macOS | 최신 본문 드래그 차단·투명도 연동 UI 소스로 arm64 개발 앱 재빌드·ad-hoc 서명·기동, 엄격 번들 검증 완료 | 실제 배경 위 투명 합성 장시간 수동 확인 |
| Windows | 이전 소스의 x64 MSVC 앱과 unsigned NSIS cross-build·구조 검사 완료 | 최신 소스 재빌드 후 Windows 설치·기동·투명 창·몰래보기 geometry/단축키 |
| Android | 0.1.7/code 1007의 14.2 MiB arm64 release APK 빌드·v2/v3 개발 서명·16 KiB 정렬, Android 16 Pixel 7 에뮬레이터에서 UI 표시·숨김 가로 페이지의 완전한 마지막 줄과 세로·양방향 가로 제스처/3버튼 화면 검증 완료 | 실제 사용자 기기에서 문서 provider·음량 키와 제조사별 시스템 UI 최종 확인 |
| iOS | 생성 Xcode 프로젝트, 양쪽 iOS Rust 타깃과 리소스 검증 | 전체 Xcode·iOS SDK·Simulator runtime 설치 후 `.app` |

Windows 개발 설치 파일은 다음 명령으로 재현합니다.

```bash
pnpm windows:nsis:cross:debug
```

Android SDK·NDK 환경을 준비한 뒤 휴대폰 설치용 최적화 APK는 다음
명령으로 생성합니다. 이 명령은 arm64 release 빌드와 Rust 심볼 제거,
Android 코드·리소스 축소를 적용합니다. 배포 전에 별도의 정식
키스토어로 서명해야 하며, 저장소의 현재 산출물은 로컬 설치 확인용
Android debug 키로 서명했습니다.

```bash
pnpm android:build:release
```

`pnpm mobile:sync`는 커밋 대상인 Android 호스트 템플릿을 생성된
`src-tauri/gen/android` 프로젝트에 동기화합니다. `pnpm android`,
`pnpm android:build:debug`, `pnpm android:build:release`와 Tauri의
dev/build 전처리 명령이 이를 자동 실행하므로 Android 프로젝트를 다시
초기화해도 음량 키 브리지와 release 리소스 축소 설정이 복원됩니다.

전체 Xcode를 설치한 호스트에서는 생성된 iOS 프로젝트로 unsigned
Simulator 빌드를 이어갑니다.

```bash
pnpm tauri ios build --debug --target aarch64-sim --no-sign --ci
```

`src-tauri/gen/`은 생성물이라 Git에 포함하지 않습니다. 새 checkout은
빌드 전에 플랫폼 프로젝트를 한 번 초기화해야 합니다.

```bash
pnpm tauri android init --ci
pnpm tauri ios init --ci --skip-targets-install
```

## 개발 산출물

현재 최신 소스에서 다시 만든 macOS 개발 앱은
`src-tauri/target/debug/bundle/macos/NOVELIER.app`입니다. 기동,
ad-hoc 서명과 엄격 번들 검증을 확인했습니다.

저장소에 남아 있는 Windows NSIS는 이전 승인 작업의 개발 산출물이며
현재 소스와 같은 릴리스로 간주하지 않습니다. 최신 Android 설치 APK는
`src-tauri/gen/android/app/build/outputs/apk/universal/release/NOVELIER-0.1.7-arm64-optimized.apk`
이며 크기는 14,882,298 bytes, SHA-256은
`d26e2ae5a5e73cc2ce60835e81f4c25b88e6dc8a256a068450b67efc30499369`
입니다. Android 16 Pixel 7 에뮬레이터의 3버튼 내비게이션에서
상·하단 UI를 표시하거나 숨긴 가로 페이지 모두 마지막 글줄이 온전히
표시되고 시스템 버튼 위에서 끝나는 것을 확인했습니다. 실제 음량 키
입력은 실기기 승인 항목으로 남습니다.

## 개인정보 보호

NOVELIER는 계정이나 외부 콘텐츠 API를 사용하지 않는 것을 기본으로
합니다. 소설 본문, 가져온 파일명, 인증 정보는 진단 로그나
오케스트레이션 로그에 기록하지 않습니다.

오프라인 본문 글꼴의 고지는 [Third-party notices](./THIRD_PARTY_NOTICES.md)에
있으며 SIL Open Font License 전문도 앱 번들에 포함됩니다.
