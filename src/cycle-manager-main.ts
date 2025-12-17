/**
 * Главный файл менеджера циклов Solana
 * Использует модульную архитектуру для управления циклами кошельков
 * С интегрированным Twitter парсером
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

dotenv.config();

const connection = new Connection(RPC_URL, { commitment: 'confirmed', wsEndpoint: WS_URL });

// ============= MAIN CYCLE MANAGER =============

/**
 * Главная функция менеджера циклов
 */
async function runCycleManager(bankKeypair: Keypair) {
  console.log(chalk.magenta.bold(`\n╔════════════════════════════════════════╗`));
  console.log(chalk.magenta.bold(`║  МЕНЕДЖЕР ЦИКЛОВ SOLANA КОШЕЛЬКОВ    ║`));
  console.log(chalk.magenta.bold(`║  С ИНТЕГРАЦИЕЙ PUMP.FUN               ║`));
  console.log(chalk.magenta.bold(`╚════════════════════════════════════════╝\n`));

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

      // Небольшая пауза перед следующим циклом
      if (!state.isPaused) {
        console.log(chalk.gray(`⏳ Пауза перед следующим запуском...\n`));
        await new Promise(resolve => setTimeout(resolve, 10000));
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