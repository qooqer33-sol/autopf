/**
 * Модуль для запуска токенов на pump.fun
 * ОБНОВЛЕНО: Поддержка внешнего ванити-ключа mint
 * 
 * Изменения:
 * - Добавлен опциональный параметр vanityMint в launchTokenOnWorkerWallet
 * - Если vanityMint передан — используем его
 * - Если не передан — генерируем обычный или ванити-ключ на лету
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { PumpSdk, OnlinePumpSdk, getBuyTokenAmountFromSolAmount } from '@pump-fun/pump-sdk';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import chalk from 'chalk';
import bs58 from 'bs58';
import { getWithRetry } from './helper';
import { getBondingCurve } from './create';
import { saveAmount, wipeAmountsFile } from './amountSaver';
import { PUMP_PROGRAM_ID, RPC_URL, WS_URL } from './constants';
import { checkCurveAndSell } from './curveChecker';
import { TwitterUser, LaunchResult, WorkerLaunchResult, MintData } from './cycle-types';
import { getBalance, checkBalance } from './modules-wallet-manager';
import { prepareTokenAssets } from './modules-twitter-handler';
import { createTokenUriWithPinata } from './modules-pinata';

// ============= TOKEN LAUNCH PARAMETERS =============

const BUY_PARAMS = {
  solAmount: [1.3, 1.2, 1]
};

/**
 * Получение динамического количества SOL на основе попыток
 */
export function getBuyAmount(consecutiveLosses: number): number {
  switch (consecutiveLosses) {
    case 0:
      return 1.3;
    case 1:
      return 1.2;
    case 2:
      return 1;
    default:
      return 1.3;
  }
}

// ============= TOKEN LAUNCH ON WORKER WALLET =============

/**
 * Запуск токена на рабочем кошельке (для менеджера циклов)
 * 
 * @param workerKeypair - Keypair рабочего кошелька
 * @param walletName - Имя кошелька для логов
 * @param solAmount - Количество SOL для покупки
 * @param connection - Solana Connection
 * @param twitterUser - Данные Twitter пользователя (опционально)
 * @param vanityMint - Готовый ванити-ключ для mint (опционально)
 *                     Если не передан — генерируется обычный Keypair
 */
