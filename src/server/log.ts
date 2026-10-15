// 간단한 로거
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let minLevel: Level = (process.env.LOG_LEVEL as Level) in ORDER ? (process.env.LOG_LEVEL as Level) : 'info';

export function setLogLevel(level: Level): void {
  minLevel = level;
}

function write(level: Level, args: unknown[]): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] ${level.toUpperCase().padEnd(5)}`;
  if (level === 'error') console.error(line, ...args);
  else if (level === 'warn') console.warn(line, ...args);
  else console.log(line, ...args);
}

export const log = {
  debug: (...args: unknown[]) => write('debug', args),
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
};
