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
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.RPC_URL || 'http://fra.corvus-labs.io:8899';
const connection = new Connection(RPC_URL, { commitment: 'confirmed' });

interface WalletInfo {
  publicKey: string;
  privateKey: string;
  name: string;
  createdAt: string;
}

interface RoundInfo {
  roundId: string;
  bankWallet: WalletInfo;
  intermediateWallet: WalletInfo; // Б1
  workerWallets: WalletInfo[]; // С1, С2, С3
  startBalance: number;
  endBalance: number;
  profit: number;
  isProfit: boolean;
  createdAt: string;
}

// Создание нового кошелька
function createWallet(): Keypair {
  return Keypair.generate();
}

// Сохранение бекапа кошелька
function saveWalletBackup(wallet: Keypair, name: string, roundId: string): WalletInfo {
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

  console.log(chalk.green(`✅ Бекап кошелька ${name} сохранен: ${filename}`));
  
  return walletInfo;
}

// Отправка SOL
async function sendSol(
  fromKeypair: Keypair,
  toPublicKey: PublicKey,
  amountSol: number
): Promise<string> {
  try {
    const instruction = SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey: toPublicKey,
      lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
    });

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair]);
    
    console.log(chalk.green(`✅ Отправлено ${amountSol} SOL на ${toPublicKey.toBase58()}`));
    console.log(chalk.gray(`   Сигнатура: ${signature}\n`));
    
    return signature;
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка при отправке SOL: ${(error as Error).message}`));
    throw error;
  }
}

// Получение баланса кошелька
async function getBalance(publicKey: PublicKey): Promise<number> {
  try {
    const balance = await connection.getBalance(publicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка при получении баланса: ${(error as Error).message}`));
    return 0;
  }
}

// Создание раунда с кошельками
async function createRound(bankKeypair: Keypair, roundId: string): Promise<RoundInfo> {
  console.log(chalk.cyan.bold(`\n╔════════════════════════════════════════╗`));
  console.log(chalk.cyan.bold(`║  СОЗДАНИЕ НОВОГО РАУНДА: ${roundId.substring(0, 8)}...  ║`));
  console.log(chalk.cyan.bold(`╚════════════════════════════════════════╝\n`));

  // Получаем начальный баланс банка
  const startBalance = await getBalance(bankKeypair.publicKey);
  console.log(chalk.yellow(`💰 Начальный баланс банка: ${startBalance.toFixed(4)} SOL\n`));

  // Создаем кошелек Б1 (промежуточный)
  console.log(chalk.cyan('📌 Создание промежуточного кошелька Б1...'));
  const intermediateKeypair = createWallet();
  const intermediateInfo = saveWalletBackup(intermediateKeypair, 'B1_intermediate', roundId);

  // Отправляем 6 SOL на Б1
  console.log(chalk.cyan('📤 Отправка 6 SOL на кошелек Б1...'));
  await sendSol(bankKeypair, intermediateKeypair.publicKey, 6);

  // Создаем рабочие кошельки С1, С2, С3
  console.log(chalk.cyan('📌 Создание рабочих кошельков С1, С2, С3...'));
  const workerWallets: WalletInfo[] = [];
  const workerKeypairs: Keypair[] = [];

  for (let i = 1; i <= 3; i++) {
    const workerKeypair = createWallet();
    workerKeypairs.push(workerKeypair);
    const workerInfo = saveWalletBackup(workerKeypair, `C${i}_worker`, roundId);
    workerWallets.push(workerInfo);

    // Отправляем 1.99 SOL на каждый рабочий кошелек
    console.log(chalk.cyan(`📤 Отправка 1.99 SOL на кошелек С${i}...`));
    await sendSol(intermediateKeypair, workerKeypair.publicKey, 1.99);
  }

  const bankInfo: WalletInfo = {
    publicKey: bankKeypair.publicKey.toBase58(),
    privateKey: bs58.encode(bankKeypair.secretKey),
    name: 'A_bank',
    createdAt: new Date().toISOString(),
  };

  const roundInfo: RoundInfo = {
    roundId,
    bankWallet: bankInfo,
    intermediateWallet: intermediateInfo,
    workerWallets,
    startBalance,
    endBalance: 0,
    profit: 0,
    isProfit: false,
    createdAt: new Date().toISOString(),
  };

  console.log(chalk.green.bold(`\n✅ Раунд ${roundId} успешно создан!\n`));

  return roundInfo;
}

