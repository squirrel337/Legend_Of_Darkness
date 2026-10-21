# 성장 체계: 전직·승급·2차 직업·숙련도·스킬트리

사용자가 정한 규칙과 원작 어둠의 전설(고전 시기) 규칙을 따른 설계입니다. 수치는 모두 `gamedata/progression.json`, `gamedata/skilltrees.json` 에 있고 관리자 페이지의 "직업·스킬트리" 탭에서 고칩니다. 아래의 기본값은 원작 공략 글(팬 카페·공식 게시판·나무위키 요약)에서 가져온 값이며, 시기마다 원작 수치가 달랐던 항목은 고전 시기 값을 골랐습니다.

## 1. 직업 계통

| 1차 직업 | 2차 직업 |
| --- | --- |
| 전사 | 검투사 |
| 도적 | 궁사 (게임 안 이름을 "궁수"에서 "궁사"로 바꿈) |
| 마법사 | 소환사 |
| 성직자 | 바드 |
| 무도가 | 수인 (포유류 · 조류 · 파충류 중 하나, 2차 전직 때 고르고 바꿀 수 없음) |

- 5레벨에 길드에서 고를 수 있는 것은 **1차 직업만**입니다. 2차 직업은 승급 뒤 2차 전직으로만 얻습니다.

## 2. 전직 (1차 직업 99레벨 → 1레벨부터 다시)

- 1차 직업 99레벨에서 할 수 있습니다. **같은 직업으로도 전직할 수 있습니다.**
- **무도가는 "환골탈태"**로 무도가로만 다시 태어나고, 다른 직업으로는 전직할 수 없습니다. **다른 직업도 무도가로 전직할 수 없습니다.**
- 전직하면
  - 레벨 1, 경험치 0 으로 돌아갑니다.
  - **능력치만 1레벨 값으로 돌아갑니다** (기본 능력치, 남은 포인트 0).
  - **배운 기술과 마법(과 그 숙련도)은 그대로 가집니다.** 이전 직업의 기술도 계속 쓸 수 있습니다.
  - 승급 장인에게 산 체력·마나(순수 체력·마력), 장비, 소지품, 골드, 창고는 그대로입니다.
  - 다만 새 직업·레벨로 입을 수 없는 장비(다른 직업 전용, 레벨 제한이 더 높은 것)는 벗겨 소지품(가득하면 창고)에 넣습니다. 장비 자체는 그대로 가지고, 그 레벨이 되면 다시 입을 수 있습니다 (1레벨에 높은 레벨 장비를 입은 채로 두면 서버의 장비 규칙과 어긋나고 다시 오르는 길이 너무 쉬워짐).
  - 전직 횟수가 1 늘어납니다.
- 전직은 새로 들어갈 직업의 길드장에게 합니다 (무도가의 환골탈태는 무도가 길드장).
- 승급한 뒤에는 전직할 수 없습니다 (설정으로 바꿀 수 있음).
- 기본 조건 (원작): 99레벨, 순수 체력·마력, 보유 경험치 1억 (써서 없어짐)

| 지금 직업 | 순수 체력 | 순수 마력 | 경험치 |
| --- | --- | --- | --- |
| 전사 | 14,000 | 3,500 | 1억 |
| 도적 | 11,000 | 6,000 | 1억 |
| 마법사 | 10,000 | 11,000 | 1억 |
| 성직자 | 11,000 | 12,000 | 1억 |
| 무도가 (환골탈태) | 14,000 | 6,000 | 1억 |

"순수 체력·마력"은 장비를 뺀 최대 체력·마나입니다 (직업 기본 + 레벨 + 건강/지혜 + 승급 장인에게 산 값).

## 3. 승급 (1차 직업 99레벨에서 바로)

- 99레벨이 되면 승급 장인에게서
  - **경험치를 팔아 최대 체력·마나를 삽니다**: 경험치 50만 → 체력 +100 또는 마나 +50 (지금 게임 값 유지).
  - **최대 체력 150을 팔아 능력치 1을 삽니다** (승급 전에도 99레벨이면 가능, 직업 기본 체력 아래로는 팔 수 없음).
  - 조건을 채우면 **승급**합니다. 승급하면 칭호가 "마스터"가 되고 2차 전직을 할 수 있습니다.
- 기본 승급 조건 (원작): 순수 체력·마력, 보유 경험치 2억 5천만 (써서 없어짐), 그 직업의 핵심 기술 2개 숙련도 100

