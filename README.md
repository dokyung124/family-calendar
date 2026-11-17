# 👨‍👩‍👧 가족캘린더 설치 가이드

가족 3명이 아이폰 홈 화면에 추가해서 쓰는 캘린더 웹앱이에요.

- 회원가입할 때 **성을 뺀 이름 2글자**를 입력해요. 이 이름이 일정과 알림에 표시돼요.
- 각자 자기 일정을 등록하고, 가족 모두가 서로의 일정을 볼 수 있어요.
- 푸시 알림은 이렇게 와요.

| 언제 | 무엇을 | 누구에게 |
|---|---|---|
| 일정 당일 **오전 10시** | 그날 시작하는 가족 일정 전부 (예: "• 민정 · 치과 10:30") | **가족 일정 알림**을 켠 사람 (처음엔 켜져 있음) |
| 청약 마감일 **오전 10시** | 📌 청약 마감 종목 상세 (예: "· 동원파츠 - 삼성 (23,000)") | **청약 마감 알림**을 켠 사람 |
| 상장 전날 **밤 10시** | 📈 내일 상장 종목 상세 | **상장 알림**을 켠 사람 |

- 공모주는 캘린더에 종목 이름 없이 **"청약마감", "상장"만 작고 흐리게** 보여요. 여러 종목이면 "청약마감 3"처럼 개수가 붙어요. 종목 상세 내용은 알림으로만 받아요.
- 가족 일정이 우선이에요. 그날 일정이 3개 이상이면 공모주 표시는 숨겨져요.
- 알림을 보낼 일정이 없는 날에는 알림이 오지 않아요.
- 알림은 오른쪽 위 내 이름 동그라미 → **마이페이지 → 알림 설정**에서 하나씩 켜고 끌 수 있어요. 공모주 알림 두 가지는 처음에 꺼져 있어요.

## 폴더 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 앱 화면 전체 |
| `config.js` | Supabase 주소·키 설정 (**2단계에서 채우기**) |
| `sw.js`, `manifest.webmanifest`, `icons/` | 홈 화면 앱·알림용 파일 |
| `tools/vapid-keys.html` | 알림 키 만드는 도구 (한 번만 사용) |
| `supabase/1_tables.sql` | 데이터베이스 테이블 |
| `supabase/functions/notify/index.ts` | 알림 보내는 함수 (공모주 일정 가져오기 포함) |
| `supabase/2_schedule.sql` | 오전 10시·밤 10시 실행 예약 |

> 💡 `config.js`를 비워 둔 채로 열면 **데모 모드**(가짜 데이터)로 화면만 미리 볼 수 있어요.

---

## 1단계 · Supabase 프로젝트 만들기

