// 게임 클라이언트 시작점
import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const root = document.getElementById('ui') as HTMLElement;
const game = new Game(canvas, root);
game.start();