| 직업 | 순수 체력 | 순수 마력 | 숙련도 100 이 필요한 기술 |
| --- | --- | --- | --- |
| 전사 | 17,000 | 5,000 | 철벽, 필살 (원작의 완전방어·크래셔) |
| 도적 | 13,000 | 7,000 | 은신, 그림자 일격 |
| 마법사 | 12,000 | 13,000 | 마력 집중, 순간이동 |
| 성직자 | 13,000 | 14,000 | 대치유, 부활 |
| 무도가 | 16,000 | 7,000 | 명상, 금강불괴 |

## 4. 2차 전직 (승급 뒤)

- 기본 조건 (원작): 승급 완료, 보유 경험치 10억, 순수 체력 500·마력 500 을 바침 (셋 다 써서 없어짐). 조건을 모두 채운 것을 먼저 확인한 뒤에만 써서, 원작처럼 체력·마력만 잃는 일은 없게 합니다.
- 2차 전직은 마을의 **2차 직업 인도자** NPC 에게 합니다. 수인은 이때 포유류·조류·파충류 중 하나를 고르며 바꿀 수 없습니다.
- **레벨은 99 그대로**이고, 새로 **어빌리티 레벨(어빌)**이 1부터 시작해 99까지 오릅니다.
  - 어빌 경험치는 2차 직업 캐릭터가 몬스터를 잡을 때 그 몬스터 경험치의 일정 비율(기본 25%)로 얻습니다. 일반 경험치도 계속 쌓여 체력·마나를 사는 데 씁니다.
  - 어빌 레벨 1 → 2 에 필요한 어빌 경험치는 일반 레벨 표와 같습니다 (`expToNext(어빌)`).
  - 어빌이 오를 때마다 최대 체력 +30, 최대 마나 +15 (기본값).
  - 2차 직업 기술은 **필요 레벨 대신 필요 어빌**로 배웁니다.

## 5. 기술·마법 배우기 (원작과 비슷하게: 선수과목 + 숙련도)

- 1차 직업 기술은 그 직업 길드장에게, 2차 직업 기술은 그 2차 직업 스승(길드장)에게 배웁니다. 전직해서 다른 직업이 되었어도, 그 직업 길드장에게 가서 그 직업의 기술을 배울 수 있는 것은 지금 직업의 것뿐입니다.
- 배우는 조건 (기술마다 `skilltrees.json` 에서 정함):
  - 필요 레벨 (1차) 또는 필요 어빌 (2차)
  - 골드, 재료 아이템 (써서 없어짐). 1차 직업의 재료는 그 기술을 배울 즈음의 사냥터 몬스터가 떨어뜨립니다.
  - **선수과목**: 먼저 배운 기술과 그 기술의 필요 숙련도 (예: 회오리 베기 ← 강타 숙련도 20, 대지 가르기 ← 회오리 베기 50)
  - 필요 능력치 (선택), 수인은 계통(포유류·조류·파충류) 전용 기술
- 2차 직업 트리의 첫 기술은 승급한 사람이면 반드시 배워 둔 1차 직업 기술을 선수과목으로 둡니다 (예: 쌍검 베기 ← 강타 50, 할퀴기 ← 정권 지르기 50).
- 수인 기술은 공통(할퀴기·물어뜯기·야수화·포효·원초의 회복·야성의 폭풍)과 계통마다 다섯 개(포유류: 덮치기 … 야수왕의 일격, 조류: 급강하 … 천공의 사냥꾼, 파충류: 독니 … 대지의 포식자)입니다.
- 길드장의 "기술/마법 배우기" 창은 기술마다 조건을 ✓/✗ 와 지금 값으로 보이고, 조건을 모두 채운 기술만 배우기 단추가 켜집니다. 골드·소지품·숙련도가 바뀌면 열린 창이 바로 다시 판정합니다.
- 기술·마법은 각각 40개까지 배울 수 있습니다 (자리가 차면 더 배울 수 없음).
- **숙련도**: 배우면 0 에서 시작해 쓸 때마다 확률로 1씩 올라 최대 100 입니다. 숙련도가 높을수록 오르기 어렵습니다 (기본: 오를 확률 = max(3%, 35% × (1 − 0.8 × 숙련도/100))).
  - 숙련도에 따라 위력(피해·회복·흡혈)과 상태 이상의 확률이 70%(숙련도 0)에서 115%(숙련도 100)까지 오릅니다.
  - 수련장의 허수아비를 쳐서 올릴 수 있습니다 (빗나가도 쓴 것으로 칩니다).
  - 이 체계를 넣기 전에 이미 배운 기술은 숙련도 100 으로 옮겨 지금의 위력을 유지합니다.

