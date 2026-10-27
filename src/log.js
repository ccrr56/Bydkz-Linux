'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function createLogger(levelName) {
  const threshold = LEVELS[levelName] !== undefined ? LEVELS[levelName] : LEVELS.info;

  const stamp = () => new Date().toLocaleString('zh-CN', { hour12: false });

  const write = (level, args) => {
    if (LEVELS[level] > threshold) return;
    const line = `[${stamp()}] [${level.toUpperCase()}]`;
    if (level === 'error') {
      console.error(line, ...args);
    } else if (level === 'warn') {
      console.warn(line, ...args);
    } else {
      console.log(line, ...args);
    }
  };

  return {
    error: (...args) => write('error', args),
    warn: (...args) => write('warn', args),
    info: (...args) => write('info', args),
    debug: (...args) => write('debug', args),
  };
}

module.exports = { createLogger };
