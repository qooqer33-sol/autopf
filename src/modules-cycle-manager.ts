/**
 * Менеджер циклов для запуска токенов с Twitter данными
 * Полная логика: создание кошельков → запуск токенов → сбор SOL
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { RPC_URL, WS_URL } from './constants';
import { RoundInfo, TwitterUser } from './cycle-types';
import {
  createWallet,
  restoreKeypairFromPrivateKey,
  getBalance,
  sendSol,
  sendAllSol,
  saveWalletBackup,
} from './modules-wallet-manager';
import { launchTokenOnWorkerWallet } from './modules-token-launcher';
import { saveRoundInfo } from './modules-state-manager';
import { findNextTwitterFile, loadTwitterUsers } from './modules-twitter-handler';

// ============= TWITTER DATA MANAGEMENT =============

/**
 * Управление состоянием Twitter пользователей
 */
interface TwitterState {
  currentFile: string | null;
  currentUserIndex: number;
  usedUsers: Set<string>;
}

function getTwitterStateFile(): string {
  return path.join(process.cwd(), 'twitter_state.json');
}

function loadTwitterState(): TwitterState {
  const stateFile = getTwitterStateFile();
  if (fs.existsSync(stateFile)) {
    const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    return {
      ...data,
      usedUsers: new Set(data.usedUsers || []),
    };
  }
  return {
    currentFile: null,
    currentUserIndex: 0,
    usedUsers: new Set(),
  };
}

function saveTwitterState(state: TwitterState): void {
  const stateFile = getTwitterStateFile();
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        currentFile: state.currentFile,
        currentUserIndex: state.currentUserIndex,
        usedUsers: Array.from(state.usedUsers),
      },
      null,
      2
    )
  );
}

/**
 * Получить следующего Twitter пользователя
 */
function getNextTwitterUser(twitterState: TwitterState): TwitterUser | null {
  // Ищем файл если еще не выбран
  if (!twitterState.currentFile) {
    twitterState.currentFile = findNextTwitterFile();
    if (!twitterState.currentFile) {
      console.log(chalk.yellow('⚠️  Файлы с Twitter данными не найдены'));
      return null;
    }
  }

  // Загружаем пользователей из файла
  const users = loadTwitterUsers(twitterState.currentFile);

  // Ищем неиспользованного пользователя
  for (let i = twitterState.currentUserIndex; i < users.length; i++) {
    const user = users[i];
    const userId = `${twitterState.currentFile}:${user.username}`;

    if (!twitterState.usedUsers.has(userId)) {
      twitterState.usedUsers.add(userId);
      twitterState.currentUserIndex = i + 1;
      saveTwitterState(twitterState);
      return user;
    }
  }

  // Если все пользователи в файле использованы - переходим к следующему файлу
  const nextFile = findNextTwitterFile(twitterState.currentFile);
  if (nextFile && nextFile !== twitterState.currentFile) {
    twitterState.currentFile = nextFile;
    twitterState.currentUserIndex = 0;
    saveTwitterState(twitterState);
    return getNextTwitterUser(twitterState);
  }

  // Если файлов больше нет - циклируем с начала
  console.log(chalk.yellow('🔄 Все пользователи использованы, циклируем с начала...'));
  twitterState.currentFile = findNextTwitterFile();
  twitterState.currentUserIndex = 0;
  twitterState.usedUsers.clear();
  saveTwitterState(twitterState);
  return getNextTwitterUser(twitterState);
}

// ============= ROUND CREATION =============

/**
 * Создание раунда: создание кошельков и распределение SOL
 */