## 6. 스킬트리 데이터 (`gamedata/skilltrees.json`)

직업마다 기술 칸 배치(편집기와 게임 안 스킬트리 창이 함께 씀)와 배우는 조건을 둡니다. 열은 갈래(예: 전사 베기·돌격·투지), 줄은 필요 레벨(2차 직업은 어빌) 순서입니다.

게임 안에서는 **K 키**(또는 아래 패널의 "트리" 단추)로 스킬트리 창을 엽니다.

- 칸은 배움(숙련도 숫자와 막대) · 지금 배울 수 있음(빛남) · 잠김(회색)으로 보이고, 선수과목 선 위에 필요 숙련도가 적힙니다 (채우면 금색, 배웠지만 숙련도가 모자라면 빨강).
- 다른 트리의 선수과목(2차 직업 첫 기술의 1차 직업 기술)은 칸 모서리의 작은 아이콘으로 보입니다.
- 칸에 마우스를 올리면 조건을 지금 값과 함께 보여 주고, 누르면 고정합니다.
- 탭: 지금 직업, 전직하기 전 직업, 배운 기술이 있는 직업, 평민. "다른 직업 보기"로 다른 직업의 트리도 미리 볼 수 있고, 그 직업이 되는 길(전직·2차 전직)을 알려 줍니다.
- 수인은 내 계통의 열이 ★ 로 강조되고 다른 계통은 흐리게 보입니다.

## 7. 관리자 페이지 "직업·스킬트리" 탭

- 스킬트리: 칸 배치(끌어 옮기기), 선수과목 연결(기술 아래 점을 끌어 다른 기술에 놓고 필요 숙련도를 적음), 기술별 배우는 조건(레벨/어빌·골드·재료·능력치·수인 계통), 기술의 이름·설명·마나·재사용 대기. 가격과 필요 레벨은 노드에서 고치며 `abilities.json` 의 level·price 도 함께 맞춥니다.
- 게임 화면 미리보기: 레벨·어빌·골드·능력치·재료를 바꿔 가며 게임 안 판정(learnStatus)대로 무엇을 배울 수 있는지 봅니다.
- 성장 규칙: 전직(가능한 길, 조건, 승급 뒤 허용), 승급(조건, 경험치·체력 교환 비율, 칭호), 2차 전직(연결, 조건, 수인 계통), 어빌(경험치 비율, 레벨당 체력·마나), 숙련도(오르는 속도, 위력 범위)
- 고칠 때마다 서버의 검사를 실시간으로 돌려 문제를 그 자리에 보여 주고, 오류가 있으면 저장 단추가 꺼집니다.
- 저장하면 검사를 거쳐 `gamedata/` 파일에 쓰고, 이전 판은 `data/design-history/` 에 남기며, **서버를 끄지 않고 바로 반영**합니다 (접속 중인 사람의 스킬트리 창·길드장 창·칭호가 그 자리에서 바뀜).
- 판 기록: 저장마다 바로 전 설계가 남고, 지금과 비교한 뒤 그 판으로 되돌릴 수 있습니다 (되돌린 것도 기록에 남음).
- 그사이 다른 곳에서 저장했으면 알려 주고(다시 불러오기 또는 내 것으로 덮어쓰기), 서버 밖에서 고친 파일은 덮어쓰지 않습니다.

캐릭터 하나의 성장 상태는 관리자 페이지 캐릭터 화면의 "성장 체계" 칸, 게임 안 F2 운영자 도구, 채팅 명령 `/숙련도` `/어빌` `/승급` `/전직횟수` `/계통` 으로 고칩니다. `/만렙` 은 배운 기술·마법의 숙련도와 2차 직업의 어빌까지 최대로 합니다.

## 8. 구현

### 8.1 어디에 무엇이 있나

