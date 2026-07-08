# VoicePick TODO

갱신: 2026-07-03

## 현재 구현 완료

- 웹 서버와 전사 엔진 분리
  - 메인 전사 엔진은 `transcription-child.mjs` / `isolated-pipeline-service.mjs`로 분리됨.
  - 엔진 child가 죽어도 웹 서버가 같이 죽지 않는 구조.

- 실시간 preview child process
  - `preview-child.mjs` / `isolated-preview-service.mjs` 추가 완료.
  - 노란 실시간 preview는 메인 전사 엔진과 별도 child에서 실행.
  - 최근 오디오 창만 빠르게 처리.
  - preview는 `ggml-base.bin + CPU`를 사용하고, 최종 전사는 `large-v3-turbo`를 사용.

- Local Agreement / 중복 제거
  - `transcript-agreement.mjs` 추가 완료.
  - preview 결과의 안정 구간과 임시 구간을 분리.
  - 이미 최종 전사에 들어간 문장은 preview에서 제거.
  - 반복 preview가 그대로 누적되는 문제 완화.

- 최종 문장 병합
  - 같은 화자의 가까운 segment를 문단처럼 병합.
  - 아래 최종 결과가 한 줄씩 과도하게 끊기지 않도록 개선.

- 마이크 / 컴퓨터 소리 입력 레벨 분리
  - `source-level` SSE 이벤트 추가.
  - UI에 `마이크 n% · 컴퓨터 n%` 표시.
  - `마이크+컴퓨터` 모드는 마지막 소리만 저장하는 구조가 아니라 두 입력을 합산하는 구조.

- 마이크 입력 gain 보정
  - USB 마이크 입력이 너무 작게 들어와 전사가 0개가 되는 문제 확인.
  - 마이크 입력에 기본 gain 8 적용.
  - gain 적용 후 마이크 레벨 테스트에서 전사 발생 확인.

- 마이크+컴퓨터 한국어 동시 입력 검증
  - `mixed` 모드에서 마이크 peak 약 23%, 컴퓨터 peak 약 54% 동시 감지.
  - 한국어 컴퓨터 음성 전사 정상 확인.
  - 두 입력 레벨이 동시에 올라가는 것 확인.
- 화자 cue fallback
  - `speaker-fallback.mjs` 추가.
  - 전사 텍스트에 `Speaker one/two`, `Speaker 1/2`, `화자 1/2` 단서가 있으면 최종 결과를 두 화자로 분리.
  - TTS 검증 샘플에서 fallback 적용 후 `SPEAKER_00`, `SPEAKER_01` 출력 확인.
- 기존 고아 WAV 파일 정리 기능
  - DB의 `recordings.audio_path`와 실제 `data/storage/recordings/*.wav`를 비교.
  - DB에 연결되지 않은 WAV만 목록화하고 삭제.
  - UI에 `WAV 정리` 버튼 추가.
  - 녹음 중에는 정리 버튼 비활성화.
- 녹음 삭제 시 WAV 파일 삭제
  - `storage.deleteRecording()`에서 DB 기록과 연결된 WAV 파일을 함께 삭제.
  - 삭제 대상은 녹음 저장 폴더 내부 파일로 제한.

- 테스트
  - `transcript-agreement.test.mjs`
  - `storage-delete.test.mjs`
  - `npm test` / `npm run check` 기준 통과 확인됨.

## 반복하지 말 것

- preview child process 새로 만들기
- Local Agreement 새로 만들기
- 최종 문장 병합 새로 만들기
- 삭제 시 WAV 파일 삭제 새로 만들기
- 마이크/컴퓨터 입력 레벨 표시 새로 만들기

## 남은 작업

### 1. 실제 사람 2명 음성으로 화자 분리 재검증

현재 최종 후처리에서 `diarization: true`를 child process 안에서 시도한다.
2026-07-03 TTS 검증에서는 원래 diarization 결과가 1명으로만 나왔고, `Speaker one/two` cue fallback을 적용한 뒤 두 화자로 복구됐다.
따라서 실제 사람 2명 음성에서 pyannote diarization 자체가 두 화자를 안정적으로 나누는지는 아직 별도 검증이 필요하다.

할 일:
- 실제 사람 2명이 번갈아 말하는 최소 30초 이상 샘플로 테스트.
- 최종 결과에서 `SPEAKER_00`, `SPEAKER_01`이 엔진 자체 결과로 나오는지 확인.
- 화자가 1명으로만 나오면 diarization 로그를 강화.
- cue가 없는 실제 대화에서도 가능한 fallback 기준을 검토.

