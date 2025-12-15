/**
 * Модуль для управления состоянием бота и менеджера циклов
 * Сохраняет ВСЕ функции из оригинального twitter-create-and-sell.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { BotState, LaunchResult, CycleManagerState, RoundInfo } from './cycle-types';

// ============= BOT STATE MANAGEMENT =============

/**
 * Сохранение состояния бота
 */
export function saveBotState(state: BotState): void {
  const stateFile = path.join(process.cwd(), 'bot_state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

/**
 * Загрузка состояния бота
 */
export function loadBotState(): BotState {
  const stateFile = path.join(process.cwd(), 'bot_state.json');
  
  if (!fs.existsSync(stateFile)) {
    return {
      lastThreeResults: [],
      consecutiveLosses: 0,
      isPaused: false,
      pauseUntil: 0,
      currentFile: null,
      currentUserIndex: 0,
    };
  }
  
  try {
    const data = fs.readFileSync(stateFile, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(chalk.red(`Ошибка при загрузке состояния: ${(error as Error).message}`));
    return {
      lastThreeResults: [],
      consecutiveLosses: 0,
      isPaused: false,
      pauseUntil: 0,
      currentFile: null,
      currentUserIndex: 0,
    };
  }
}

/**
 * Обновление состояния после запуска токена
 */
export function updateBotState(state: BotState, result: LaunchResult): BotState {
  // Добавляем новый результат
  state.lastThreeResults.push(result);
  
  // Оставляем только последние 3 результата
  if (state.lastThreeResults.length > 3) {
    state.lastThreeResults.shift();
  }
  
  // Проверяем убытки
  if (!result.isProfit) {
    state.consecutiveLosses++;
  } else {
    state.consecutiveLosses = 0;
  }
  
  // Если 3 убытка подряд - пауза на 1 час
  if (state.consecutiveLosses >= 3) {
    state.isPaused = true;
    state.pauseUntil = Date.now() + 60 * 60 * 1000; // 1 час
    console.log(chalk.red.bold(`\n⏸️  ПАУЗА НА 1 ЧАС! 3 убытка подряд`));
    console.log(chalk.yellow(`Возобновление в: ${new Date(state.pauseUntil).toLocaleString()}\n`));
  }
  
  saveBotState(state);
  return state;
}

/**
 * Проверка и обработка паузы
 */
export async function checkAndHandlePause(state: BotState): Promise<BotState> {
  if (state.isPaused && Date.now() < state.pauseUntil) {
    const remainingTime = Math.ceil((state.pauseUntil - Date.now()) / 1000);
    console.log(chalk.yellow(`⏳ Бот на паузе. Осталось ${remainingTime} секунд...`));
    
    // Ждем 30 секунд перед следующей проверкой
    await new Promise(resolve => setTimeout(resolve, 30000));
    return checkAndHandlePause(state);
  }
  
  if (state.isPaused && Date.now() >= state.pauseUntil) {
    state.isPaused = false;
    state.consecutiveLosses = 0;
    console.log(chalk.green.bold(`\n▶️  БОТ ВОЗОБНОВЛЕН!\n`));
    saveBotState(state);
  }
  
  return state;
}

// ============= CYCLE MANAGER STATE MANAGEMENT =============

/**
 * Сохранение состояния менеджера циклов
 */
export function saveCycleManagerState(state: CycleManagerState): void {
  const stateFile = path.join(process.cwd(), 'cycle_manager_state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

/**
 * Загрузка состояния менеджера циклов
 */
export function loadCycleManagerState(): CycleManagerState {
  const stateFile = path.join(process.cwd(), 'cycle_manager_state.json');

  if (!fs.existsSync(stateFile)) {
    return {
      cycleNumber: 1,
      lastRoundId: '',
      totalCycles: 0,
      totalProfit: 0,
      isPaused: false,
      pauseUntil: 0,
      lastUpdateTime: new Date().toISOString(),
    };
  }

  try {
    const data = fs.readFileSync(stateFile, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(chalk.red(`Ошибка при загрузке состояния: ${(error as Error).message}`));
    return {
      cycleNumber: 1,
      lastRoundId: '',
      totalCycles: 0,
      totalProfit: 0,
      isPaused: false,
      pauseUntil: 0,
      lastUpdateTime: new Date().toISOString(),
    };
  }
}

/**
 * Обновление состояния менеджера циклов после раунда
 */
export function updateCycleManagerState(state: CycleManagerState, roundInfo: RoundInfo): CycleManagerState {
  state.lastRoundId = roundInfo.roundId;
  state.totalCycles++;
  state.totalProfit += roundInfo.totalProfit;

  // Если убыток - пауза на 1 час
  if (!roundInfo.isProfit) {
    state.isPaused = true;
    state.pauseUntil = Date.now() + 60 * 60 * 1000; // 1 час
    console.log(chalk.red.bold(`\n⏸️  ПАУЗА НА 1 ЧАС! Раунд завершился с убытком`));
    console.log(chalk.yellow(`Возобновление в: ${new Date(state.pauseUntil).toLocaleString()}\n`));
  }

  state.cycleNumber++;
  state.lastUpdateTime = new Date().toISOString();
  saveCycleManagerState(state);

  return state;
}

/**
 * Проверка и обработка паузы менеджера циклов
 */
export async function checkAndHandleCyclePause(state: CycleManagerState): Promise<CycleManagerState> {
  if (state.isPaused && Date.now() < state.pauseUntil) {
    const remainingTime = Math.ceil((state.pauseUntil - Date.now()) / 1000);
    const remainingMinutes = Math.ceil(remainingTime / 60);
    console.log(chalk.yellow(`⏳ Менеджер на паузе. Осталось ${remainingMinutes} минут...\n`));

    await new Promise(resolve => setTimeout(resolve, 60000));
    return checkAndHandleCyclePause(state);
  }

  if (state.isPaused && Date.now() >= state.pauseUntil) {
    console.log(chalk.green.bold(`\n▶️  МЕНЕДЖЕР ВОЗОБНОВЛЕН!\n`));
    state.isPaused = false;
    state.pauseUntil = 0;
    saveCycleManagerState(state);
  }

  return state;
}

// ============= ROUND INFO MANAGEMENT =============

/**
 * Сохранение информации о раунде
 */
export function saveRoundInfo(roundInfo: RoundInfo): void {
  const roundInfoFile = path.join(process.cwd(), 'wallets_backups', roundInfo.roundId, 'round_info.json');
  fs.writeFileSync(roundInfoFile, JSON.stringify(roundInfo, null, 2));
  console.log(chalk.green(`✅ Информация о раунде сохранена\n`));
}

/**
 * Загрузка информации о раунде
 */
export function loadRoundInfo(roundId: string): RoundInfo | null {
  const roundInfoFile = path.join(process.cwd(), 'wallets_backups', roundId, 'round_info.json');
  
  if (!fs.existsSync(roundInfoFile)) {
    return null;
  }

  try {
    const data = fs.readFileSync(roundInfoFile, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(chalk.red(`Ошибка при загрузке информации о раунде: ${(error as Error).message}`));
    return null;
  }
}

// ============= STATISTICS =============

/**
 * Вывод статистики бота
 */
export function printBotStatistics(state: BotState): void {
  console.log(chalk.cyan.bold(`\n╔════════════════════════════════════════╗`));
  console.log(chalk.cyan.bold(`║  СТАТИСТИКА БОТА                       ║`));
  console.log(chalk.cyan.bold(`╚════════════════════════════════════════╝\n`));

  console.log(chalk.cyan(`📊 Последние 3 результата:`));
  if (state.lastThreeResults.length === 0) {
    console.log(chalk.gray(`   Нет результатов\n`));
  } else {
    state.lastThreeResults.forEach((result, index) => {
      const status = result.isProfit ? '✅' : '❌';
      console.log(chalk.cyan(`   ${index + 1}. ${status} @${result.username} - ${result.profit.toFixed(4)} SOL`));
    });
    console.log();
  }

  console.log(chalk.cyan(`📈 Статистика:`));
  console.log(chalk.cyan(`   Последовательные убытки: ${state.consecutiveLosses}`));
  console.log(chalk.cyan(`   Статус: ${state.isPaused ? '⏸️  На паузе' : '▶️  Активен'}\n`));
}

/**
 * Вывод статистики менеджера циклов
 */
export function printCycleManagerStatistics(state: CycleManagerState): void {
  console.log(chalk.magenta.bold(`\n╔════════════════════════════════════════╗`));
  console.log(chalk.magenta.bold(`║  СТАТИСТИКА МЕНЕДЖЕРА ЦИКЛОВ          ║`));
  console.log(chalk.magenta.bold(`╚════════════════════════════════════════╝\n`));

  console.log(chalk.cyan(`📊 Статистика:`));
  console.log(chalk.cyan(`   Текущий цикл: #${state.cycleNumber}`));
  console.log(chalk.cyan(`   Всего циклов: ${state.totalCycles}`));
  console.log(chalk.cyan(`   Общая прибыль: ${state.totalProfit.toFixed(4)} SOL`));
  console.log(chalk.cyan(`   Статус: ${state.isPaused ? '⏸️  На паузе' : '▶️  Активен'}`));
  console.log(chalk.cyan(`   Последнее обновление: ${state.lastUpdateTime}\n`));
}

export default {
  saveBotState,
  loadBotState,
  updateBotState,
  checkAndHandlePause,
  saveCycleManagerState,
  loadCycleManagerState,
  updateCycleManagerState,
  checkAndHandleCyclePause,
  saveRoundInfo,
  loadRoundInfo,
  printBotStatistics,
  printCycleManagerStatistics,
};