| 부분 | 파일 |
| --- | --- |
| 공용 형식·공식·배우는 조건 판정 | `src/shared/progression.ts` (형식, `learnStatus`, 공식), `src/shared/design-edit.ts` (편집기 저장 본문·바뀐 곳 요약·판 기록 형식), `src/shared/tree-route.ts` (선수과목 선이 다른 칸을 지나지 않게 돌아가는 길) |
| 메시지 | `src/shared/protocol.ts` (`SelfState`·`learn`·`prof`·`abilityLevelUp`·`design`·`gain.abilityExp`), NPC 서비스 `secondJob` 은 `src/shared/types.ts` |
| 저장 항목 | `src/server/storage.ts` (`CharacterData`·`normalizeCharacter`) |
| 설계 파일 읽기·검사·바로 반영 | `src/server/gamedata.ts` (`checkDesign`·`applyDesign`·`checkUpdate`·`formatSkillTrees` 등) |
| 성장 엔진 | `src/server/systems/progression.ts` (조건·전직·승급·교환·2차 전직·어빌·숙련도·배우기), `systems/combat.ts` (숙련도 배율·오르기, 처치의 어빌 경험치), `systems/npc.ts` (길드장·승급 장인·2차 직업 인도자 대화, 배우기), `systems/character.ts` (`unequipUnwearable`), `systems/autohunt.ts` (기술 고르기에 숙련도 배율) |
| 운영자 기능 | `src/server/admin/AdminService.ts`·`commands.ts` (숙련도·어빌·승급·전직 횟수·계통), `admin/api.ts` (캐릭터 작업), `admin/design.ts` (편집기 API) |
| 게임 화면 | `src/client/progression.ts` (화면용 계산: 배우기 목록·조건 글·트리 배치), `ui/skilltree.ts` (K 창), `ui/windows.ts` (길드장 창·NPC 대화의 조건 색), `ui/hud.ts`·`panel.ts`·`charwin.ts`·`tooltip.ts`·`help.ts`·`gm.ts`, `public/progression.css` |
| 관리자 페이지 | `src/admin/design/*` (직업·스킬트리 탭, 격자 크기와 화살표 길은 `grid.ts`), `src/admin/main.ts` (캐릭터 화면의 성장 체계 칸), `public/admin.css` |
| 데이터 | `gamedata/progression.json`, `skilltrees.json`, `abilities.json` (수인 계통 기술), `items.json` (재료), `npcs.json` (2차 직업 인도자 마나난, 길드장 대사), `maps/town.json` (마나난은 신전 안 (19,7)) |
| 시험 | `test/progression*.test.ts`, `test/admin-design*.test.ts`, `test/client-progression.test.ts`, `test/classdata.test.ts` |

### 8.2 데이터 형식 (`src/shared/progression.ts`)

- 직업 단계: `FIRST_CLASSES`(전사·도적·마법사·성직자·무도가), `SECOND_CLASSES`(검투사·궁사·소환사·바드·수인), `classTier(id)` = 0 평민 / 1 1차 / 2 2차, `DEFAULT_SECOND_FROM`, `secondClassesOf(1차, from)`.
- 조건 `Condition` (모두 채워야 함, 쓰는 조건은 전부 확인한 뒤에만 한꺼번에 씀):
  `level{min}` · `ascended` · `rebirths{min}` · `pureHp{min}` · `pureMp{min}` · `exp{min, consume}` · `payHp{amount}` · `payMp{amount}` · `gold{min, consume}` · `item{item, qty, consume}` · `skillProf{ability, min}`.
  확인 결과는 `ConditionCheck { ok, results: ConditionResult[] }`, 설명 글은 `describeCondition`. 같은 종류의 쓰는 조건이 여럿이면 합친 양을 채워야 합니다.
- `progression.json` = `ProgressionConfig`: `rebirth{level, restartLevel, allowAfterAscend, targets, conditions, names}`, `ascend{level, expTrade{exp,hp,mp}, hpToStat{hp,stat}, conditions, title}`, `second{from, conditions, beastTypes[{id,name}]}`, `ability{maxLevel, expRatio, hpPerLevel, mpPerLevel}`, `proficiency{max, baseChance, slowdown, minChance, effectMin, effectMax}`. 직업별 항목은 1차 직업 다섯(전직·승급), 2차 직업 다섯(2차 전직)이 빠짐없이 있어야 합니다. 무도가 규칙(`rebirth.targets.monk` 는 `["monk"]`, 다른 직업의 `targets` 에는 무도가가 없음)은 편집기에서 잠겨 있고, 서버 검사도 오류로 막습니다 (API 로 바로 저장·되돌리기·손으로 고친 파일도).
- `skilltrees.json` = `SkillTreesConfig { version: 1, trees: { <평민 포함 모든 직업>: { columns?, nodes } } }`. 노드 하나:
  ```json
  {"ability":"w_cleave","row":4,"col":0,"level":35,"gold":12000,"items":[{"item":"mat_orc_tusk","qty":3}],"requires":[{"ability":"w_whirl","prof":50}]}
  ```
  1차 직업·평민 트리는 `level`, 2차 직업 트리는 `abilityLevel`. `items`·`requires` 는 생략하면 빈 배열, `stats`(장비를 뺀 기본 능력치와 비교)·`beastType`(수인 트리만)은 선택. 줄 0~39, 칸 0~11, 같은 칸에 두 기술은 안 됩니다.
  선수과목은 다른 트리의 기술이어도 됩니다 (예: 검투사 쌍검 베기 ← 전사 강타 숙련도 50).
