import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas } from 'canvas';
import bs58 from 'bs58';
import axios from 'axios';
import dotenv from 'dotenv';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { PumpSdk, OnlinePumpSdk, getBuyTokenAmountFromSolAmount } from '@pump-fun/pump-sdk';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { getWithRetry } from './helper';
import { getKeypairFromBs58, getBondingCurve } from './create';
import { saveAmount, wipeAmountsFile } from './amountSaver';
import { PUMP_PROGRAM_ID, RPC_URL, WS_URL } from './constants';
import { checkCurveAndSell } from './curveChecker';

dotenv.config();

interface TwitterUser {
  id: string;
  username: string;
  name: string;
  description: string;
  profile_image_url: string;
}

interface LaunchResult {
  username: string;
  name: string;
  mint: string;
  initialBalance: number;
  finalBalance: number;
  profit: number;
  isProfit: boolean;
  timestamp: number;
}

interface BotState {
  lastThreeResults: LaunchResult[];
  consecutiveLosses: number;
  isPaused: boolean;
  pauseUntil: number;
  currentFile: string | null;
  currentUserIndex: number;
}

// Параметры покупки при создании
const BUY_PARAMS = {
  solAmount: 1.3, // Начинаем с 1.3 SOL
};

// Функция для очистки имени от цифр и подчеркивания
function cleanName(input: string): string {
  // Убираем цифры в конце
  let cleaned = input.replace(/\d+$/, '').trim();
  
  // Если есть подчеркивание, берем только первую часть
  if (cleaned.includes('_')) {
    cleaned = cleaned.split('_')[0];
  }
  
  return cleaned || input;
}

// Проверяем есть ли реальное фото
function hasRealProfileImage(imageUrl: string): boolean {
  // Если URL содержит 'default_profile' - это дефолтное фото
  return !imageUrl.includes('default_profile');
}

// Генерируем фото с инициалами
function generateAvatarImage(name: string, filename: string): string {
  try {
    // Получаем первую букву
    const initial = name.charAt(0).toUpperCase();
    
    // Генерируем цвет на основе названия
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
      '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#A8E6CF',
      '#FFD3B6', '#FFAAA5', '#AA96DA', '#FCBAD3', '#A8D8EA'
    ];
    const colorIndex = name.charCodeAt(0) % colors.length;
    const bgColor = colors[colorIndex];
    
    // Создаем канвас
    const canvas = createCanvas(200, 200);
    const ctx = canvas.getContext('2d');
    
    // Рисуем фон
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 200, 200);
    
    // Рисуем текст (буква)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 100px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, 100, 100);
    
    // Сохраняем файл
    const profileDir = path.join(process.cwd(), 'profile_images');
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
    
    const filepath = path.join(profileDir, filename);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(filepath, buffer);
    
    return filepath;
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Ошибка при генерации аватара: ${(error as Error).message}`));
    return '';
  }
}

// Функция для скачивания фото профиля
async function downloadProfileImage(imageUrl: string, filename: string): Promise<string> {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
    });
    
    const filepath = path.join(process.cwd(), 'profile_images', filename);
    
    // Создаем папку если её нет
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filepath, response.data);
    console.log(chalk.green(`✅ Фото скачано: ${filename}`));
    
    return filepath;
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Не удалось скачать фото: ${(error as Error).message}`));
    return '';
  }
}

