# 공무 Windows 원격 검증 체크리스트

## 목적

크롬 원격 데스크톱으로 접속한 Windows PC에서 공무 Alpha를 실제 설치/실행/복구까지 검증한다.

## 시작 전에 준비할 것

- 이 저장소 최신 코드
- Node.js / npm
- Rust + cargo
- Python 3.11 이상
- WebView2 런타임
- 크롬 원격 데스크톱 접속 가능 상태

## 1. 사전 확인

- [ ] `git rev-parse HEAD`로 현재 커밋 기록
- [ ] `node -v`
- [ ] `npm -v`
- [ ] `python --version`
- [ ] `cargo --version`
- [ ] WebView2 설치 여부 확인

기록할 값:

- 테스트 날짜:
- 테스트 PC 이름:
- Windows 버전:
- 현재 커밋 SHA:

## 2. 기본 검증

루트에서 실행:

```bash
npm install
npm run verify:all
```

체크:

- [ ] sidecar 테스트 통과
- [ ] desktop 테스트 통과
- [ ] desktop build 통과
- [ ] cargo check 통과

## 3. 데스크톱 번들 생성

```bash
npm run desktop:bundle
npm run release:alpha
```

체크:

- [ ] `apps/desktop/src-tauri/target/release/bundle/` 생성
- [ ] `release/alpha/manifest.json` 생성
- [ ] `release/alpha/README.md` 생성

기록:

- bundle 산출물 경로:
- bundle target 종류:

## 4. 앱 실행 확인

가능하면 번들 산출물로 실행하고, 어려우면 개발 모드로 대체 확인:

```bash
npm run sidecar:serve
```

새 터미널:

```bash
npm run desktop:dev
```

체크:

- [ ] 앱이 정상 실행됨
- [ ] 헤더에 런타임 상태가 표시됨
- [ ] `기타 환경설정`에서 경로/정책 값이 보임

## 5. 핵심 사용자 흐름 검증

### 일정/업무대화

- [ ] 일정 1건 생성
- [ ] 업무세션 1건 생성
- [ ] 참고자료 묶음 1건 생성

### 문서작성

- [ ] `ContentBase.md 생성`
- [ ] 최종 저장 요청
- [ ] 승인 후 최종 저장 적용
- [ ] `runtime-workspace/documents/outputs/`에 산출물 생성

### 지식폴더

- [ ] 지식 반영 후보 확인
- [ ] 반영 승인
- [ ] 검색 결과와 graph 요약 표시 확인

### 파일정리

- [ ] 파일정리 제안 생성
- [ ] 적용 요청
- [ ] 승인 후 적용
- [ ] rollback 가능 여부 확인

## 6. sidecar 복구 검증

목표: 관리 중인 sidecar가 비정상 종료되면 desktop이 1회 자동 재시작을 시도하는지 확인

방법:

1. 앱에서 `사이드카 시작` 상태를 만든다.
2. Windows 작업 관리자에서 Python sidecar 프로세스를 강제 종료한다.
3. 5초 정도 기다린다.

체크:

- [ ] UI에 비정상 종료 상태가 잠깐 보이거나 상태가 갱신됨
- [ ] 자동 재시작 후 다시 연결 정상 상태가 됨
- [ ] 로그 파일이 생성/갱신됨

로그 위치:

- `runtime-workspace/logs/sidecar-runtime.log`

## 7. Anything 외부 연계 확인

- [ ] `로컬파일/정보검색` 메뉴 진입
- [ ] Anything 실행 요청
- [ ] 승인 큐 등록 확인
- [ ] 외부 실행 정책상 문제 없는지 확인

메모:

- Anything 사전 설치 여부:
- 실제 외부 실행 성공 여부:

## 8. 결과 기록

### Pass / Fail 요약

- [ ] 기본 검증
- [ ] 번들 생성
- [ ] 앱 실행
- [ ] 일정/업무대화
- [ ] 문서작성
- [ ] 지식폴더
- [ ] 파일정리
- [ ] sidecar 자동 복구
- [ ] Anything 연계

### 장애 메모

- 증상:
- 재현 절차:
- 로그 경로:
- 스크린샷 위치:

## 9. 검증 후 바로 알려줄 것

아래 네 가지만 알려주면 다음 수정 우선순위를 바로 정할 수 있다.

1. 번들 생성 성공/실패
2. 앱 첫 실행 성공/실패
3. sidecar 자동 재시작 성공/실패
4. Anything 외부 실행 성공/실패
