# VoicePick

![Release](https://img.shields.io/github/v/release/cybereun/voicepick?label=release)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4?logo=windows)
![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=nodedotjs&logoColor=white)
![Local First](https://img.shields.io/badge/local--first-offline%20STT-20c997)
![Whisper](https://img.shields.io/badge/engine-Whisper%20%2B%20pyannote-4dabf7)
![License](https://img.shields.io/badge/license-private-lightgrey)

VoicePick은 Windows에서 로컬로 실행되는 강의/회의 녹음 및 실시간 받아쓰기 앱입니다. 마이크, 컴퓨터 소리, 마이크+컴퓨터 소리를 녹음하고, 로컬 Whisper 엔진과 pyannote 계열 화자분리 엔진을 사용해 인터넷 없이 전사 결과를 만듭니다.

## 주요 특징

- **로컬 무제한 받아쓰기**: 브라우저 음성 인식 API가 아니라 PC 안의 Whisper 모델로 전사합니다.
- **마이크/컴퓨터 소리 녹음**: 마이크 입력, 시스템 오디오, 마이크+컴퓨터 혼합 모드를 지원합니다.
- **실시간 preview**: 녹음 중 최근 음성을 빠르게 분석해 노란 임시 문장으로 보여줍니다.
- **최종 전사 정리**: 녹음 중지 후 전체 오디오를 다시 분석해 최종 문장으로 정리합니다.
- **화자분리**: pyannote 기반 diarization 모델로 화자 라벨을 붙입니다.
- **마이크 품질 진단**: 입력 크기, RMS, 발화 비율을 보고 너무 작거나 큰 입력을 알려줍니다.
- **로컬 아카이브**: 녹음 목록과 전사 결과를 앱 내부 SQLite DB와 WAV 파일로 저장합니다.
- **녹음 삭제/고아 WAV 정리**: 목록 삭제 시 연결된 오디오 파일까지 제거하고, DB에 없는 WAV 정리 기능도 제공합니다.
- **Alt 독립 실행 배포본**: 릴리즈 포터블 패키지는 필요한 모델과 native 모듈을 포함해 Alt 앱 폴더 없이 실행됩니다.

## 다운로드

최신 릴리즈는 GitHub Releases에서 받을 수 있습니다.

- [VoicePick V1.0.0 릴리즈](https://github.com/cybereun/voicepick/releases/tag/V1.0.0)
- 완전 실행용: `VoicePick-v1.0.0-win-full.zip`
- 포함 파일: `VoicePick.exe`, Node 런타임, Whisper 모델, OpenVINO encoder, diarization/VAD 모델, native audio, pyannote, ffmpeg

> `VoicePick.exe`만 단독으로 받으면 전체 모델과 native 엔진이 없어서 완전 실행되지 않습니다. 일반 사용자는 반드시 `VoicePick-v1.0.0-win-full.zip`을 받아 압축을 푼 뒤 그 안의 `VoicePick.exe`를 실행하세요.

## 사용 방법

1. 릴리즈 페이지에서 `VoicePick-v1.0.0-win-full.zip`을 다운로드합니다.
2. 원하는 폴더에 압축을 풉니다.
3. 압축을 푼 폴더 안의 `VoicePick.exe`를 실행합니다.
4. 앱이 로컬 서버를 터미널 없이 실행하고 기본 브라우저에서 `http://127.0.0.1:5299`를 엽니다.
5. 녹음 모드를 선택합니다.
   - `마이크`: 내 목소리나 외부 마이크 입력만 녹음
   - `컴퓨터 소리`: 유튜브, EBS, 연수 영상 등 PC에서 나는 소리 녹음
   - `마이크+컴퓨터`: 강의 영상 소리와 내 마이크를 함께 녹음
6. `녹음 시작`을 누르고 말하거나 영상을 재생합니다.
7. 녹음 중에는 상단 preview 영역에 임시 전사 결과가 표시됩니다.
8. `녹음 중지`를 누르면 최종 전사와 화자분리 정리가 진행됩니다.
9. 왼쪽 녹음 목록에서 이전 녹음을 다시 선택하거나 삭제할 수 있습니다.

## 화면 구성

- **상단 컨트롤**: 녹음 시작/중지, 녹음 제목, 입력 소스, 마이크 장치, 언어, GPU backend, 화자분리 설정
- **입력 미터**: 현재 오디오 입력 레벨과 마이크 품질 상태 표시
- **실시간 preview**: 녹음 중 빠르게 표시되는 임시 문장
- **최종 결과 영역**: 녹음 중지 후 정리된 문장과 화자 라벨 표시
- **녹음 목록**: 저장된 녹음 세션 목록과 삭제/새로고침/WAV 정리 기능

## 개발 실행

개발 환경에서는 Node.js 24 이상이 필요합니다.

```powershell
cd H:\App-2026\Alt\VoicePick
npm start
```

브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:5299
```

검사 명령:

```powershell
npm test
npm run check
```

## 모델과 native 리소스

개발 실행 시 VoicePick은 다음 순서로 모델과 native 리소스를 찾습니다.

- `VOICEPICK_ALT_RESOURCES`
- `VoicePick\current\resources`
- 상위 폴더의 `current\resources`
- 기존 Alt 설치 경로

Whisper 모델은 다음 경로 후보를 사용합니다.

- `VOICEPICK_WHISPER_MODEL`
- `VoicePick\models\whisper\ggml-large-v3-turbo-q5_0.bin`
- 기존 `live-recorder\whisper-cpp` 경로

preview 모델은 다음 경로 후보를 사용합니다.

- `VOICEPICK_PREVIEW_MODEL`
- `VoicePick\models\whisper\ggml-base.bin`
- 기존 `live-recorder\whisper-cpp` 경로

환경변수로 직접 지정할 수도 있습니다.

```powershell
$env:VOICEPICK_ALT_RESOURCES="H:\App-2026\Alt\current\resources"
$env:VOICEPICK_WHISPER_MODEL="H:\App-2026\live-recorder\whisper-cpp\ggml-large-v3-turbo-q5_0.bin"
$env:VOICEPICK_PREVIEW_MODEL="H:\App-2026\live-recorder\whisper-cpp\ggml-base.bin"
npm start
```

## 아키텍처

```text
Browser UI
  -> Local HTTP/SSE server
  -> NativeAudioMixer
     -> microphone recorder
     -> system audio recorder
  -> preview child process
     -> recent 4.5s Whisper preview
  -> transcription child process
     -> Whisper final transcription
     -> pyannote diarization
  -> SQLite archive
  -> WAV storage
```

핵심 구성:

- `src/server.mjs`: 로컬 HTTP API와 정적 UI 서버
- `src/audio-mixer.mjs`: 마이크/시스템 오디오 입력 통합
- `src/recording-controller.mjs`: 녹음 세션, preview, 최종 정리, 저장 제어
- `src/pipeline-service.mjs`: Whisper/pyannote pipeline 래퍼
- `src/isolated-pipeline-service.mjs`: 전사 엔진 child process 격리
- `src/isolated-preview-service.mjs`: preview 엔진 child process 격리
- `src/storage.mjs`: SQLite DB와 WAV 파일 관리
- `public/`: 브라우저 UI
- `tools/`: Windows 런처와 설치기 소스

## 데이터 저장 위치

개발 실행 시 기본 저장 위치:

```text
VoicePick\data
```

주요 하위 폴더:

- `data\database\voicepick.db`: 녹음 목록과 전사 결과
- `data\storage\recordings`: WAV 녹음 파일

포터블 배포본은 압축을 푼 폴더의 `app\data` 아래에 저장합니다.

## 알려진 한계

- 실시간 preview는 빠른 임시 전사입니다. 최종 화자분리는 녹음 중지 후 전체 오디오를 다시 분석할 때 더 정확하게 정리됩니다.
- `마이크+컴퓨터` 모드는 두 입력을 함께 다루지만, 실제 환경의 장치 드라이버와 Windows 오디오 권한 상태에 영향을 받습니다.
- 큰 모델과 OpenVINO encoder를 포함한 전체 배포본은 용량이 큽니다.
- 현재 릴리즈는 Windows 로컬 앱을 목표로 하며 macOS/Linux 패키지는 제공하지 않습니다.

## 릴리즈 구성

`V1.0.0` 전체 포터블 패키지에는 다음이 포함됩니다.

- `VoicePick.exe`
- Node.js 런타임
- Whisper `large-v3-turbo-q5_0`
- Whisper `base` preview 모델
- OpenVINO encoder 모델
- diarization 모델
- VAD 모델
- `native-audio-node`
- `pyannote-cpp-node`
- `ffmpeg`

## 개발 상태

이 저장소는 VoicePick의 로컬 앱 MVP와 Windows 포터블 배포 구성을 포함합니다. 목표는 수업, 회의, 영상 강의 환경에서 인터넷 없이 자동 필기를 수행하는 안정적인 로컬 녹음 앱입니다.