export async function createRound(
  bankKeypair: Keypair,
  connection: Connection,
  roundId: string
): Promise<RoundInfo> {
  console.log(chalk.cyan.bold('\n╔════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║  ЦИКЛ: СОЗДАНИЕ РАУНДА          ║'));
  console.log(chalk.cyan.bold('╚════════════════════════════════════════╝\n'));

  // Проверяем начальный баланс банка
  const bankBalance = await getBalance(bankKeypair.publicKey, connection);
  console.log(chalk.yellow(`💰 Начальный баланс банка: ${bankBalance.toFixed(4)} SOL\n`));

  // Создаем промежуточный кошелек Б1
  console.log(chalk.cyan('📌 Создание промежуточного кошелька Б1...'));
  const intermediateKeypair = createWallet('B1_intermediate');
  saveWalletBackup(intermediateKeypair, 'B1_intermediate', roundId);

  // Отправляем 6 SOL на Б1
  console.log(chalk.cyan('📤 Отправка 6 SOL на кошелек Б1...'));
  await sendSol(bankKeypair, intermediateKeypair.publicKey, 6, connection);

  // Создаем рабочие кошельки С1, С2, С3
  console.log(chalk.cyan('\n📌 Создание рабочих кошельков С1, С2, С3...'));
  const workerKeypairs = [];
  for (let i = 1; i <= 3; i++) {
    const workerKeypair = createWallet(`C${i}_worker`);
    saveWalletBackup(workerKeypair, `C${i}_worker`, roundId);
    workerKeypairs.push(workerKeypair);

    // Отправляем 1.99 SOL на каждый рабочий кошелек
    console.log(chalk.cyan(`📤 Отправка 1.99 SOL на кошелек С${i}...`));
    await sendSol(intermediateKeypair, workerKeypair.publicKey, 1.99, connection);
  }

  console.log(chalk.green(`\n✅ Раунд ${roundId} успешно создан!\n`));

  return {
    roundId,
    cycleNumber: parseInt(roundId.split('_')[1]) || 1,
    bankWallet: {
      publicKey: bankKeypair.publicKey.toBase58(),
      privateKey: Buffer.from(bankKeypair.secretKey).toString('base64'),
      name: 'A_bank',
      createdAt: new Date().toISOString(),
    },
    intermediateWallet: {
      publicKey: intermediateKeypair.publicKey.toBase58(),
      privateKey: Buffer.from(intermediateKeypair.secretKey).toString('base64'),
      name: 'B1_intermediate',
      createdAt: new Date().toISOString(),
    },
    workerWallets: workerKeypairs.map((kp, i) => ({
      publicKey: kp.publicKey.toBase58(),
      privateKey: Buffer.from(kp.secretKey).toString('base64'),
      name: `C${i + 1}_worker`,
      createdAt: new Date().toISOString(),
    })),
    workerLaunches: [],
    startBalance: bankBalance,
    endBalance: 0,
    totalProfit: 0,
    isProfit: false,
    createdAt: new Date().toISOString(),
  };
}

// ============= TOKEN LAUNCHES =============

/**
 * Запуск токенов на всех рабочих кошельках с Twitter данными
 */
