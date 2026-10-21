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
  - 골드, 재료 아이템 (써서 없어짐)
  - **선수과목**: 먼저 배운 기술과 그 기술의 필요 숙련도 (예: 회오리 베기 ← 강타 숙련도 30)
  - 필요 능력치 (선택), 수인은 계통(포유류·조류·파충류) 전용 기술
- **숙련도**: 배우면 0 에서 시작해 쓸 때마다 확률로 1씩 올라 최대 100 입니다. 숙련도가 높을수록 오르기 어렵습니다 (기본: 오를 확률 = max(3%, 35% × (1 − 0.8 × 숙련도/100))).
  - 숙련도에 따라 위력(피해·회복·흡혈)과 상태 이상의 확률이 70%(숙련도 0)에서 115%(숙련도 100)까지 오릅니다.
  - 수련장의 허수아비를 쳐서 올릴 수 있습니다.
  - 이 체계를 넣기 전에 이미 배운 기술은 숙련도 100 으로 옮겨 지금의 위력을 유지합니다.

## 6. 스킬트리 데이터 (`gamedata/skilltrees.json`)

직업마다 기술 칸 배치(편집기와 게임 안 스킬트리 창이 함께 씀)와 배우는 조건을 둡니다. 게임 안에서는 K 키로 내 직업의 스킬트리 창을 열어, 배운 기술·숙련도·다음에 배울 수 있는 기술과 모자란 조건을 봅니다.

## 7. 관리자 페이지 "직업·스킬트리" 탭

- 스킬트리: 칸 배치, 선수과목 연결(필요 숙련도), 기술별 배우는 조건(레벨/어빌·골드·재료·능력치·수인 계통), 기술의 이름·설명·마나·재사용 대기·가격
- 성장 규칙: 전직(가능한 길, 조건, 승급 뒤 허용), 승급(조건, 경험치·체력 교환 비율), 2차 전직(연결, 조건, 수인 계통), 어빌(경험치 비율, 레벨당 체력·마나), 숙련도(오르는 속도, 위력 범위)
- 저장하면 검사를 거쳐 `gamedata/` 파일에 쓰고, 이전 판은 `data/design-history/` 에 남기며, **서버를 끄지 않고 바로 반영**합니다.

## 8. 구현 계약 (네 트랙이 함께 지킬 약속)

`prog-contract` 브랜치에 형식·함수 모양·데이터 파일·검사가 들어 있고, 각 트랙은 몸통만 채웁니다. 아래 "계약" 파일은 바꾸지 말고, 꼭 필요하면 항목을 **덧붙이기만** 한 뒤 다른 트랙에 알립니다.

### 8.1 파일 맡기

| 트랙 | 고치는 파일 |
| --- | --- |
| 계약 (모두 읽기만) | `src/shared/progression.ts`, `src/shared/protocol.ts`, `src/shared/types.ts` 의 `NpcService`, `src/server/storage.ts` 의 `CharacterData`·`normalizeCharacter`, `src/server/gamedata.ts` 의 설계 검사·`applyDesign` |
| 엔진 | `src/server/systems/progression.ts` (아래 "엔진 트랙" 함수의 몸통), `systems/npc.ts` (전직·승급·교환·2차 전직 대화, 스킬트리로 배우기), `systems/combat.ts` (숙련도 배율·오르기, 어빌 경험치), `systems/character.ts`, `world/Player.ts`, `test/progression-engine*.test.ts` |
| 데이터 | `gamedata/skilltrees.json` (진짜 트리: 배치·선수과목·재료·계통), `gamedata/progression.json` (사용자가 정한 원작 기본값이라 숫자는 그대로 둠), `abilities.json` (수인 계통 기술 같은 새 기술), `items.json` (재료), `npcs.json` (2차 직업 인도자, 대사), `maps/town.json` (배치), `test/skilltree-data*.test.ts` |
| 관리자 | `src/server/admin/design.ts` (API 몸통·파일 쓰기·판 기록·바로 반영), `admin/api.ts`, `admin/AdminService.ts`·`commands.ts` (숙련도·어빌·전직 관리자 기능), `src/admin/**`, `public/admin.*`, `test/admin-design*.test.ts` |
| 클라이언트 | `src/client/**` (K 스킬트리 창, 길드장 배우기 창, HUD·캐릭터 창, 새 메시지 처리), `public/index.html`·`style.css`, `test/client-*.test.ts` |

README 와 이 문서는 통합할 때 정리합니다.

### 8.2 데이터 형식 (`src/shared/progression.ts`)