// Функция для скачивания фото твиттера и вывода метаданных
async function downloadAndLogMetadata(twitterUser: TwitterUser): Promise<void> {
  try {
    // Проверяем есть ли реальное фото
    const imageFilename = `${twitterUser.username}_${Date.now()}.png`;
    let photoStatus = '';
    
    if (!hasRealProfileImage(twitterUser.profile_image_url)) {
      // Генерируем фото с инициалами
      await generateAvatarImage(cleanName(twitterUser.name), imageFilename);
      photoStatus = '(сгенерировано)';
    } else {
      // Скачиваем реальное фото
      await downloadProfileImage(twitterUser.profile_image_url, imageFilename);
      photoStatus = '(скачано)';
    }
    
    console.log(chalk.cyan(`🐜 Метаданные токена:`));
    console.log(chalk.cyan(`  📄 Название: ${cleanName(twitterUser.name)}`));
    console.log(chalk.cyan(`  💵 Тикер: ${cleanName(twitterUser.username)}`));
    console.log(chalk.cyan(`  🔗 Twitter: https://twitter.com/${twitterUser.username}`));
    console.log(chalk.cyan(`  🛸 Фото: ${photoStatus}\n`));

  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Ошибка при обработке фото: ${(error as Error).message}`));
  }
}

// Функция для поиска следующего файла твиттеров
function findNextTwitterFile(lastProcessedFile?: string | null): string | null {
  const currentDir = process.cwd();
  const files = fs.readdirSync(currentDir)
    .filter(file => file.match(/^combined_followers_recent_\d+\.json$/))
    .sort();
  
  if (files.length === 0) {
    return null;
  }
  
  if (!lastProcessedFile) {
    return files[0];
  }
  
  const currentIndex = files.indexOf(lastProcessedFile);
  if (currentIndex === -1 || currentIndex === files.length - 1) {
    return files[0]; // Циклируем на первый файл
  }
  
  return files[currentIndex + 1];
}

// Функция для загрузки твиттеров из файла
function loadTwitterUsers(filepath: string): TwitterUser[] {
  try {
    if (!fs.existsSync(filepath)) {
      throw new Error(`Файл не найден: ${filepath}`);
    }
    
    const data = fs.readFileSync(filepath, 'utf-8');
    
    // Очищаем BOM если есть
    const cleanData = data.charCodeAt(0) === 0xFEFF ? data.slice(1) : data;
    
    let users;
    try {
      users = JSON.parse(cleanData);
    } catch (jsonError) {
      // Пытаемся исправить распространенные ошибки JSON
      const fixedData = cleanData
        .replace(/,\s*}/g, '}') // Убираем запятые перед }
        .replace(/,\s*]/g, ']'); // Убираем запятые перед ]
      users = JSON.parse(fixedData);
    }
    
    if (!Array.isArray(users)) {
      throw new Error('Файл должен содержать массив пользователей');
    }
    
    console.log(chalk.cyan(`📂 Загружено ${users.length} твиттеров из ${path.basename(filepath)}\n`));
    return users;
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка при загрузке файла: ${(error as Error).message}`));
    console.error(chalk.red(`📁 Путь: ${filepath}`));
    return [];
  }
}

// Функция для проверки баланса
async function checkBalance(address: string): Promise<number> {
  try {
    const connection = new Connection(RPC_URL, { commitment: 'confirmed' });
    const balance = await connection.getBalance(new PublicKey(address));
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error(chalk.red(`Ошибка при проверке баланса: ${(error as Error).message}`));
    return 0;
  }
}

