/**
 * Модуль для управления кошельками Solana
 * С проверкой баланса получателя вместо отправителя
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { WalletInfo } from './cycle-types';
import { getWithRetry } from './helper';

// ============= EMERGENCY WALLET BACKUP =============

/**
 * Сохранение приватного ключа в emergency папку (НЕМЕДЛЕННО)
 */
function saveEmergencyWallet(keypair: Keypair, name: string): void {
  try {
    const emergencyDir = path.join(process.cwd(), 'emergency_wallets');

    if (!fs.existsSync(emergencyDir)) {
      fs.mkdirSync(emergencyDir, { recursive: true });
    }

    const walletData = {
      name,
      publicKey: keypair.publicKey.toBase58(),
      privateKey: bs58.encode(keypair.secretKey),
      createdAt: new Date().toISOString(),
      timestamp: Date.now(),
    };

    const filename = path.join(emergencyDir, `${name}_${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify(walletData, null, 2));

    console.log(chalk.green(`✅ Приватный ключ сохранен: emergency_wallets/${path.basename(filename)}`));
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка при сохранении приватного ключа: ${(error as Error).message}`));
  }
}

/**
 * Получение всех сохраненных приватных ключей из emergency папки
 */
export function getEmergencyWallets(): any[] {
  try {
    const emergencyDir = path.join(process.cwd(), 'emergency_wallets');

    if (!fs.existsSync(emergencyDir)) {
      return [];
    }

    const files = fs.readdirSync(emergencyDir);
    const wallets = files.map(file => {
      const filepath = path.join(emergencyDir, file);
      const data = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(data);
    });

    return wallets;
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка при получении emergency кошельков: ${(error as Error).message}`));
    return [];
  }
}

/**
 * Вывод всех сохраненных кошельков
 */
export function printEmergencyWallets(): void {
  const wallets = getEmergencyWallets();

  if (wallets.length === 0) {
    console.log(chalk.yellow(`⚠️  Нет сохраненных кошельков в emergency_wallets/\n`));
    return;
  }

  console.log(chalk.cyan.bold(`\n╔════════════════════════════════════════╗`));
  console.log(chalk.cyan.bold(`║  СОХРАНЕННЫЕ КОШЕЛЬКИ (EMERGENCY)     ║`));
  console.log(chalk.cyan.bold(`╚════════════════════════════════════════╝\n`));

  wallets.forEach((wallet, index) => {
    console.log(chalk.cyan(`${index + 1}. ${wallet.name}`));
    console.log(chalk.cyan(`   Адрес: ${wallet.publicKey}`));
    console.log(chalk.cyan(`   Создан: ${wallet.createdAt}\n`));
  });
}

// ============= WALLET CREATION =============

/**
 * Создание нового кошелька с немедленным сохранением приватного ключа
 */
export function createWallet(name?: string): Keypair {
  const keypair = Keypair.generate();

  // Немедленно сохраняем приватный ключ в emergency папку
  const walletName = name || `wallet_${Date.now()}`;
  saveEmergencyWallet(keypair, walletName);

  return keypair;
}

/**
 * Восстановление кошелька из приватного ключа (Base58)
 */
export function restoreKeypairFromPrivateKey(privateKeyBs58: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKeyBs58));
}

/**
 * Восстановление кошелька из приватного ключа (Uint8Array)
 */
export function getKeypairFromSecretKey(secretKey: Uint8Array): Keypair {
  return Keypair.fromSecretKey(secretKey);
}

// ============= WALLET BACKUP =============

/**
 * Сохранение бекапа кошелька
 */
export function saveWalletBackup(wallet: Keypair, name: string, roundId: string): WalletInfo {
  const backupDir = path.join(process.cwd(), 'wallets_backups', roundId);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const walletInfo: WalletInfo = {
    publicKey: wallet.publicKey.toBase58(),
    privateKey: bs58.encode(wallet.secretKey),
    name,
    createdAt: new Date().toISOString(),
  };

  const filename = path.join(backupDir, `${name}.json`);
  fs.writeFileSync(filename, JSON.stringify(walletInfo, null, 2));

  console.log(chalk.green(`✅ Бекап кошелька ${name} сохранен`));

  // Дополнительно сохраняем в emergency папку
  saveEmergencyWallet(wallet, `${name}_round_${roundId}`);

  return walletInfo;
}

/**
 * Загрузка кошелька из бекапа
 */
export function loadWalletFromBackup(backupPath: string): WalletInfo | null {
  try {
    if (!fs.existsSync(backupPath)) {
      console.error(chalk.red(`❌ Файл бекапа не найден: ${backupPath}`));
      return null;
    }

    const data = fs.readFileSync(backupPath, 'utf-8');
    return JSON.parse(data) as WalletInfo;
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка при загрузке бекапа: ${(error as Error).message}`));
    return null;
  }
}

// ============= BALANCE OPERATIONS =============

/**
 * Получение баланса кошелька с повторными попытками
 */