- 직업 단계: `FIRST_CLASSES`(전사·도적·마법사·성직자·무도가), `SECOND_CLASSES`(검투사·궁사·소환사·바드·수인), `classTier(id)` = 0 평민 / 1 1차 / 2 2차, `DEFAULT_SECOND_FROM`, `secondClassesOf(1차, from)`.
- 조건 `Condition` (모두 채워야 함, 쓰는 조건은 전부 확인한 뒤에만 한꺼번에 씀):
  `level{min}` · `ascended` · `rebirths{min}` · `pureHp{min}` · `pureMp{min}` · `exp{min, consume}` · `payHp{amount}` · `payMp{amount}` · `gold{min, consume}` · `item{item, qty, consume}` · `skillProf{ability, min}`.
  확인 결과는 `ConditionCheck { ok, results: ConditionResult[] }`, 설명 글은 `describeCondition`.
- `progression.json` = `ProgressionConfig`: `rebirth{level, restartLevel, allowAfterAscend, targets, conditions, names}`, `ascend{level, expTrade{exp,hp,mp}, hpToStat{hp,stat}, conditions, title}`, `second{from, conditions, beastTypes[{id,name}]}`, `ability{maxLevel, expRatio, hpPerLevel, mpPerLevel}`, `proficiency{max, baseChance, slowdown, minChance, effectMin, effectMax}`. 직업별 항목은 1차 직업 다섯(전직·승급), 2차 직업 다섯(2차 전직)이 빠짐없이 있어야 합니다.
- `skilltrees.json` = `SkillTreesConfig { version: 1, trees: { <평민 포함 모든 직업>: { columns?, nodes } } }`. 노드 하나:
  ```json
  {"ability":"w_whirl","row":1,"col":0,"level":12,"gold":800,"items":[{"item":"mat_wolf_pelt","qty":3}],"requires":[{"ability":"w_strike","prof":30}],"stats":{"str":20}}
  ```
  1차 직업·평민 트리는 `level`, 2차 직업 트리는 `abilityLevel`. `items`·`requires` 는 생략하면 빈 배열, `stats`(장비를 뺀 기본 능력치와 비교)·`beastType`(수인 트리만)은 선택. 줄 0~39, 칸 0~11, 같은 칸에 두 기술은 안 됩니다.
  선수과목은 다른 트리의 기술이어도 됩니다 (예: 검투사 기술 ← 전사 강타 숙련도 50).
- 평민 트리의 기술은 누구나(수련장 관리인), 다른 트리는 **지금 직업의 것만** 그 직업 길드장(2차 직업은 그 스승)에게서 배웁니다. 이전 직업의 기술은 그대로 씁니다.
- 배우는 조건의 기준은 스킬트리입니다. `abilities.json` 의 `level`·`price` 는 서클 표시·밸런스 계산용 기본값으로 남고, 트리와 다르면 검사가 경고합니다. 데이터 트랙과 관리자 저장은 둘을 같이 맞춥니다 (`test/progression-contract.test.ts` 가 경고 0개와 기본값을 확인).
- 공식: `profGainChance(숙련도, cfg)`, `profEffect(숙련도, cfg)`, `abilityVitals(어빌, cfg)` (어빌 1 은 0, 오를 때마다 +30/+15), `abilityExpToNext(어빌, cfg)`, `titleOf`, `rebirthName`, `bigNumber` ("2억 5,000만").
- 배우는 조건의 상태: `learnStatus(트리 직업, 노드, LearnContext) → { learned, learnable, reason?, reqs: ReqStatus[] }`. 서버(`learnContextOf`)와 클라이언트(SelfState·소지품으로 만든 ctx)가 같은 함수를 써서 화면과 판정이 어긋나지 않습니다.

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
- `vitalsBonus(data, gd)` = 산 체력·마나 + 어빌 보너스. `Player.recompute` 와 `AdminService.derivedOf` 가 이미 씁니다.

### 8.4 메시지 (`src/shared/protocol.ts`)