export async function launchTokensOnWorkers(
  roundInfo: RoundInfo,
  connection: Connection
): Promise<void> {
  // Восстанавливаем рабочие кошельки для запусков
  const workerKeypairs = roundInfo.workerWallets.map((wallet) =>
    Keypair.fromSecretKey(Buffer.from(wallet.privateKey, 'base64'))
  );

  // Загружаем состояние Twitter пользователей
  const twitterState = loadTwitterState();

  const launchAmounts = [1.3, 1.2, 1]; // С1, С2, С3

  for (let i = 0; i < workerKeypairs.length; i++) {
    const walletName = `C${i + 1}`;
    const solAmount = launchAmounts[i];

    // Получаем следующего Twitter пользователя
    const twitterUser = getNextTwitterUser(twitterState);
    if (!twitterUser) {
      console.log(chalk.red(`❌ Не удалось получить Twitter пользователя для ${walletName}`));
      continue;
    }

    console.log(chalk.cyan.bold(`\n🚀 Запуск токена на ${walletName}`));
    console.log(chalk.cyan(`📝 Twitter: @${twitterUser.username}`));
    console.log(chalk.cyan(`📊 Имя: ${twitterUser.name}`));
    console.log(chalk.cyan(`💰 Инвестиция: ${solAmount} SOL\n`));

    const launchResult = await launchTokenOnWorkerWallet(
      workerKeypairs[i],
      walletName,
      solAmount,
      connection,
      twitterUser // ← ПЕРЕДАЕМ TWITTER ДАННЫЕ
    );

    roundInfo.workerLaunches.push({
      walletName: launchResult.walletName,
      walletAddress: workerKeypairs[i].publicKey.toBase58(),
      solAmount,
      initialBalance: launchResult.initialBalance,
      finalBalance: launchResult.finalBalance,
      profit: launchResult.profit,
      isProfit: launchResult.isProfit,
      mint: launchResult.mint,
      timestamp: launchResult.timestamp,
    });

    // Небольшая пауза между запусками
    if (i < workerKeypairs.length - 1) {
      console.log(chalk.gray(`⏳ Пауза перед следующим запуском...\n`));
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

// ============= SOL COLLECTION =============

/**
 * Сбор всех SOL обратно на банк
 */
export async function collectAllSol(
  bankKeypair: Keypair,
  roundInfo: RoundInfo,
  connection: Connection
): Promise<void> {
  console.log(chalk.cyan.bold('\n╔════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║  СБОР SOL НА БАНК                      ║'));
  console.log(chalk.cyan.bold('╚════════════════════════════════════════╝\n'));

  // Сбор с рабочих кошельков
  for (let i = 0; i < roundInfo.workerWallets.length; i++) {
    const wallet = roundInfo.workerWallets[i];
    const workerKeypair = Keypair.fromSecretKey(Buffer.from(wallet.privateKey, 'base64'));
    const balance = await getBalance(workerKeypair.publicKey, connection);

    if (balance > 0.001) {
      console.log(chalk.cyan(`💸 Сбор ${balance.toFixed(4)} SOL с кошелька ${wallet.name}...`));
      try {
        await sendAllSol(workerKeypair, bankKeypair.publicKey, connection);
        console.log(chalk.green(`✅ Собрано ${balance.toFixed(4)} SOL\n`));
      } catch (error) {
        console.log(chalk.red(`❌ Ошибка при сборе: ${(error as Error).message}\n`));
      }
    }
  }

  // Сбор с промежуточного кошелька
  const intermediateKeypair = Keypair.fromSecretKey(
    Buffer.from(roundInfo.intermediateWallet.privateKey, 'base64')
  );
  const intermediateBalance = await getBalance(intermediateKeypair.publicKey, connection);

  if (intermediateBalance > 0.001) {
    console.log(chalk.cyan(`💸 Сбор ${intermediateBalance.toFixed(4)} SOL с кошелька Б1...`));
    try {
      await sendAllSol(intermediateKeypair, bankKeypair.publicKey, connection);
      console.log(chalk.green(`✅ Собрано ${intermediateBalance.toFixed(4)} SOL\n`));
    } catch (error) {
      console.log(chalk.red(`❌ Ошибка при сборе: ${(error as Error).message}\n`));
    }
  }
}

// ============= STATISTICS =============

/**
 * Вывод статистики раунда
 */
export function printRoundStatistics(roundInfo: RoundInfo): void {
  console.log(chalk.cyan.bold('\n╔════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║  СТАТИСТИКА РАУНДА                    ║'));
  console.log(chalk.cyan.bold('╚════════════════════════════════════════╝\n'));

  let totalProfit = 0;

  roundInfo.workerLaunches.forEach((result: any, index: number) => {
    const profit = result.profit;
    totalProfit += profit;
    const profitStr = profit > 0 ? chalk.green(`+${profit.toFixed(4)}`) : chalk.red(`${profit.toFixed(4)}`);
    console.log(chalk.cyan(`C${index + 1}: ${profitStr} SOL`));
  });

  roundInfo.totalProfit = totalProfit;
  const totalProfitStr =
    totalProfit > 0 ? chalk.green(`+${totalProfit.toFixed(4)}`) : chalk.red(`${totalProfit.toFixed(4)}`);
  console.log(chalk.cyan(`\n   Итого: ${totalProfitStr} SOL\n`));
}

export default {
  createRound,
  launchTokensOnWorkers,
  collectAllSol,
  printRoundStatistics,
};