- 평민 트리의 기술은 누구나(수련장 관리인), 다른 트리는 **지금 직업의 것만** 그 직업 길드장(2차 직업은 그 스승)에게서 배웁니다. 이전 직업의 기술은 그대로 씁니다.
- 배우는 조건의 기준은 스킬트리입니다. `abilities.json` 의 `level`·`price` 는 서클 표시·밸런스 계산용 기본값으로 남고, 트리와 다르면 검사가 경고합니다. 관리자 저장은 둘을 같이 맞춥니다.
- 공식: `profGainChance(숙련도, cfg)`, `profEffect(숙련도, cfg)`, `abilityVitals(어빌, cfg)` (어빌 1 은 0, 오를 때마다 +30/+15), `abilityExpToNext(어빌, cfg)`, `titleOf`, `rebirthName`, `bigNumber` ("2억 5,000만").
- 배우는 조건의 상태: `learnStatus(트리 직업, 노드, LearnContext) → { learned, learnable, reason?, reqs: ReqStatus[] }`. 서버(`learnContextOf`)와 클라이언트(SelfState·소지품으로 만든 ctx)가 같은 함수를 써서 화면과 판정이 어긋나지 않습니다. 길드장 창의 목록은 서버 `learnEntries` 와 클라이언트 `learnEntriesFor` 가 같은 순서(필요 레벨·어빌 → 줄 → 칸)로 만들며, 시험이 둘이 같은지 확인합니다.

### 8.3 캐릭터 저장 항목 (`CharacterData`)

| 항목 | 뜻 | 옛 저장 파일 |
| --- | --- | --- |
| `rebirths` | 전직(환골탈태) 횟수 | 0 |
| `ascended` | 승급했는지 (칭호는 `ascend.title` 에서) | false |
| `abilityLevel` | 0 = 2차 직업 아님, 2차 직업은 늘 1 이상 | 2차 직업이면 1 |
| `abilityExp` | 지금 어빌 레벨의 어빌 경험치 | 0 |
| `beastType` | 수인 계통 id, 수인이 아니거나 안 골랐으면 null | null |
| `prof` | 배운 기술·마법마다 숙련도 | 값이 없는 배운 기술은 100, 배우지 않은 기술의 값은 버림 |
| `bonusHp`·`bonusMp` | 이제 음수일 수 있음 (체력을 팔거나 바침) | 그대로 |

- `learnOnData(data, def, prof = 0)` 가 숙련도를 적습니다 (새로 배우면 0, 다시 읽어도 0).
- `setClassOnData` (5레벨 직업 선택·관리자)는 다른 직업 기술을 지우고 어빌·계통·숙련도를 맞춥니다. **전직·2차 전직은 이 함수를 쓰지 않습니다** (기술을 지우므로).
- `vitalsBonus(data, gd)` = 산 체력·마나 + 어빌 보너스. `Player.recompute` 와 `AdminService.derivedOf` 가 씁니다.

### 8.4 메시지 (`src/shared/protocol.ts`)