- `SelfState` += `rebirths`, `ascended`, `title`, `abilityLevel`, `abilityExp`, `abilityExpNext`, `beastType`, `prof`.
- `welcome.data` (`ClientGameData`) += `skillTrees` (모든 트리), `progression` (`PublicProgression` = 조건 목록을 뺀 성장 규칙).
- `{ t: 'learn', npc, name, classId, list: LearnEntry[] }` — `LearnEntry = { id, level, abilityLevel, price, learned, learnable, reason?, reqs }` (필요 레벨·어빌 순).
- 새 S2C: `{ t: 'abilityLevelUp', abilityLevel }`, `{ t: 'prof', id, prof }` (숙련도 한 칸), `{ t: 'design', abilities, skillTrees, progression }` (관리자가 설계를 바꾼 직후 모두에게, welcome 의 같은 항목을 바꿔 끼움), `gain` 에 `abilityExp?`.
- 새 C2S 는 없습니다. 전직할 직업, 수인 계통, 교환 횟수는 모두 NPC 대화 선택지(`pick`)로 고릅니다. 선택지 key 는 서버만 해석하며 이렇게 씁니다: `rebirth:<직업>[:yes]`, `ascend:hp|mp[:<횟수>]`, `ascend:stat[:<횟수>]`, `ascend:do[:yes]`, `second:<2차 직업>[:<계통>][:yes]`, `beast:<계통>[:yes]`.
- `NpcService` += `{ type: 'secondJob' }` (2차 직업 인도자). `class` 서비스: 1차 직업 길드장만 5레벨 직업 선택을 내놓고(이미 반영), 99레벨 1차 직업에게는 그 직업으로의 전직을 내놓으며, 그 직업인 사람에게 그 트리의 기술을 가르칩니다. 2차 직업 스승은 기술만 가르칩니다.

### 8.5 함수

`src/server/systems/progression.ts` — 구현됨: `vitalsBonus`, `pureVitals`, `classBaseVitals`, `learnContextOf`, `learnEntries`. 엔진 트랙이 채울 것 (모양 확정, 지금은 실패나 0·1 을 돌려줌):

```ts
checkConditions(data, gd, conds): ConditionCheck        // 값을 바꾸지 않음, 조건마다 결과 하나
payConditions(data, gd, conds): void                    // checkConditions 가 ok 인 직후에만
rebirthTargets(data, gd): FirstClassId[]
checkRebirth(data, gd, target): ProgressionResult
rebirthOnData(data, gd, cfg, target): ProgressionResult
checkAscend(data, gd): ProgressionResult
ascendOnData(data, gd): ProgressionResult
tradeExpOnData(data, gd, 'hp' | 'mp', times): ProgressionResult
tradeHpForStatOnData(data, gd, times): ProgressionResult
checkSecondJob(data, gd, target, beastType | null): ProgressionResult
secondJobOnData(data, gd, target, beastType | null): ProgressionResult
addAbilityExpToData(data, gd, amount): number            // 오른 어빌 레벨 수
gainAbilityExp(p, amount): number                        // 몬스터 처치에서, 알림 포함
rollProficiencyOnData(data, gd, abilityId, roll): boolean
gainProficiency(p, abilityId): boolean                   // 기술을 실제로 쓴 뒤, { t: 'prof' } 포함
proficiencyMultiplier(p, abilityId): number              // 위력·상태 이상 확률 배율
learnFromTree(data, gd, abilityId, { free? }): ProgressionResult
// ProgressionResult = { ok, msg, check?: ConditionCheck }
```

`src/server/gamedata.ts` — `gd.progression`, `gd.skillTrees` (설계가 바뀌면 통째로 바뀌므로 붙잡아 두지 말고 쓸 때마다 `world.data.…` 로 읽기), `gd.treeOf(직업)`, `gd.nodeOf(기술)`, `gd.designWarnings`, `gd.applyDesign({ progression?, skillTrees?, abilities?: AbilityPatch[] }): DesignIssue[]` (오류가 하나라도 있으면 아무것도 바꾸지 않음, 파일은 쓰지 않음), `gd.reloadDesign(dir)`, 검사 함수 `checkDesign`·`checkProgression`·`checkSkillTrees`·`checkAbilityPatches`, `normalizeSkillTrees`. 문제는 `DesignIssue { level: 'error' | 'warn', where: "skilltrees.json(warrior/w_whirl)", msg }`. 파일을 다시 쓸 때는 `formatSkillTrees`·`formatProgression`·`formatListFile`(abilities.json) 로 지금 파일과 같은 모양을 지킵니다 (바꾼 줄만 차이로 보임).

`src/server/admin/design.ts` — `DesignApi.handle(method, path, readBody, actor) → { status, body } | null` (인증 뒤 `api.ts` 가 부름, 지금은 501):