// Функция для сохранения состояния бота
function saveBotState(state: BotState): void {
  const stateFile = path.join(process.cwd(), 'bot_state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// Функция для загрузки состояния бота
function loadBotState(): BotState {
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

// Функция для обновления состояния после запуска
function updateBotState(state: BotState, result: LaunchResult): BotState {
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

// Функция для проверки паузы
async function checkAndHandlePause(state: BotState): Promise<BotState> {
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

// Функция для получения динамического количества SOL на основе попыток
// ВРЕМЕННО: используем 0.01 SOL для тестирования
function getBuyAmount(consecutiveLosses: number): number {
  // return 0.01; // Тестовая версия
  switch (consecutiveLosses) {
    case 0:
      return 0.01; // Первый запуск (TEST)
    case 1:
      return 0.01; // После первого убытка (TEST)
    case 2:
      return 0.01; // После второго убытка (TEST)
    default:
      return 0.01;
  }
}

// Основная функция для запуска токена
async function launchToken(twitterUser: TwitterUser, buyAmount: number): Promise<LaunchResult> {
  const devAddress = process.env.DEV_ADDRESS as string;
  
  try {
    console.log(chalk.cyan.bold(`\n🚀 Запуск токена для @${twitterUser.username}`));
    console.log(chalk.cyan(`📝 Имя: ${cleanName(twitterUser.name)}`));
    console.log(chalk.cyan(`📊 Тикер: ${cleanName(twitterUser.username)}`));
    console.log(chalk.cyan(`💰 Инвестиция: ${buyAmount} SOL\n`));
    
    // Проверяем начальный баланс
    const initialBalance = await checkBalance(devAddress);
    console.log(chalk.yellow(`💰 Начальный баланс: ${initialBalance.toFixed(4)} SOL`));
    
    // Скачиваем фото и выводим метаданные
    await downloadAndLogMetadata(twitterUser);
    
    // Создаем токен
    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      wsEndpoint: WS_URL,
    });
    
    const keypair = Keypair.fromSecretKey(bs58.decode(process.env.SIGNER_PRIVATE_KEY!));
    const mint = Keypair.generate();
    
    // Инициализируем SDK
    const onlineSdk = new OnlinePumpSdk(connection);
    const offlineSdk = new PumpSdk();
    
    // Получаем глобальные параметры
    const global = await onlineSdk.fetchGlobal();
    
    // Рассчитываем количество токенов
    const solAmountInLamports = new BN(buyAmount * LAMPORTS_PER_SOL);
    const tokenAmount = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig: null,
      mintSupply: null,
      bondingCurve: null,
      amount: solAmountInLamports,
    });
    
    // Создаем инструкции
    const instructions = await offlineSdk.createV2AndBuyInstructions({
      global,
      mint: mint.publicKey,
      name: cleanName(twitterUser.name),
      symbol: cleanName(twitterUser.username),
      uri: `https://twitter.com/${twitterUser.username}`,
      creator: keypair.publicKey,
      user: keypair.publicKey,
      solAmount: solAmountInLamports,
      amount: tokenAmount,
      mayhemMode: false,
    });
    
    // Отправляем транзакцию
    const transaction = new Transaction().add(...instructions);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = keypair.publicKey;
    transaction.sign(keypair, mint);
    
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    
    console.log(chalk.green(`✅ Транзакция отправлена!`));
    console.log(chalk.yellow(`📌 Сигнатура: ${signature}\n`));
    
    // Поиск токена
    const devAddr = new PublicKey(devAddress);
    let tokenFound = false;
    let attempts = 0;
    const maxAttempts = 300;
    
    while (!tokenFound && attempts < maxAttempts) {
      try {
        const accounts = await connection.getParsedTokenAccountsByOwner(devAddr, {
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
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    if (!tokenFound) {
      throw new Error('Токен не найден после создания');
    }
    
    // Подготавливаем данные для отслеживания кривой
    const bCurve = getBondingCurve(mint.publicKey, PUMP_PROGRAM_ID);
    const aBCurve = getAssociatedTokenAddressSync(mint.publicKey, bCurve, true, TOKEN_2022_PROGRAM_ID);
    
    const mintData = {
      mint: mint.publicKey.toBase58(),
      bCurve: bCurve.toBase58(),
      aBCurve: aBCurve.toBase58(),
      userQuoteToken: getAssociatedTokenAddressSync(
        new PublicKey('So11111111111111111111111111111111111111112'),
        devAddr,
        false,
        TOKEN_PROGRAM_ID
      ).toBase58(),
    };
    
    wipeAmountsFile();
    saveAmount(devAddress, tokenAmount.toNumber() / 1e6);
    
    // Запускаем отслеживание и продажу
    console.log(chalk.cyan.bold('\n═══════════════════════════════════════'));
    console.log(chalk.cyan.bold('📊 ОТСЛЕЖИВАНИЕ И ПРОДАЖА'));
    console.log(chalk.cyan.bold('═══════════════════════════════════════\n'));
    
    await checkCurveAndSell(true, mintData);
    
    // Проверяем финальный баланс
    const finalBalance = await checkBalance(devAddress);
    const profit = finalBalance - initialBalance;
    const isProfit = profit > 0;
    
    console.log(chalk.yellow(`\n💰 Финальный баланс: ${finalBalance.toFixed(4)} SOL`));
    console.log(
      isProfit
        ? chalk.green(`✅ Прибыль: +${profit.toFixed(4)} SOL`)
        : chalk.red(`❌ Убыток: ${profit.toFixed(4)} SOL`)
    );
    
    return {
      username: twitterUser.username,
      name: twitterUser.name,
      mint: mint.publicKey.toBase58(),
      initialBalance,
      finalBalance,
      profit,
      isProfit,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error(chalk.red(`Ошибка при запуске токена: ${(error as Error).message}`));
    
    const finalBalance = await checkBalance(devAddress);
    
    return {
      username: twitterUser.username,
      name: twitterUser.name,
      mint: '',
      initialBalance: 0,
      finalBalance,
      profit: -finalBalance,
      isProfit: false,
      timestamp: Date.now(),
    };
  }
}

// Основная функция
async function main() {
  console.log(chalk.magenta.bold('\n╔════════════════════════════════════════════╗'));
  console.log(chalk.magenta.bold('║     TWITTER TOKEN LAUNCHER BOT              ║'));
  console.log(chalk.magenta.bold('║     (С автоматической загрузкой фото)       ║'));
  console.log(chalk.magenta.bold('╚════════════════════════════════════════════╝\n'));
  
  let botState = loadBotState();
  
  while (true) {
    // Проверяем паузу
    botState = await checkAndHandlePause(botState);
    
    // Ищем файл если его нет
    if (!botState.currentFile) {
      botState.currentFile = findNextTwitterFile(botState.currentFile) || null;
      
      if (!botState.currentFile) {
        console.log(chalk.yellow('⏳ Файлы твиттеров не найдены. Ожидание...'));
        await new Promise(resolve => setTimeout(resolve, 30000));
        continue;
      }
      
      botState.currentUserIndex = 0;
    }
    
    // Загружаем твиттеров из файла
    if (!botState.currentFile) {
      console.log(chalk.red('❌ Текущий файл не установлен'));
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }
    
    const users = loadTwitterUsers(botState.currentFile);
    
    if (users.length === 0) {
      console.log(chalk.yellow('⚠️  Файл пуст или некорректен. Переходим к следующему...\n'));
      botState.currentFile = findNextTwitterFile(botState.currentFile) || null;
      botState.currentUserIndex = 0;
      saveBotState(botState);
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }
    
    // Обрабатываем твиттеров
    while (botState.currentUserIndex < users.length) {
      const user = users[botState.currentUserIndex];
      
      // Получаем динамическое количество SOL
      const buyAmount = getBuyAmount(botState.consecutiveLosses);
      
      // Запускаем токен
      const result = await launchToken(user, buyAmount);
      
      // Обновляем состояние
      botState = updateBotState(botState, result);
      botState.currentUserIndex++;
      saveBotState(botState);
      
      // Если пауза активирована - выходим из цикла
      if (botState.isPaused) {
        break;
      }
      
      // Небольшая задержка между запусками
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Если все твиттеры обработаны - переходим к следующему файлу
    if (botState.currentUserIndex >= users.length) {
      console.log(chalk.green.bold(`\n✅ Файл ${path.basename(botState.currentFile || '')} полностью обработан!\n`));
      botState.currentFile = findNextTwitterFile(botState.currentFile) || null;
      botState.currentUserIndex = 0;
      saveBotState(botState);
    }
  }
}

main().catch(error => {
  console.error(chalk.red.bold('\n❌ КРИТИЧЕСКАЯ ОШИБКА:'));
  console.error(chalk.red(error instanceof Error ? error.message : error));
  process.exit(1);
});