- `SelfState` += `rebirths`, `ascended`, `title`, `abilityLevel`, `abilityExp`, `abilityExpNext`, `beastType`, `prof`.
- `welcome.data` (`ClientGameData`) += `skillTrees` (모든 트리), `progression` (`PublicProgression` = 조건 목록을 뺀 성장 규칙).
- `{ t: 'learn', npc, name, classId, list: LearnEntry[] }` — `LearnEntry = { id, level, abilityLevel, price, learned, learnable, reason?, reqs }` (필요 레벨·어빌 순).
- S2C: `{ t: 'abilityLevelUp', abilityLevel }`, `{ t: 'prof', id, prof }` (숙련도 한 칸), `{ t: 'design', abilities, skillTrees, progression }` (관리자가 설계를 바꾼 직후 모두에게, welcome 의 같은 항목을 바꿔 끼움), `gain` 에 `abilityExp?`.
- 새 C2S 는 없습니다. 전직할 직업, 수인 계통, 교환 횟수는 모두 NPC 대화 선택지(`pick`)로 고릅니다. 선택지 key 는 서버만 해석하며 이렇게 씁니다: `rebirth:<직업>[:yes]`, `ascend` (메뉴), `ascend:hp|mp|stat` (횟수 고르기: 1·10·100·할 수 있는 만큼), `ascend:hp|mp|stat:<횟수|all>:<표>[:yes]` (교환), `ascend:do[:yes]`, `second[:<2차 직업>[:<계통>][:yes]]`, `beast[:<계통>[:yes]]`.
  - 교환의 표는 교환 메뉴·확인을 보낼 때마다 바뀌고 마지막 것만 받으므로, 같은 선택이 두 번 와도(두 번 누르기 등) 한 번만 바꿉니다. 할 수 있는 만큼 모두(`all`)와 체력 → 능력치는 한 번 더 묻고 `:yes` 로 바꾸며, 할 수 없는 교환은 묻지 않고 이유를 바로 보입니다.
  - 화면은 대화마다 선택지를 한 번만 보냅니다: 고르면 다음 대화가 올 때까지 선택지를 끄고, 새 대화가 뜬 직후(0.25초)의 누름, 두 번 누르기의 두 번째 누름, 누르고 있는 숫자 키의 반복은 받지 않습니다.
- 전직·승급·2차 전직 대화는 조건을 한 줄씩 `○ …`/`× … (지금 값)` 으로 보내고, 클라이언트가 채움/모자람 색으로 그립니다. "예" 선택지는 조건을 모두 채웠을 때만 나옵니다.
- `NpcService` += `{ type: 'secondJob' }` (2차 직업 인도자). `class` 서비스: 1차 직업 길드장만 5레벨 직업 선택을 내놓고, 99레벨 1차 직업에게는 그 직업으로의 전직을 내놓으며, 그 직업인 사람에게 그 트리의 기술을 가르칩니다. 2차 직업 스승은 기술만 가르칩니다.

### 8.5 함수

`src/server/systems/progression.ts`:

```ts
vitalsBonus(data, gd) · pureVitals(data, gd) · classBaseVitals(data, gd) · learnContextOf(data, gd) · learnEntries(data, gd, classId)
checkConditions(data, gd, conds): ConditionCheck        // 값을 바꾸지 않음, 조건마다 결과 하나
payConditions(data, gd, conds): void                    // checkConditions 가 ok 인 직후에만
rebirthTargets(data, gd) · rebirthOffered(data, gd, target)
checkRebirth(data, gd, target) · rebirthOnData(data, gd, cfg, target)
checkAscend(data, gd) · ascendOnData(data, gd)
tradeLimits(data, gd) · tradeExpOnData(data, gd, 'hp' | 'mp', times) · tradeHpForStatOnData(data, gd, times) · resetStatsBlocked(data, gd)
checkSecondJob(data, gd, target, beastType | null) · secondJobOnData(data, gd, target, beastType | null) · chooseBeastTypeOnData(data, gd, beastType)
abilityExpShare(data, gd, amount) · addAbilityExpToData(data, gd, amount) · gainAbilityExp(p, amount)   // 처치 경험치는 gainExp(p, exp, { fromKill: true })
rollProficiencyOnData(data, gd, abilityId, roll) · gainProficiency(p, abilityId) · proficiencyMultiplier(p, abilityId)
learnFromTree(data, gd, abilityId, { free? })
// ProgressionResult = { ok, msg, check?: ConditionCheck }
```

`src/server/gamedata.ts` — `gd.progression`, `gd.skillTrees` (설계가 바뀌면 통째로 바뀌므로 붙잡아 두지 말고 쓸 때마다 `world.data.…` 로 읽기), `gd.treeOf(직업)`, `gd.nodeOf(기술)`, `gd.designWarnings`, `gd.applyDesign({ progression?, skillTrees?, abilities?: AbilityPatch[], syncAbilityDefaults? }): DesignIssue[]` (오류가 하나라도 있으면 아무것도 바꾸지 않음, 파일은 쓰지 않음), `gd.checkUpdate(같은 인자)` (검사만), `gd.reloadDesign(dir)`, 검사 함수 `checkDesign`·`checkProgression`·`checkSkillTrees`·`checkAbilityPatches`, `normalizeSkillTrees`, `treeAbilityDefaults`. 문제는 `DesignIssue { level: 'error' | 'warn', where: "skilltrees.json(warrior/w_whirl)", msg }`. 파일을 다시 쓸 때는 `formatSkillTrees`·`formatProgression`·`formatListFile`(abilities.json) 로 지금 파일과 같은 모양을 지킵니다 (바꾼 줄만 차이로 보임).