| 경로 | 본문 → 응답 |
| --- | --- |
| `GET /api/admin/design` | → `DesignBundle` (설계, 기술·아이템·직업 목록, `rev`, 경고) |
| `PUT /api/admin/design/skilltree/:classId` | `SkillTreeSaveBody { rev, tree, abilities?, dryRun? }` → `DesignSaveResult` |
| `PUT /api/admin/design/progression` | `ProgressionSaveBody { rev, progression, dryRun? }` → `DesignSaveResult` |
| `GET /api/admin/design/history` | → `DesignHistoryList` (새것부터) |
| `POST /api/admin/design/restore` | `DesignRestoreBody { id, rev }` → `DesignSaveResult` |

`DesignSaveResult { ok, msg, issues, rev }` — 검사 오류는 400, 그사이 다른 사람이 저장해 `rev` 가 다르면 409. 저장 순서는 `design.ts` 머리 주석에 적었습니다 (판 기록 `data/design-history/<시각>-<종류>[-직업].json` → 파일 쓰기 → `applyDesign` → 접속자에게 `{ t: 'design' }` + 다시 계산 → 감사 기록).

### 8.6 엔진이 따를 세부 규칙

- **순수 체력·마력** = `pureVitals`: 장비·상태 효과를 뺀 최대치 (직업 기본 + 레벨 + 건강/지혜 + 산 값 + 어빌 보너스).
- **직업 기본 체력·마나** = `classBaseVitals`: 직업 기본 + 레벨 몫. 체력→능력치 교환과 `payHp`/`payMp` 는 순수 최대치가 이 아래로 내려가게 할 수 없고, `bonusHp`/`bonusMp` 에서 뺍니다 (음수 가능).
- **전직**: 지금 1차 직업, 레벨 ≥ `rebirth.level`, 승급했으면 `allowAfterAscend` 일 때만, 대상 ∈ `targets[지금 직업]`, 조건 → 레벨 `restartLevel`, 경험치 0, 능력치 모두 3(`START_STAT`), 포인트 (restartLevel − 1) × 레벨당 포인트, 기술·마법·숙련도·장비·소지품·골드·창고는 그대로, `bonusHp/bonusMp` 는 음수면 0으로, 새 직업이 못 입는 장비는 소지품(가득하면 창고)으로, `rebirths + 1`, 체력·마나 가득. 새 직업 길드장에게서, 이름은 `rebirth.names` (무도가는 환골탈태).
- **승급**: 1차 직업, 레벨 ≥ `ascend.level`, 아직 승급 전, 조건 → `ascended = true`. 교환(`expTrade`·`hpToStat`)은 레벨만 되면 승급 전후·2차 직업 누구나.
- **2차 전직**: 지금 1차 직업 ∈ `second.from[대상]`, 조건(승급 포함) → 직업 = 대상, 어빌 1, 어빌 경험치 0, 수인만 계통, 레벨·능력치·기술·숙련도는 그대로, 못 입는 장비는 소지품으로. 2차 직업 인도자에게서. 계통이 없는 옛 수인은 인도자에게서 한 번 고릅니다.
- **어빌 경험치**: 2차 직업이 몬스터를 잡아 받은 일반 경험치(배율·그룹 분배 뒤)의 `expRatio`. `abilityExpToNext` 만큼 모이면 어빌 레벨업, 어빌 만렙이면 더 쌓이지 않음. 체력·마나 보너스는 `vitalsBonus` 로 저절로 붙습니다.
- **숙련도**: 기술·마법을 실제로 쓴 뒤 `profGainChance` 확률로 +1 (최대에서 멈춤), 오르면 `{ t: 'prof' }`. 배율 `profEffect` 는 피해(물리·마법·희생), 회복(체력·마나), 해로운 상태의 확률(chance 가 없으면 1로 보고 곱한 뒤 1에서 자름)에 곱합니다. 흡혈은 깎은 체력에 비례하므로 따로 곱하지 않고, 평타와 몬스터의 기술은 해당 없습니다.
- **배우기**: `learnFromTree` 는 `learnStatus` 가 `learnable` 일 때 골드와 재료를 내고 `learnOnData`(숙련도 0). 운영자는 `free`.

### 8.7 트랙이 정하고 알릴 것

- 2차 전직 뒤 1차 직업 장비: 기본은 못 입음(소지품으로). 계속 입게 하려면 데이터 트랙이 `items.json` 의 `classes` 에 2차 직업을 더합니다.
- 관리자 만렙 세팅·"모든 기술 배우기"의 숙련도 (관리자 트랙: 최대로 줄지).
- 수인 계통 전용 기술 (데이터 트랙: 조류·파충류 기술을 새로 만들지, 지금 수인 기술을 계통별로 나눌지).
