/**
 * Главный файл менеджера циклов Solana
 * Использует модульную архитектуру для управления циклами кошельков
 * С интегрированным Twitter парсером
 * 
 * ОБНОВЛЕНО: Интеграция с ванити-пулом
 * - Инициализация пула при старте
 * - Генерация ванити-ключей во время паузы между циклами
 */

import { Connection, Keypair } from '@solana/web3.js';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { RPC_URL, WS_URL } from './constants';
import { restoreKeypairFromPrivateKey } from './modules-wallet-manager';
import {
  loadCycleManagerState,
  checkAndHandleCyclePause,
  updateCycleManagerState,
  printCycleManagerStatistics,
} from './modules-state-manager';
import {
  createRound,
  launchTokensOnWorkers,
  collectAllSol,
  printRoundStatistics,
} from './modules-cycle-manager';
import {
  initializeParser,
  checkAndParseIfNeeded,
  countAvailableTwitters,
} from './modules-twitter-parser';

// ============= ИМПОРТ ВАНИТИ-ПУЛА =============
import {
  initVanityPool,
  getPoolStats,
  hasEnoughKeys,
  startBackgroundGeneration,
  VANITY_POOL_CONFIG,
} from './modules-vanity-pool';

dotenv.config();

const connection = new Connection(RPC_URL, { commitment: 'confirmed', wsEndpoint: WS_URL });

// ============= КОНФИГУРАЦИЯ ПАУЗЫ =============

const PAUSE_CONFIG = {
  // Пауза между циклами (1 час = 3600000 мс)
  pauseBetweenCycles: 60 * 60 * 1000,
  
  // Время на генерацию ванити-ключей (55 минут)
  vanityGenerationTime: 55 * 60 * 1000,
  
  // Минимальная пауза перед следующим циклом (5 минут)
  minPauseTime: 5 * 60 * 1000,
};

// ============= MAIN CYCLE MANAGER =============

/**
 * Пауза между циклами с генерацией ванити-ключей
 */
async function pauseWithVanityGeneration(): Promise<void> {
  console.log(chalk.cyan.bold('\n╔════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║  ПАУЗА МЕЖДУ ЦИКЛАМИ                   ║'));
  console.log(chalk.cyan.bold('╚════════════════════════════════════════╝\n'));
  
  const stats = getPoolStats();
  const targetPoolSize = VANITY_POOL_CONFIG.targetPoolSize;
  
  console.log(chalk.cyan(`📊 Статус ванити-пула:`));
  console.log(chalk.cyan(`   Доступно: ${stats.available} ключей`));
  console.log(chalk.cyan(`   Цель: ${targetPoolSize} ключей`));
  console.log(chalk.cyan(`\n⏱️  Время паузы: ${(PAUSE_CONFIG.pauseBetweenCycles / 60000).toFixed(0)} мин\n`));
  
  // Если нужно пополнить пул — генерируем
  if (stats.available < targetPoolSize) {
    console.log(chalk.cyan(`🔄 Запуск генерации ванити-ключей на ${(PAUSE_CONFIG.vanityGenerationTime / 60000).toFixed(0)} мин...\n`));
    
    const startTime = Date.now();
    const generated = await startBackgroundGeneration(PAUSE_CONFIG.vanityGenerationTime);
    const elapsed = Date.now() - startTime;
    
    console.log(chalk.green(`\n✅ Сгенерировано ${generated} новых ванити-ключей за ${(elapsed / 60000).toFixed(1)} мин`));
    
    // Ждём оставшееся время паузы
    const remainingPause = PAUSE_CONFIG.pauseBetweenCycles - elapsed;
    if (remainingPause > 0) {
      console.log(chalk.cyan(`\n⏳ Ожидание ${(remainingPause / 60000).toFixed(1)} мин до следующего цикла...`));
      await new Promise(resolve => setTimeout(resolve, remainingPause));
    }
  } else {
    console.log(chalk.green(`✅ Пул заполнен, генерация не требуется`));
    console.log(chalk.cyan(`\n⏳ Ожидание ${(PAUSE_CONFIG.pauseBetweenCycles / 60000).toFixed(0)} мин до следующего цикла...`));
    await new Promise(resolve => setTimeout(resolve, PAUSE_CONFIG.pauseBetweenCycles));
  }
  
  console.log(chalk.green(`\n▶️  Пауза завершена, запуск следующего цикла...\n`));
}