### 2. 실제 강의 영상 + 마이크 동시 전사 품질 확인

TTS 기반 `mixed` 모드 검증에서는 마이크와 컴퓨터 입력이 동시에 감지되고 한국어 컴퓨터 음성 전사도 정상으로 확인됐다.
남은 것은 실제 유튜브/EBS/연수 영상과 사용자 마이크가 겹칠 때 Whisper가 한쪽을 생략하는지 확인하는 것이다.

할 일:
- 실제 강의 영상 재생 중 마이크로 동시에 말하기.
- 저장된 WAV를 직접 들어 두 소리가 모두 들어갔는지 확인.
- 최종 전사에서 강의 음성과 마이크 음성 중 한쪽이 생략되는지 확인.
- 겹친 음성 인식률이 낮으면 분리 저장 또는 소스별 전사 전략 검토.

### 3. 장시간 안정성 테스트

현재 짧은 테스트는 통과했지만 실제 수업용 앱은 장시간 안정성이 중요하다.

할 일:
- 마이크 녹음 10회 반복.
- 컴퓨터 소리 녹음 10회 반복.
- 마이크+컴퓨터 녹음 10회 반복.
- 녹음 시작 직후 바로 중지 테스트.
- 10분 이상 장시간 녹음 테스트.
- child process 오류 발생 시 UI에 `엔진 재시작 중` 상태 표시 검토.

### 4. 컴퓨터 소리 장치 안내 개선

Windows loopback은 기본 출력 장치 소리를 잡는다.
사용자가 유튜브/EBS 소리를 다른 출력 장치로 보내면 녹음되지 않을 수 있다.

할 일:
- UI에 현재 기본 출력 장치 이름을 더 눈에 띄게 표시.
- 안내 문구 추가: `영상 소리가 이 출력 장치로 나가야 녹음됩니다.`
- 가능하면 출력 장치 선택 기능 검토.

### 5. 아카이브 / 내보내기 개선

현재 녹음 목록과 삭제 기능은 있다.
수업 필기 앱으로 쓰려면 보관/내보내기 기능이 더 필요하다.

할 일:
- TXT / Markdown 내보내기.
- 저장 폴더 열기.
- 녹음 제목 수정.
- 오래된 녹음 정리.

### 6. 패키징

현재는 로컬 서버 웹앱 형태다.
배포 가능한 앱으로 쓰려면 패키징이 필요하다.

할 일:
- Electron 또는 Tauri 검토.
- 서버 자동 실행.
- 브라우저 대신 앱 창으로 실행.
- 모델/리소스 경로 고정.

## 다음 시작 순서

1. 실제 사람 2명 음성으로 화자 분리 재검증.
2. 실제 강의 영상 + 마이크 동시 전사 품질 확인.
3. 장시간 안정성 테스트.
4. 컴퓨터 소리 장치 안내 개선.
5. 아카이브 / 내보내기 개선.




## 2026-07-03 실제 환경 검증 기록

### 실제 사람 2명 화자 분리 60초 검증

- 녹음 ID: `a07d5e36-02ac-46fd-bea2-9aa4217e7ae1`
- duration: 약 62.6초
- maxMic: 약 19%
- avgMic: 약 8.9%
- interim 이벤트: 7회
- 최종 결과: segment 1개, speaker 없음, 텍스트 `[몇일이 없음]`
- 판정: 실패. 실제 대화 음성이 충분히 들어오지 않았거나 Whisper가 의미 있는 발화로 인식하지 못함.

### 실제 강의 영상 + 마이크 mixed 60초 검증

- 녹음 ID: `98fdb82d-cfd8-4640-85d3-b733a2504356`
- duration: 약 76초
- maxMic: 약 16%
- maxSystem: 약 67%
- avgMic: 약 8.2%
- avgSystem: 약 29%
- interim 이벤트: 9회
- 최종 결과: `(끝)` 1개
- 판정: 입력 레벨은 양쪽 모두 잡혔지만 전사 품질 실패. 실제 영상 음성이 말소리였는지, 언어가 한국어였는지, 음악/효과음 비중이 컸는지 확인 필요.

### 별도 TTS mixed 한국어 검증

- 녹음 ID: `8c0a06b1-d46d-4ee1-b566-d1d3945fcadf`
- maxMic: 약 23%
- maxSystem: 약 54%
- 한국어 컴퓨터 음성 전사 정상.
- 판정: mixed 입력 구조 자체는 정상. 실제 영상 품질 문제는 별도 확인 필요.

