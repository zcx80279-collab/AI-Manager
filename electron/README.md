# Electron Windows 데스크톱 실행 안내

이 디렉터리는 AI 중앙통제실 V0.1의 Windows 데스크톱(Electron) 실행 환경을 위한 분리 구조입니다.

## 보안 및 설계 원칙
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` 적용
- `electron/preload.ts`에서 허용된 6개 채널(`control-center:*`)만 노출
- AI가 생성한 텍스트를 OS 쉘(`cmd.exe`, `powershell.exe`, `bash`)에 직접 전달하지 않음
- CLI 실행은 `execFile` 기반 고정 바이너리/인자 배열 및 사용자 승인 플래그(`userApprovedExecution === true`) 확인 후에만 수행
- 로컬 업무 기록은 OS 사용자 데이터 경로(`app.getPath('userData')/control-center-store.json`)에 저장되며 Git 저장소에 포함되지 않음