1. [supabase.com](https://supabase.com) → **New project**
   - 커플 캘린더와 섞이지 않게 **새 프로젝트**로 만드는 걸 추천해요.
   - Region은 **Northeast Asia (Seoul)**을 고르세요.
2. 왼쪽 메뉴 **SQL Editor** → `supabase/1_tables.sql` 내용을 전부 붙여넣고 **Run**을 누르세요.
3. 왼쪽 메뉴 **Authentication** → **Sign In / Providers** → **Email**에서 **Confirm email**을 꺼 주세요.
   - 이걸 꺼야 가입 후 메일 확인 없이 바로 로그인돼요.

## 2단계 · 알림 키 만들고 config.js 채우기

1. `tools/vapid-keys.html`을 더블클릭해서 크롬이나 사파리로 연 다음 **키 만들기**를 누르세요.
   - 나오는 **공개 키**와 **비공개 키**를 메모장에 저장해 두세요. 이 키는 다시 만들지 마세요.
2. Supabase **Project Settings → API**(또는 Data API, API Keys)에서 다음 두 값을 확인하세요.
   - **Project URL**
   - **anon public** 키 (Publishable key라고 표시될 수도 있어요)
3. `config.js`를 텍스트 편집기로 열어서 세 값을 채우세요.
   ```js
   SUPABASE_URL: "https://abcdxyz.supabase.co",
   SUPABASE_ANON_KEY: "eyJhbGciOi... 또는 sb_publishable_...",
   VAPID_PUBLIC_KEY: "BMx... (공개 키)",
   ```

## 3단계 · 알림 함수 올리기

1. 왼쪽 메뉴 **Edge Functions** → **Deploy a new function** → **Via Editor**를 선택하세요.
2. 함수 이름을 정확히 **`notify`**로 입력하세요.
3. 기본 코드를 모두 지우고 `supabase/functions/notify/index.ts` 내용을 붙여넣은 뒤 **Deploy**를 누르세요.
4. 배포된 함수의 **Details(설정)**에서 **Verify JWT / Enforce JWT verification**을 **끄고** 저장하세요.
   - 함수 안에서 직접 확인하고 있어서 괜찮아요. 이걸 켜 두면 예약 실행이 막혀요.
5. **Edge Functions → Secrets**(또는 Project Settings → Edge Functions)에 아래 5개를 추가하세요.

| 이름 | 값 |
|---|---|
| `VAPID_PUBLIC_KEY` | 2단계 공개 키 |
| `VAPID_PRIVATE_KEY` | 2단계 비공개 키 |
| `VAPID_SUBJECT` | `mailto:내이메일@gmail.com` |
| `CRON_SECRET` | 아무 긴 문자열 (예: `family-8am-x7k2p9`) |
| `IPO_CLOSING_ICS_URL` | 청약 캘린더 (아래 주소 그대로 복사) |
| `IPO_LISTING_ICS_URL` | 상장 캘린더 (아래 주소 그대로 복사) |

**청약 캘린더** (`IPO_CLOSING_ICS_URL`)
```
https://calendar.google.com/calendar/ical/gjbox0301%40gmail.com/public/basic.ics
```
**상장 캘린더** (`IPO_LISTING_ICS_URL`)
```
https://calendar.google.com/calendar/ical/6ece61bb8be35674d49e32ddd31247808effcc2c6001235f154b8e9e28fab902%40group.calendar.google.com/public/basic.ics
```

> ✅ **주소 확인 방법:** 위 주소를 PC 크롬에 붙여넣어 보세요. `.ics` 파일이 내려받아지거나 `BEGIN:VCALENDAR`로 시작하는 글자가 보이면 정상이에요. **404 오류**가 나오면 그 캘린더가 공개 상태가 아니에요. 그럴 땐 캘린더 관리자에게 '공개' 설정을 부탁하거나, 관리자의 '비공개 주소(iCal 형식)'를 받아 대신 넣으면 돼요.
>
> 제목 앞에 (청약)/(상장) 표시가 있으면 그 표시를 따르고, 표시가 없는 일정은 어느 캘린더에서 왔는지로 구분해요. (권리공매도) 같은 다른 표시는 빼요.

> 공모주 주소를 비워 두면 가족 일정 알림만 와요.
>
> 공모주 일정은 알림 함수가 실행될 때(오전 10시·밤 10시)마다 새로 가져와요. 주소를 넣은 직후 캘린더에 바로 보이게 하려면, 마이페이지에서 **테스트 알림**을 한 번 눌러 주세요.

## 4단계 · 오전 10시·밤 10시 예약

1. `supabase/2_schedule.sql`을 열고, 두 군데씩 나오는 값을 **모두** 바꾸세요.
   - `① 프로젝트주소` → Project URL (예: `https://abcdxyz.supabase.co`)
   - `② 크론비밀번호` → 위에서 정한 `CRON_SECRET` 값
2. **SQL Editor**에 붙여넣고 **Run**을 누르세요.
   - 맨 아래에 `family-10am`과 `family-10pm` 두 줄이 보이면 성공이에요.
   - Supabase는 UTC 시간을 써요. 그래서 UTC 1시가 한국 오전 10시, UTC 13시가 한국 밤 10시예요.

## 5단계 · GitHub Pages로 배포

1. GitHub에 새 저장소(예: `family-calendar`)를 만들고, 이 폴더의 파일을 **전부** 업로드하세요.
   - `config.js`를 채운 상태로 올려야 해요. anon 키는 공개돼도 괜찮은 키예요.
   - **비공개 키는 절대 올리지 마세요.** 비공개 키는 Supabase Secrets에만 넣어요.
2. 저장소 **Settings → Pages** → Branch를 `main`, 폴더를 `/ (root)`로 선택하고 **Save**를 누르세요.
3. 1~2분 뒤 `https://내아이디.github.io/family-calendar/` 주소로 열려요.

## 6단계 · 가족 각자 아이폰에서 (iOS 16.4 이상)

1. **사파리**로 위 주소를 여세요.
2. **공유 버튼(□↑)** → **홈 화면에 추가**를 누르세요.
3. 홈 화면의 **가족캘린더 아이콘**으로 앱을 여세요. ⚠️ 사파리 탭에서 쓰면 알림이 오지 않아요.
4. **처음이에요 · 회원가입** → 이름(성을 뺀 2글자), 이메일, 비밀번호를 입력하세요. 일정 색은 자동으로 정해지고, 마이페이지에서 바꿀 수 있어요.
5. 위쪽 노란 안내의 **알림 켜기** → **허용**을 누르세요.
6. 오른쪽 위 내 이름 → **마이페이지 → 알림 설정**에서 받을 알림을 켜세요. 공모주 알림을 받을 사람은 청약 마감·상장 알림을 켜면 돼요.
7. 같은 화면에서 **테스트 알림 → 보내기**를 눌러서 알림이 오면 완료예요 🎉

> 🔒 가족 3명이 모두 가입했다면 Supabase **Authentication → Sign In / Providers**에서 **Allow new users to sign up**을 꺼 주세요. 다른 사람이 가입하는 걸 막을 수 있어요.

---

## 알림이 안 올 때

- **홈 화면 아이콘으로 열었는지** 확인하세요. 사파리 탭에서 쓰면 알림이 오지 않아요.
- 아이폰 **설정 → 알림 → 가족캘린더**가 켜져 있는지 확인하세요. 집중 모드에서는 알림이 숨겨질 수 있어요.
- 테스트 알림에서 "등록된 알림이 없어요"가 나오면, 마이페이지에서 **알림 켜기**를 다시 누르세요.
- 테스트 알림에서 오류가 나면 Supabase **Edge Functions → notify → Logs**에서 오류 내용을 확인하세요.
- 테스트 알림은 오는데 예약된 시간에만 오지 않으면, SQL Editor에서 아래를 실행해 실행 기록을 확인하세요.
  ```sql
  select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
  ```

## 공모주 알림 규칙

- `(청약) 종목 - 증권사 (…)` → 청약 기간의 **마지막 날**에 "청약마감"으로 표시하고, 그날 오전 10시에 원래 제목 그대로 상세 알림 (예: "· 동원파츠 - 삼성 (23,000)")
- `(상장) 종목` → 상장일에 "상장"으로 표시하고, **전날 밤 10시**에 "📈 내일 상장" 상세 알림
- `(권리공매도)` 등 그 밖의 일정 → 무시

하루 두 번(오전 10시·밤 10시) 구글 캘린더를 새로 읽어요. 그래서 원래 캘린더에서 일정이 바뀌어도 따로 할 일이 없어요.
