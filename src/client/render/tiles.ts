// 타일 위에 서는 그림(벽·나무·물체)을 한곳에서 내보냅니다.
// 그림은 props.ts(물체) · flora.ts(나무) · rocks.ts(바위) · walls.ts(벽)에 있습니다
// (픽셀 단위 명암과 같은 계열의 외곽선, 화면 배율별 캐시).
// 바닥·물·성수·용암은 ground.ts 가 타일 경계 없이 이어지는 바닥 조각으로 굽습니다.

export { drawFlame, objectSprite } from './props';
export { wallCanvas } from './walls';