// Сбор всей SOL обратно на банк
async function collectAllSol(
  bankKeypair: Keypair,
  intermediatePrivateKey: string,
  workerPrivateKeys: string[],
  roundInfo: RoundInfo
): Promise<void> {
  console.log(chalk.cyan.bold(`\n╔════════════════════════════════════════╗`));
  console.log(chalk.cyan.bold(`║  СБОР SOL НА БАНК                      ║`));
  console.log(chalk.cyan.bold(`╚════════════════════════════════════════╝\n`));

  // Восстанавливаем кошельки из приватных ключей
  const intermediateKeypair = Keypair.fromSecretKey(bs58.decode(intermediatePrivateKey));
  const workerKeypairs = workerPrivateKeys.map(key => Keypair.fromSecretKey(bs58.decode(key)));

  // Собираем SOL с рабочих кошельков
  for (let i = 0; i < workerKeypairs.length; i++) {
    const balance = await getBalance(workerKeypairs[i].publicKey);
    if (balance > 0.001) { // Оставляем небольшой запас на комиссии
      console.log(chalk.cyan(`💸 Сбор ${balance.toFixed(4)} SOL с кошелька С${i + 1}...`));
      try {
        await sendSol(workerKeypairs[i], bankKeypair.publicKey, balance - 0.0005);
      } catch (error) {
        console.error(chalk.red(`❌ Ошибка при сборе с С${i + 1}: ${(error as Error).message}`));
      }
    }
  }

  // Собираем SOL с промежуточного кошелька
  const intermediateBalance = await getBalance(intermediateKeypair.publicKey);
  if (intermediateBalance > 0.001) {
    console.log(chalk.cyan(`💸 Сбор ${intermediateBalance.toFixed(4)} SOL с кошелька Б1...`));
    try {
      await sendSol(intermediateKeypair, bankKeypair.publicKey, intermediateBalance - 0.0005);
    } catch (error) {
      console.error(chalk.red(`❌ Ошибка при сборе с Б1: ${(error as Error).message}`));
    }
  }

  // Получаем финальный баланс
  const endBalance = await getBalance(bankKeypair.publicKey);
  roundInfo.endBalance = endBalance;
  roundInfo.profit = endBalance - roundInfo.startBalance;
  roundInfo.isProfit = roundInfo.profit > 0;

  console.log(chalk.yellow(`\n💰 Финальный баланс банка: ${endBalance.toFixed(4)} SOL`));
  
  if (roundInfo.isProfit) {
    console.log(chalk.green(`✅ ПРИБЫЛЬ: +${roundInfo.profit.toFixed(4)} SOL\n`));
  } else {
    console.log(chalk.red(`❌ УБЫТОК: ${roundInfo.profit.toFixed(4)} SOL\n`));
  }

  // Сохраняем информацию о раунде
  const roundInfoFile = path.join(process.cwd(), 'wallets_backups', roundInfo.roundId, 'round_info.json');
  fs.writeFileSync(roundInfoFile, JSON.stringify(roundInfo, null, 2));
  console.log(chalk.green(`✅ Информация о раунде сохранена: ${roundInfoFile}\n`));
}

// Получение информации о кошельке из бекапа
function loadWalletFromBackup(backupPath: string): WalletInfo {
  const data = fs.readFileSync(backupPath, 'utf-8');
  return JSON.parse(data);
}

export {
  createWallet,
  saveWalletBackup,
  sendSol,
  getBalance,
  createRound,
  collectAllSol,
  loadWalletFromBackup,
  WalletInfo,
  RoundInfo,
};