# 저시력 고령자를 위한 AI 알약 인식 앱

React + Vite + Tailwind CSS로 만든 프로젝트입니다.

## 로컬에서 실행하기 (선택사항)

```bash
npm install
npm run dev
```

`http://localhost:5173` 에서 확인할 수 있습니다. (카메라는 로컬/https 환경에서만 정상 동작합니다)

## 공공 API 키 설정 (선택사항)

`.env.example` 파일을 복사해서 `.env` 파일을 만들고, 발급받은 공공데이터포털 서비스 키를 넣어주세요.

```bash
cp .env.example .env
```

키를 넣지 않으면 데모용 샘플 데이터로 동작합니다.

## Netlify에 배포하기

### 방법 A. 폴더 그대로 드래그 앤 드롭 (가장 간단)

1. 이 폴더에서 아래 명령어로 빌드합니다.
   ```bash
   npm install
   npm run build
   ```
2. 생성된 **`dist` 폴더만** [Netlify Drop](https://app.netlify.com/drop) 페이지에 드래그 앤 드롭하면 바로 배포됩니다.

### 방법 B. GitHub 연동 (자동 재배포)

1. 이 폴더 전체를 GitHub 저장소에 올립니다.
2. Netlify → "Add new site" → "Import an existing project" → 방금 만든 저장소 선택
3. 빌드 설정은 자동으로 인식되지만, 확인 차 아래처럼 입력해주세요.
   - Build command: `npm run build`
   - Publish directory: `dist`
4. "Deploy site" 클릭

`netlify.toml` 파일에 위 빌드 설정이 이미 들어있어서 Netlify가 자동으로 인식합니다.

## 참고

- 카메라(`getUserMedia`)는 브라우저 보안 정책상 **https 주소** 또는 **localhost**에서만 동작합니다. Netlify 배포 주소는 기본적으로 https라 정상 동작합니다.
- 공공데이터포털 API는 브라우저에서 직접 호출 시 CORS로 막힐 수 있습니다. 막힐 경우 서버(Netlify Functions 등)를 통한 프록시 호출을 권장합니다.