export async function launchTokenOnWorkerWallet(
  workerKeypair: Keypair,
  walletName: string,
  solAmount: number,
  connection: Connection,
  twitterUser?: TwitterUser,
  vanityMint?: Keypair  // ← НОВЫЙ ПАРАМЕТР
): Promise<WorkerLaunchResult> {
  console.log(chalk.cyan.bold(`\n🚀 Запуск токена на ${walletName}`));
  console.log(chalk.cyan(`💰 Инвестиция: ${solAmount} SOL`));
  
  // Показываем, используется ли ванити-адрес
  if (vanityMint) {
    console.log(chalk.green(`🎯 Ванити-адрес: ${vanityMint.publicKey.toBase58()}`));
  } else {
    console.log(chalk.yellow(`📍 Обычный адрес (без ванити)`));
  }
  console.log('');

  const initialBalance = await getBalance(workerKeypair.publicKey, connection);
  console.log(chalk.yellow(`💰 Начальный баланс: ${initialBalance.toFixed(4)} SOL\n`));

  // Переменные для хранения информации о токене
  let tokenName = `Token_${walletName}`;
  let tokenSymbol = `TKN${Math.random().toString(36).substring(7).toUpperCase()}`;
  let tokenUri = 'https://pump.fun';
  let tokenDescription = `Token created by ${walletName}`;

  // Если есть Twitter пользователь, используем его данные
  if (twitterUser) {
    console.log(chalk.cyan(`📝 Twitter: @${twitterUser.username}`));
    console.log(chalk.cyan(`📊 Имя: ${twitterUser.name}\n`));

    try {
      // Подготавливаем ассеты (фото)
      const tokenAssets = await prepareTokenAssets(twitterUser);
      
      if (!tokenAssets.uri) {
        throw new Error('Не удалось подготовить ассеты для токена');
      }

      // Загружаем на IPFS и получаем URI
      tokenUri = await createTokenUriWithPinata(
        tokenAssets.name,
        tokenAssets.symbol,
        tokenAssets.description,
        tokenAssets.uri,
        `https://x.com/${twitterUser.username}`,
        twitterUser.username
      );

      tokenName = tokenAssets.name;
      tokenSymbol = tokenAssets.symbol;
      tokenDescription = tokenAssets.description;

      console.log(chalk.green(`✅ Метаданные загружены на IPFS: ${tokenUri}\n`));
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Ошибка при подготовке метаданных: ${(error as Error).message}`));
      console.warn(chalk.yellow(`   Используем стандартные значения\n`));
    }
  }

  try {
    // ============= ВЫБОР MINT KEYPAIR =============
    // Используем переданный ванити-ключ или генерируем новый
    const mint = vanityMint || Keypair.generate();
    
    console.log(chalk.cyan(`📍 Mint адрес: ${mint.publicKey.toBase58()}`));
    console.log(chalk.cyan(`   Окончание: ...${mint.publicKey.toBase58().slice(-4)}\n`));

    // Инициализируем SDK для Pump.fun
    const onlineSdk = new OnlinePumpSdk(connection);
    const offlineSdk = new PumpSdk();

    // Получаем глобальные параметры от Pump.fun
    console.log(chalk.cyan('📡 Получение глобальных параметров...\n'));
    const global = await getWithRetry(async () => {
      const result = await onlineSdk.fetchGlobal();
      
      if (!result || typeof result !== 'object') {
        throw new Error(`Invalid global data: expected object, got ${typeof result}`);
      }
      
      return result;
    });

    // Рассчитываем количество токенов для покупки
    const solAmountInLamports = new BN(Math.floor(solAmount * LAMPORTS_PER_SOL));
    const tokenAmount = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig: null,
      mintSupply: null,
      bondingCurve: null,
      amount: solAmountInLamports,
    });

    if (!tokenAmount || (tokenAmount as any).isZero?.()) {
      throw new Error('Failed to calculate token amount');
    }

    // Создаем инструкции для транзакции
    console.log(chalk.cyan('🔧 Создание инструкций транзакции...\n'));
    let instructions;
    try {
      instructions = await offlineSdk.createV2AndBuyInstructions({
        global,
        mint: mint.publicKey,
        name: tokenName,
        symbol: tokenSymbol,
        uri: tokenUri,
        creator: workerKeypair.publicKey,
        user: workerKeypair.publicKey,
        solAmount: solAmountInLamports,
        amount: tokenAmount,
        mayhemMode: false,
      });
    } catch (error) {
      console.error(chalk.red(`❌ Ошибка при создании инструкций:`));
      console.error(chalk.red(`   ${(error as Error).message}`));
      throw error;
    }

    if (!Array.isArray(instructions) || instructions.length === 0) {
      throw new Error('Failed to create transaction instructions: empty array');
    }

    // Отправляем транзакцию
    console.log(chalk.cyan('📤 Отправка транзакции...\n'));
    const transaction = new Transaction().add(...instructions);
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = workerKeypair.publicKey;
    transaction.sign(workerKeypair, mint);

    let signature: string;
    try {
      signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      console.log(chalk.green(`✅ Транзакция отправлена!`));
      console.log(chalk.yellow(`📌 Сигнатура: ${signature}`));
      console.log(chalk.green(`🔗 https://pump.fun/${mint.publicKey.toBase58()}\n`));
    } catch (error: any) {
      console.error(chalk.red(`❌ Ошибка при отправке транзакции:`));
      console.error(chalk.red(`   ${error.message}`));

      if (error.logs && Array.isArray(error.logs)) {
        console.error(chalk.red(`📋 Логи транзакции:`));
        error.logs.forEach((log: string, index: number) => {
          console.error(chalk.red(`   [${index}] ${log}`));
        });
      }

      const currentBalance = await checkBalance(workerKeypair.publicKey.toBase58(), connection);
      console.error(chalk.red(`💰 Текущий баланс: ${currentBalance.toFixed(4)} SOL`));

      throw error;
    }

    // Поиск созданного токена
    const workerAddr = new PublicKey(workerKeypair.publicKey.toBase58());
    let tokenFound = false;
    let attempts = 0;
    const maxAttempts = 300;

    console.log(chalk.cyan('🔍 Поиск созданного токена...\n'));
    while (!tokenFound && attempts < maxAttempts) {
      try {
        const accounts = await connection.getParsedTokenAccountsByOwner(workerAddr, {
          programId: TOKEN_2022_PROGRAM_ID,
        });

        for (const account of accounts.value) {
          const parsedInfo = account.account.data.parsed.info;
          if (parsedInfo.mint === mint.publicKey.toString()) {
            tokenFound = true;
            console.log(chalk.green(`✅ Токен найден!\n`));
            break;
          }
        }
      } catch (error) {
        // Игнорируем ошибки и продолжаем
      }

      if (!tokenFound) {
        attempts++;
        if (attempts % 30 === 0) {
          console.log(chalk.gray(`⏳ Попытка ${attempts}/${maxAttempts}...`));
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!tokenFound) {
      console.warn(chalk.yellow(`⚠️  Токен не найден после ${maxAttempts} попыток`));
    }

    // Подготавливаем данные для отслеживания и продажи
    const bCurve = getBondingCurve(mint.publicKey, PUMP_PROGRAM_ID);
    const aBCurve = getAssociatedTokenAddressSync(mint.publicKey, bCurve, true, TOKEN_2022_PROGRAM_ID);

    const mintData: MintData = {
      mint: mint.publicKey.toBase58(),
      bCurve: bCurve.toBase58(),
      aBCurve: aBCurve.toBase58(),
      userQuoteToken: getAssociatedTokenAddressSync(
        new PublicKey('So11111111111111111111111111111111111111112'),
        workerAddr,
        false,
        TOKEN_PROGRAM_ID
      ).toBase58(),
      twitterUrl: twitterUser ? `https://x.com/${twitterUser.username}` : undefined,
      twitterUsername: twitterUser?.username,
    };

    wipeAmountsFile();
    saveAmount(workerKeypair.publicKey.toBase58(), tokenAmount.toNumber() / 1e6);

    // Запускаем отслеживание и продажу
    console.log(chalk.cyan.bold('\n═══════════════════════════════════════'));
    console.log(chalk.cyan.bold('📊 ОТСЛЕЖИВАНИЕ И ПРОДАЖА'));
    console.log(chalk.cyan.bold('═══════════════════════════════════════\n'));

    const workerPrivateKeyBase58 = bs58.encode(workerKeypair.secretKey);
    
    await checkCurveAndSell(
      false,
      mintData,
      workerKeypair.publicKey.toBase58(),
      workerPrivateKeyBase58
    );

    await new Promise(resolve => setTimeout(resolve, 5000));

    const finalBalance = await getBalance(workerKeypair.publicKey, connection);
    const profit = finalBalance - initialBalance;

    console.log(chalk.yellow(`💰 Финальный баланс: ${finalBalance.toFixed(4)} SOL`));

    if (profit > 0) {
      console.log(chalk.green(`✅ Прибыль: +${profit.toFixed(4)} SOL\n`));
    } else {
      console.log(chalk.red(`❌ Убыток: ${profit.toFixed(4)} SOL\n`));
    }

    return {
      walletName,
      walletAddress: workerKeypair.publicKey.toBase58(),
      solAmount,
      initialBalance,
      finalBalance,
      profit,
      isProfit: profit > 0,
      mint: mint.publicKey.toBase58(),
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка при запуске токена на ${walletName}: ${(error as Error).message}`));

    const finalBalance = await getBalance(workerKeypair.publicKey, connection);
    const profit = finalBalance - initialBalance;

    return {
      walletName,
      walletAddress: workerKeypair.publicKey.toBase58(),
      solAmount,
      initialBalance,
      finalBalance,
      profit,
      isProfit: false,
      mint: '',
      timestamp: Date.now(),
    };
  }
}

// ============= EXPORTS =============

export default {
  launchTokenOnWorkerWallet,
  getBuyAmount,
};