## 2026-07-03 mixed 모드 소스 분리 구현 기록

- mixed 모드에서 합쳐진 WAV 외에 `녹음ID-microphone.wav`, `녹음ID-system.wav`를 별도 저장하도록 구현.
- `recording_audio_sources` DB 테이블을 추가해 개별 WAV가 녹음 삭제/고아 파일 정리에서 누락되지 않도록 처리.
- 녹음 종료 시 mixed 모드는 마이크/컴퓨터 오디오를 각각 Whisper에 전사하고, 결과를 `마이크`, `컴퓨터 소리` 라벨로 시간순 병합.
- 개별 전사가 실패하거나 결과가 없으면 기존 mixed 최종 전사/화자 분리 경로로 fallback.
- `/api/recordings/:id/transcript` 응답에 `sourceAudioFiles`를 포함.
- 검증: `npm.cmd test`, `npm.cmd run check` 통과.

## 2026-07-03 mixed 소스 분리 최종 테스트 통과

- 테스트 ID: `dddebe23-c5b5-43d2-a474-b89c47971183`
- `마이크+컴퓨터` 녹음에서 다음 파일 3개 생성 확인:
  - mixed WAV: `dddebe23-c5b5-43d2-a474-b89c47971183.wav` 약 1.9MB
  - mic WAV: `dddebe23-c5b5-43d2-a474-b89c47971183-microphone.wav` 약 1.0MB
  - system WAV: `dddebe23-c5b5-43d2-a474-b89c47971183-system.wav` 약 1.0MB
- 최종 transcript speaker가 `컴퓨터 소리`로 표시됨.
- 자동 재생 WAV 문장 전사 성공.
- 발견/수정한 버그: `handleSourceAudioChunk()` 누락으로 소스별 WAV가 비어 있던 문제 수정.
- 검증: `npm.cmd test`, `npm.cmd run check` 통과.

## 2026-07-03 실제 사람 2명 화자 분리 재검증 2차

- 1차 테스트 ID: `71b8c2fc-a00d-4565-ae3d-3902e60e51a2`
  - duration: 약 70.4초
  - peak: 약 8.7%, RMS: 약 1.44%
  - Whisper 유효 구간: 약 2초
  - 결과: `UNKNOWN`, 텍스트 `아`
  - pyannote: speaker count no speakers detected
- 보완: 최종 offline Whisper/diarization 전에 `normalizeAudioForRecognition()` 적용.
- 2차 테스트 ID: `149aba08-bcbb-4de4-a22f-c005bf9d38dd`
  - duration: 약 70.4초
  - peak: 약 15.1%, RMS: 약 1.43%
  - Whisper 유효 구간: 약 4.1초
  - 결과: speaker 없음, 텍스트 `[놀람]`
  - pyannote: speaker count no speakers detected
- 판정: 실패. 현재 샘플은 실제 2명 화자 분리 검증용으로 충분한 사람 목소리가 들어오지 않았다. 마이크 위치/입력 장치/녹음 환경을 먼저 개선해야 함.
- 다음 조치:
  - 앱에 마이크 입력 품질 경고 추가: peak/RMS/발화 비율이 낮으면 `마이크가 너무 작습니다` 표시.
  - 테스트 화면 또는 안내 문구 추가: 두 사람이 마이크 30~50cm 안에서 번갈아 또렷하게 말해야 함.
  - 필요하면 마이크 기본 gain을 환경별로 조절하거나 AGC를 녹음 단계에 적용.

## 2026-07-03 마이크 입력 품질 진단 UI 구현

- 서버에서 최근 5초 마이크 오디오의 peak/RMS/발화 비율을 계산하는 `analyzeAudioQuality()` 추가.
- 녹음 중 `microphone-quality` SSE 이벤트를 1초 간격으로 전송.
- UI 미터 아래에 마이크 품질 패널 추가.
- 표시 상태:
  - `마이크 입력 정상`
  - `마이크에 더 가까이 말하세요`
  - `말소리가 거의 감지되지 않습니다`
  - `마이크 입력이 너무 작습니다`
  - `마이크 입력이 너무 큽니다`
- 실제 smoke test ID: `36a27225-3b49-4041-aae6-db69116841ed`
  - `microphone-quality` 이벤트 9개 수집 확인.
  - 마지막 상태: `weak`, 메시지 `마이크에 더 가까이 말하세요`.
- 검증: `npm.cmd test`, `npm.cmd run check` 통과.