`src/server/admin/design.ts` — 관리자 로그인 뒤 `api.ts` 가 부르는 편집기 API:

| 경로 | 본문 → 응답 |
| --- | --- |
| `GET /api/admin/design` | → `DesignBundle` (설계, 기술·아이템·직업 목록, `rev`, 경고: 설계 경고·서버 최대 레벨보다 높은 조건·서버 밖에서 바뀐 파일) |
| `PUT /api/admin/design` | `DesignSaveBody` (여러 트리·성장 규칙·기술 값을 한 번에, 편집기가 씀; `dryRun` 이면 오류도 200 + `ok: false`) → `DesignSaveResult` |
| `PUT /api/admin/design/skilltree/:classId` | `SkillTreeSaveBody { rev, tree, abilities?, dryRun? }` → `DesignSaveResult` |
| `PUT /api/admin/design/progression` | `ProgressionSaveBody { rev, progression, dryRun? }` → `DesignSaveResult` |
| `GET /api/admin/design/history` | → `DesignHistoryList` (새것부터) |
| `GET /api/admin/design/history/:id` | → `DesignHistoryDetail` (판 하나의 설계) |
| `POST /api/admin/design/restore` | `DesignRestoreBody { id, rev }` → `DesignSaveResult` |

`DesignSaveResult { ok, msg, issues, rev }` — 본문 모양이 틀리거나 검사 오류면 400, 그사이 다른 사람이 저장해 `rev` 가 다르면 409, 서버 밖에서 바뀐 파일에 써야 하면 412, 본문이 너무 크면 413, 맞지 않는 방식이면 405.
저장 순서: 검사 → 실행 중인 게임 데이터에 `applyDesign` (노드의 레벨·가격을 `abilities.json` 에도 맞춤) → 바로 전 설계를 `data/design-history/<시각>-<종류>[-직업].json` 에 (200개까지) → 정해진 세 파일(`skilltrees.json`·`progression.json`·`abilities.json`) 중 바뀐 것만 임시 파일에 쓰고 이름 바꾸기 (실패하면 되돌림) → 접속자 모두에게 `{ t: 'design' }` + 다시 계산 → 감사 기록.

관리자 API 의 캐릭터 작업에는 `setRebirths`·`setAscended`·`setAbilityLevel`·`setProficiency`·`setBeastType` 이 있습니다 (`POST /api/admin/characters/<이름>/<작업>`).

### 8.6 세부 규칙