/**
 * Главная функция менеджера циклов
 */
async function runCycleManager(bankKeypair: Keypair) {
  console.log(chalk.magenta.bold(`\n╔════════════════════════════════════════╗`));
  console.log(chalk.magenta.bold(`║  МЕНЕДЖЕР ЦИКЛОВ SOLANA КОШЕЛЬКОВ    ║`));
  console.log(chalk.magenta.bold(`║  С ИНТЕГРАЦИЕЙ PUMP.FUN               ║`));
  console.log(chalk.magenta.bold(`╚════════════════════════════════════════╝\n`));

  // ============= ИНИЦИАЛИЗАЦИЯ ВАНИТИ-ПУЛА =============
  console.log(chalk.cyan('🔑 Инициализация ванити-пула...'));
  initVanityPool();
  
  const vanityStats = getPoolStats();
  console.log(chalk.cyan(`   Доступно ванити-ключей: ${vanityStats.available}`));
  
  if (!hasEnoughKeys(3)) {
    console.log(chalk.yellow(`\n⚠️  Внимание: недостаточно ванити-ключей для цикла (нужно 3)`));
    console.log(chalk.yellow(`   Первый цикл запустится с обычными адресами`));
    console.log(chalk.yellow(`   Ванити-ключи будут сгенерированы во время паузы\n`));
  } else {
    console.log(chalk.green(`   ✅ Достаточно ключей для запуска\n`));
  }

  // Инициализация парсера при старте
  await initializeParser();

  let state = loadCycleManagerState();

  console.log(chalk.cyan(`📊 Загруженное состояние:`));
  console.log(chalk.cyan(`   Цикл: #${state.cycleNumber}`));
  console.log(chalk.cyan(`   Всего циклов: ${state.totalCycles}`));
  console.log(chalk.cyan(`   Общая прибыль: ${state.totalProfit.toFixed(4)} SOL`));
  console.log(chalk.cyan(`   Статус: ${state.isPaused ? 'На паузе' : 'Активен'}\n`));

  // Бесконечный цикл
  while (true) {
    // Проверяем паузу
    state = await checkAndHandleCyclePause(state);

    // Проверяем наличие твиттеров и запускаем парсинг если нужно
    await checkAndParseIfNeeded();

    try {
      // Создаем раунд с кошельками
      const roundInfo = await createRound(bankKeypair, connection, `round_${state.cycleNumber}`);

      // Запускаем токены на всех рабочих кошельках
      await launchTokensOnWorkers(roundInfo, connection);

      // Собираем все SOL обратно на банк
      await collectAllSol(bankKeypair, roundInfo, connection);

      // Обновляем состояние менеджера
      state = updateCycleManagerState(state, roundInfo);

      // Вывод итогов цикла
      printRoundStatistics(roundInfo);
      printCycleManagerStatistics(state);

      // ============= ПАУЗА С ГЕНЕРАЦИЕЙ ВАНИТИ-КЛЮЧЕЙ =============
      if (!state.isPaused) {
        await pauseWithVanityGeneration();
      }
    } catch (error) {
      console.error(chalk.red(`\n❌ Ошибка в цикле: ${(error as Error).message}`));
      console.error(chalk.red(`   Стек: ${(error as Error).stack}`));

      console.log(chalk.yellow(`⏳ Ожидание 30 секунд перед повторной попыткой...\n`));
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

// ============= ENTRY POINT =============

if (require.main === module) {
  const bankPrivateKeyBs58 = process.env.BANK_PRIVATE_KEY;

  if (!bankPrivateKeyBs58) {
    console.error(chalk.red(`❌ Ошибка: BANK_PRIVATE_KEY не установлен в .env файле`));
    process.exit(1);
  }

  try {
    const bankKeypair = restoreKeypairFromPrivateKey(bankPrivateKeyBs58);
    console.log(chalk.green(`✅ Банк кошелек загружен: ${bankKeypair.publicKey.toBase58()}\n`));

    runCycleManager(bankKeypair);
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка при инициализации: ${(error as Error).message}`));
    process.exit(1);
  }
}

export { runCycleManager, restoreKeypairFromPrivateKey };