export async function getBalance(publicKey: PublicKey, connection: Connection): Promise<number> {
  try {
    const balance = await getWithRetry(async () => {
      return await connection.getBalance(publicKey);
    });
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка при получении баланса: ${(error as Error).message}`));
    return 0;
  }
}

/**
 * Проверка баланса по адресу (строка) с повторными попытками
 */
export async function checkBalance(address: string, connection: Connection): Promise<number> {
  try {
    const balance = await getWithRetry(async () => {
      return await connection.getBalance(new PublicKey(address));
    });
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error(chalk.red(`Ошибка при проверке баланса: ${(error as Error).message}`));
    return 0;
  }
}

// ============= SOL TRANSFERS =============

/**
 * Отправка SOL между кошельками с проверкой баланса получателя
 */
export async function sendSol(
  fromKeypair: Keypair,
  toPublicKey: PublicKey,
  amountSol: number,
  connection: Connection,
  maxRetries: number = 3
): Promise<string> {
  // Сохраняем начальный баланс получателя
  const initialReceiverBalance = await getBalance(toPublicKey, connection);
  const expectedReceiverBalance = initialReceiverBalance + amountSol;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(chalk.cyan(`📤 Попытка ${attempt}/${maxRetries}: отправка ${amountSol} SOL...`));

      const instruction = SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: toPublicKey,
        lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
      });

      const transaction = new Transaction().add(instruction);
      
      // Отправляем транзакцию БЕЗ подтверждения
      const blockHash = await connection.getLatestBlockhash('finalized');
      transaction.recentBlockhash = blockHash.blockhash;
      transaction.feePayer = fromKeypair.publicKey;
      
      transaction.sign(fromKeypair);
      const serialized = transaction.serialize();
      
      const signature = await connection.sendRawTransaction(serialized, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log(chalk.gray(`   Сигнатура: ${signature}`));
      console.log(chalk.gray(`   Ожидание подтверждения...`));

      // Ждем и проверяем баланс получателя
      for (let check = 0; check < 20; check++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const currentReceiverBalance = await getBalance(toPublicKey, connection);
        
        if (currentReceiverBalance >= expectedReceiverBalance) {
          console.log(chalk.gray(`   Баланс получателя до: ${initialReceiverBalance.toFixed(4)} SOL`));
          console.log(chalk.gray(`   Баланс получателя после: ${currentReceiverBalance.toFixed(4)} SOL`));
          console.log(chalk.green(`✅ Отправлено ${amountSol} SOL (проверено по балансу получателя)`));
          return signature;
        }
      }

      // Если после 20 проверок баланс не изменился
      console.log(chalk.yellow(`⚠️  Баланс получателя не изменился за 20 секунд`));
      
      if (attempt < maxRetries) {
        console.log(chalk.gray(`   Ожидание 5 секунд перед повторной попыткой...\n`));
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        throw new Error('Баланс получателя не изменился');
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      console.error(chalk.yellow(`⚠️  Ошибка на попытке ${attempt}/${maxRetries}`));
      console.error(chalk.yellow(`   ${errorMessage.split('\n')[0]}`));

      // Проверяем баланс получателя - может быть транзакция прошла несмотря на ошибку
      await new Promise(resolve => setTimeout(resolve, 3000));
      const currentReceiverBalance = await getBalance(toPublicKey, connection);
      console.log(chalk.gray(`   Баланс получателя: ${currentReceiverBalance.toFixed(4)} SOL`));

      if (currentReceiverBalance >= expectedReceiverBalance) {
        console.log(chalk.green(`✅ Транзакция прошла! (баланс получателя изменился несмотря на ошибку)`));
        return 'unknown_signature';
      }

      if (attempt < maxRetries) {
        console.log(chalk.gray(`   Ожидание 5 секунд перед повторной попыткой...\n`));
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        throw error;
      }
    }
  }

  throw new Error('Не удалось отправить SOL');
}

/**
 * Отправка всего баланса (минус комиссия)
 */
export async function sendAllSol(
  fromKeypair: Keypair,
  toPublicKey: PublicKey,
  connection: Connection,
  maxRetries: number = 3
): Promise<string> {
  const balance = await getBalance(fromKeypair.publicKey, connection);
  
  // ПРАВИЛЬНЫЙ способ: конвертируем в lamports, потом вычитаем
  const balanceLamports = Math.floor(balance * LAMPORTS_PER_SOL);
  const rentExemptLamports = Math.ceil(0.00203 * LAMPORTS_PER_SOL); // 2030 lamports
  const feeLamports = Math.ceil(0.00005 * LAMPORTS_PER_SOL); // 50 lamports
  
  const amountToSendLamports = balanceLamports - rentExemptLamports - feeLamports;

  if (amountToSendLamports <= 0) {
    throw new Error('Недостаточно SOL для отправки');
  }

  // Конвертируем обратно в SOL для отправки
  const amountToSend = amountToSendLamports / LAMPORTS_PER_SOL;

  return sendSol(fromKeypair, toPublicKey, amountToSend, connection, maxRetries);
}

// ============= WALLET INFO =============

/**
 * Получение информации о кошельке
 */
export function getWalletInfo(keypair: Keypair, name: string): WalletInfo {
  const walletInfo = {
    publicKey: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
    name,
    createdAt: new Date().toISOString(),
  };

  // Дополнительно сохраняем в emergency папку
  saveEmergencyWallet(keypair, name);

  return walletInfo;
}

/**
 * Вывод информации о кошельке в консоль
 */
export function logWalletInfo(walletInfo: WalletInfo): void {
  console.log(chalk.cyan(`\n📋 Информация о кошельке ${walletInfo.name}:`));
  console.log(chalk.cyan(`   Адрес: ${walletInfo.publicKey}`));
  console.log(chalk.cyan(`   Создан: ${walletInfo.createdAt}`));
  console.log(chalk.gray(`   💾 Приватный ключ сохранен в emergency_wallets/\n`));
}

export default {
  createWallet,
  restoreKeypairFromPrivateKey,
  getKeypairFromSecretKey,
  saveWalletBackup,
  loadWalletFromBackup,
  getBalance,
  checkBalance,
  sendSol,
  sendAllSol,
  getWalletInfo,
  logWalletInfo,
  getEmergencyWallets,
  printEmergencyWallets,
};