- **순수 체력·마력** = `pureVitals`: 장비·상태 효과를 뺀 최대치 (직업 기본 + 레벨 + 건강/지혜 + 산 값 + 어빌 보너스).
- **직업 기본 체력·마나** = `classBaseVitals`: 직업 기본 + 레벨 몫. 체력→능력치 교환과 `payHp`/`payMp` 는 순수 최대치가 이 아래로 내려가게 할 수 없고, `bonusHp`/`bonusMp` 에서 뺍니다 (음수 가능). 건강·지혜로 늘어난 몫까지 팔거나 바친 캐릭터가 능력치를 초기화하면 이 바닥이 깨지므로, 되돌린 뒤의 순수 최대치가 직업 기본 아래면 NPC 의 능력치 초기화를 막고 다시 사야 할 양을 알려 줍니다 (`resetStatsBlocked`). 분배한 능력치가 없으면 초기화 골드도 받지 않습니다.
- **전직**: 지금 1차 직업, 레벨 ≥ `rebirth.level`, 승급했으면 `allowAfterAscend` 일 때만, 대상 ∈ `targets[지금 직업]`, 조건 → 레벨 `restartLevel`, 경험치 0, 능력치 모두 3(`START_STAT`), 포인트 (restartLevel − 1) × 레벨당 포인트, 기술·마법·숙련도·장비·소지품·골드·창고는 그대로, `bonusHp/bonusMp` 는 음수면 0으로, 새 직업·레벨로 못 입는(직업 제한, 레벨 제한 — `equipError` 와 같은 규칙) 장비는 소지품(가득하면 창고)으로, `rebirths + 1`, 체력·마나 가득. 새 직업 길드장에게서, 이름은 `rebirth.names` (무도가는 환골탈태).
- **승급**: 1차 직업, 레벨 ≥ `ascend.level`, 아직 승급 전, 조건 → `ascended = true`. 교환(`expTrade`·`hpToStat`)은 레벨만 되면 승급 전후·2차 직업 누구나.
- **2차 전직**: 지금 1차 직업 ∈ `second.from[대상]`, 조건(승급 포함) → 직업 = 대상, 어빌 1, 어빌 경험치 0, 수인만 계통, 레벨·능력치·기술·숙련도는 그대로, 못 입는 장비는 소지품으로. 2차 직업 인도자에게서. 계통이 없는 옛 수인은 인도자에게서 한 번 고릅니다. 고른 계통의 id 가 설정에서 없어져도 다시 고르게 하지 않습니다 (관리자가 캐릭터의 계통을 고쳐 줌). 계통 id 는 캐릭터 저장과 수인 트리가 함께 쓰므로, 편집기는 저장한 id 를 바꿀 수 없게 하고(이름만), 서버는 고른 수인이 있는 id 를 지우거나 바꾸는 저장·되돌리기를 거절합니다.
- **어빌 경험치**: 2차 직업이 몬스터를 잡아 받은 일반 경험치(배율·그룹 분배 뒤)의 `expRatio`. `abilityExpToNext` 만큼 모이면 어빌 레벨업, 어빌 만렙이면 더 쌓이지 않음. 체력·마나 보너스는 `vitalsBonus` 로 저절로 붙습니다.
- **숙련도**: 기술·마법을 실제로 쓴 뒤 `profGainChance` 확률로 +1 (최대에서 멈춤), 오르면 `{ t: 'prof' }` (10 단위와 최대에서는 채팅으로도). 배율 `profEffect` 는 피해(물리·마법·희생), 회복(체력·마나), 해로운 상태의 확률(chance 가 없으면 1로 보고 곱한 뒤 1에서 자름)에 곱합니다. 흡혈은 깎은 체력에 비례하므로 따로 곱하지 않고, 평타와 몬스터의 기술은 해당 없습니다. 자동사냥이 기술을 고를 때의 예상 피해·회복에도 같은 배율을 씁니다.
- **배우기**: `learnFromTree` 는 `learnStatus` 가 `learnable` 일 때 골드와 재료를 내고 `learnOnData`(숙련도 0). 운영자는 조건 없이 무료로 배웁니다.

### 8.7 정한 것과 남은 것

- 2차 전직 뒤 1차 직업 장비는 입을 수 없어 소지품으로 갑니다 (`items.json` 의 직업 제한은 그대로, 2차 직업마다 자기 장비 8단계).
- 운영자 만렙 세팅(`/만렙`, F2, 관리자 페이지)은 배운 기술·마법의 숙련도를 최대로, 2차 직업은 어빌도 최대로 합니다. 운영자가 `/배우기` 로 가르친 기술은 숙련도 0 에서 시작합니다.
- 수인 계통: 지금 있던 수인 기술 다섯을 포유류 갈래로 두고, 조류·파충류 갈래를 새로 만들었습니다 (같은 레벨·가격 자리, 비슷한 피해).
- 전직하면 1레벨로 입을 수 없는 장비(레벨 제한)도 직업 제한 장비처럼 벗겨 소지품(가득하면 창고)으로 옮깁니다. 장비는 그대로 가지므로 "장비 유지"와 어긋나지 않고, 서버의 장비 규칙(입을 때 레벨·직업 확인)과도 맞습니다. 입은 채로 두기를 바라면 `rebirthOnData` 의 `unequipUnwearable` 을 직업 제한만 보게 바꾸면 됩니다.
- 이 체계 전에 5레벨에 2차 직업을 고른 옛 캐릭터가 2차 직업 트리의 첫 단계 기술(어빌 5, 1차 직업 기술이 선수과목)을 아직 배우지 않았다면, 그 1차 직업 기술을 배울 길이 없어 막힙니다. 관리자 페이지에서 그 1차 직업 기술을 배우게 하고 숙련도를 맞춰 주면 됩니다.
- 여러 번 전직해 여러 직업의 트리를 모두 배우려 하면 40개 자리를 넘깁니다 (예: 마법사 → 성직자 → 바드의 마법이 모두 44개). 자리가 차면 더 배울 수 없고, 플레이어가 스스로 잊는 방법(원작의 기술 잊기)은 아직 없습니다 (관리자 페이지에서 잊게 할 수는 있음).
