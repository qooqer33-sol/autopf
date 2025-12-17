/**
 * Модуль для управления пулом ванити-ключей
 * Генерирует и хранит Keypair с адресами, оканчивающимися на "pump"
 * 
 * Особенности:
 * - Автоматическая фоновая генерация во время паузы между циклами
 * - Потокобезопасное управление пулом
 * - Автосохранение в файл
 * - Статистика генерации
 */

import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';
import chalk from 'chalk';

// ============= КОНФИГУРАЦИЯ =============

export const VANITY_POOL_CONFIG = {
  // Путь к файлу пула
  poolFilePath: path.join(process.cwd(), 'vanity_pool.json'),
  
  // Желаемое окончание адреса
  suffix: 'pump',
  
  // Минимальное количество ключей в пуле (если меньше — генерируем)
  minPoolSize: 10,
  
  // Целевое количество ключей в пуле
  targetPoolSize: 30,
  
  // Сколько ключей нужно на один цикл
  keysPerCycle: 3,
  
  // Интервал логирования при генерации (в попытках)
  logInterval: 100_000,
  
  // Интервал автосохранения (в сгенерированных ключах)
  autoSaveInterval: 1,
};

// ============= ТИПЫ =============

interface VanityKey {
  publicKey: string;
  secretKey: string;
  createdAt: number;
  used: boolean;
  usedAt?: number;
}

interface PoolStats {
  total: number;
  available: number;
  used: number;
  lastGenerated?: number;
  generationRate?: number; // ключей в минуту
}

interface GenerationSession {
  startTime: number;
  keysGenerated: number;
  totalAttempts: number;
  isRunning: boolean;
}

// ============= ГЛОБАЛЬНОЕ СОСТОЯНИЕ =============

let pool: VanityKey[] = [];
let generationSession: GenerationSession | null = null;
let shouldStopGeneration = false;

// ============= РАБОТА С ФАЙЛОМ =============

/**
 * Загрузить пул из файла
 */
export function loadPool(): VanityKey[] {
  try {
    if (fs.existsSync(VANITY_POOL_CONFIG.poolFilePath)) {
      const data = fs.readFileSync(VANITY_POOL_CONFIG.poolFilePath, 'utf-8');
      pool = JSON.parse(data);
      console.log(chalk.cyan(`📂 Загружен пул: ${pool.length} ключей (${pool.filter(k => !k.used).length} доступно)`));
      return pool;
    }
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка загрузки пула: ${(error as Error).message}`));
  }
  pool = [];
  return pool;
}

/**
 * Сохранить пул в файл
 */
export function savePool(): void {
  try {
    fs.writeFileSync(VANITY_POOL_CONFIG.poolFilePath, JSON.stringify(pool, null, 2));
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка сохранения пула: ${(error as Error).message}`));
  }
}

// ============= УПРАВЛЕНИЕ ПУЛОМ =============

/**
 * Получить статистику пула
 */
export function getPoolStats(): PoolStats {
  const available = pool.filter(k => !k.used);
  const used = pool.filter(k => k.used);
  
  return {
    total: pool.length,
    available: available.length,
    used: used.length,
    lastGenerated: available.length > 0 
      ? Math.max(...available.map(k => k.createdAt))
      : undefined,
    generationRate: generationSession?.isRunning 
      ? (generationSession.keysGenerated / ((Date.now() - generationSession.startTime) / 60000))
      : undefined,
  };
}

/**
 * Проверить, достаточно ли ключей для следующего цикла
 */
export function hasEnoughKeys(count: number = VANITY_POOL_CONFIG.keysPerCycle): boolean {
  const available = pool.filter(k => !k.used).length;
  return available >= count;
}

/**
 * Получить указанное количество ванити-ключей из пула
 * @param count - количество ключей
 * @returns массив Keypair
 * @throws Error если недостаточно ключей
 */
export function getVanityKeypairs(count: number = VANITY_POOL_CONFIG.keysPerCycle): Keypair[] {
  const available = pool.filter(k => !k.used);
  
  if (available.length < count) {
    throw new Error(
      `Недостаточно ванити-ключей в пуле! ` +
      `Нужно: ${count}, доступно: ${available.length}. ` +
      `Запустите генерацию: generateVanityKeys(${count - available.length})`
    );
  }
  
  const keypairs: Keypair[] = [];
  const now = Date.now();
  
  for (let i = 0; i < count; i++) {
    const key = available[i];
    key.used = true;
    key.usedAt = now;
    
    const secretKey = bs58.decode(key.secretKey);
    keypairs.push(Keypair.fromSecretKey(secretKey));
    
    console.log(chalk.green(`🔑 Выдан ключ ${i + 1}/${count}: ...${key.publicKey.slice(-8)}`));
  }
  
  savePool();
  
  const stats = getPoolStats();
  console.log(chalk.cyan(`📊 Осталось в пуле: ${stats.available} ключей\n`));
  
  return keypairs;
}

/**
 * Добавить ключ в пул
 */
export function addKeyToPool(keypair: Keypair): void {
  const key: VanityKey = {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: bs58.encode(keypair.secretKey),
    createdAt: Date.now(),
    used: false,
  };
  
  pool.push(key);
}

/**
 * Очистить использованные ключи из пула
 */
export function cleanupUsedKeys(): number {
  const before = pool.length;
  pool = pool.filter(k => !k.used);
  const removed = before - pool.length;
  
  if (removed > 0) {
    savePool();
    console.log(chalk.yellow(`🧹 Удалено ${removed} использованных ключей`));
  }
  
  return removed;
}

// ============= ГЕНЕРАЦИЯ КЛЮЧЕЙ =============

/**
 * Генерация одного ванити-ключа (синхронно)
 */
function generateSingleVanityKey(): { keypair: Keypair; attempts: number } {
  const suffix = VANITY_POOL_CONFIG.suffix.toLowerCase();
  let attempts = 0;
  
  while (true) {
    attempts++;
    const keypair = Keypair.generate();
    const address = keypair.publicKey.toBase58();
    
    if (address.toLowerCase().endsWith(suffix)) {
      return { keypair, attempts };
    }
  }
}

/**
 * Генерация указанного количества ванити-ключей
 * @param count - количество ключей для генерации
 * @param onProgress - колбэк для отслеживания прогресса
 */
export async function generateVanityKeys(
  count: number,
  onProgress?: (generated: number, total: number, rate: number) => void
): Promise<number> {
  console.log(chalk.cyan.bold(`\n🎯 Генерация ${count} ванити-ключей с окончанием "${VANITY_POOL_CONFIG.suffix}"...\n`));
  
  const startTime = Date.now();
  let totalAttempts = 0;
  let generated = 0;
  
  generationSession = {
    startTime,
    keysGenerated: 0,
    totalAttempts: 0,
    isRunning: true,
  };
  
  shouldStopGeneration = false;
  
  for (let i = 0; i < count; i++) {
    if (shouldStopGeneration) {
      console.log(chalk.yellow(`\n⚠️ Генерация остановлена пользователем`));
      break;
    }
    
    const keyStartTime = Date.now();
    const { keypair, attempts } = generateSingleVanityKey();
    const keyTime = ((Date.now() - keyStartTime) / 1000).toFixed(1);
    
    totalAttempts += attempts;
    generated++;
    
    addKeyToPool(keypair);
    
    // Автосохранение
    if (generated % VANITY_POOL_CONFIG.autoSaveInterval === 0) {
      savePool();
    }
    
    // Обновляем сессию
    generationSession.keysGenerated = generated;
    generationSession.totalAttempts = totalAttempts;
    
    // Вычисляем скорость
    const elapsed = (Date.now() - startTime) / 60000; // минуты
    const rate = generated / elapsed;
    
    console.log(chalk.green(
      `✅ [${generated}/${count}] ` +
      `Адрес: ...${keypair.publicKey.toBase58().slice(-8)} | ` +
      `Время: ${keyTime}с | ` +
      `Попыток: ${attempts.toLocaleString()} | ` +
      `Скорость: ${rate.toFixed(1)} ключ/мин`
    ));
    
    if (onProgress) {
      onProgress(generated, count, rate);
    }
    
    // Даём event loop передохнуть
    await new Promise(resolve => setImmediate(resolve));
  }
  
  generationSession.isRunning = false;
  savePool();
  
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgAttempts = Math.floor(totalAttempts / generated);
  
  console.log(chalk.cyan.bold(`\n═══════════════════════════════════════`));
  console.log(chalk.cyan.bold(`📊 ИТОГИ ГЕНЕРАЦИИ`));
  console.log(chalk.cyan.bold(`═══════════════════════════════════════`));
  console.log(chalk.cyan(`   Сгенерировано: ${generated} ключей`));
  console.log(chalk.cyan(`   Общее время: ${totalTime} сек`));
  console.log(chalk.cyan(`   Всего попыток: ${totalAttempts.toLocaleString()}`));
  console.log(chalk.cyan(`   Среднее попыток на ключ: ${avgAttempts.toLocaleString()}`));
  console.log(chalk.cyan(`   В пуле доступно: ${getPoolStats().available} ключей\n`));
  
  return generated;
}

/**
 * Остановить генерацию
 */
export function stopGeneration(): void {
  shouldStopGeneration = true;
  console.log(chalk.yellow(`⏹️ Запрос на остановку генерации...`));
}

/**
 * Проверить, идёт ли генерация
 */
export function isGenerating(): boolean {
  return generationSession?.isRunning ?? false;
}

// ============= ФОНОВАЯ ГЕНЕРАЦИЯ =============

/**
 * Запустить фоновую генерацию во время паузы
 * Генерирует ключи до достижения targetPoolSize или до остановки
 * 
 * @param durationMs - максимальная длительность генерации в мс (по умолчанию 55 минут)
 * @param onComplete - колбэк по завершению
 */
export async function startBackgroundGeneration(
  durationMs: number = 55 * 60 * 1000, // 55 минут (оставляем 5 минут запас)
  onComplete?: (generated: number) => void
): Promise<number> {
  const stats = getPoolStats();
  const needed = VANITY_POOL_CONFIG.targetPoolSize - stats.available;
  
  if (needed <= 0) {
    console.log(chalk.green(`✅ Пул уже заполнен (${stats.available} ключей)`));
    return 0;
  }
  
  console.log(chalk.cyan.bold(`\n🔄 ФОНОВАЯ ГЕНЕРАЦИЯ ВАНИТИ-КЛЮЧЕЙ`));
  console.log(chalk.cyan(`   Текущий размер пула: ${stats.available}`));
  console.log(chalk.cyan(`   Целевой размер: ${VANITY_POOL_CONFIG.targetPoolSize}`));
  console.log(chalk.cyan(`   Нужно сгенерировать: ${needed}`));
  console.log(chalk.cyan(`   Максимальное время: ${(durationMs / 60000).toFixed(0)} мин\n`));
  
  const startTime = Date.now();
  let generated = 0;
  
  generationSession = {
    startTime,
    keysGenerated: 0,
    totalAttempts: 0,
    isRunning: true,
  };
  
  shouldStopGeneration = false;
  
  while (generated < needed) {
    // Проверяем таймаут
    if (Date.now() - startTime > durationMs) {
      console.log(chalk.yellow(`\n⏰ Время генерации истекло`));
      break;
    }
    
    // Проверяем остановку
    if (shouldStopGeneration) {
      console.log(chalk.yellow(`\n⚠️ Генерация остановлена`));
      break;
    }
    
    const { keypair, attempts } = generateSingleVanityKey();
    
    addKeyToPool(keypair);
    generated++;
    
    generationSession.keysGenerated = generated;
    generationSession.totalAttempts += attempts;
    
    // Сохраняем каждый ключ
    savePool();
    
    const elapsed = (Date.now() - startTime) / 60000;
    const rate = generated / elapsed;
    const remaining = Math.ceil((needed - generated) / rate);
    
    console.log(chalk.green(
      `✅ [${generated}/${needed}] ` +
      `...${keypair.publicKey.toBase58().slice(-8)} | ` +
      `${rate.toFixed(1)} ключ/мин | ` +
      `~${remaining} мин осталось`
    ));
    
    // Даём event loop передохнуть
    await new Promise(resolve => setImmediate(resolve));
  }
  
  generationSession.isRunning = false;
  
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(chalk.cyan.bold(`\n✅ Фоновая генерация завершена: ${generated} ключей за ${totalTime} мин`));
  console.log(chalk.cyan(`   В пуле доступно: ${getPoolStats().available} ключей\n`));
  
  if (onComplete) {
    onComplete(generated);
  }
  
  return generated;
}

// ============= ИНИЦИАЛИЗАЦИЯ =============

/**
 * Инициализация модуля
 * Загружает пул и проверяет его состояние
 */
export function initVanityPool(): PoolStats {
  loadPool();
  
  const stats = getPoolStats();
  
  console.log(chalk.cyan.bold(`\n═══════════════════════════════════════`));
  console.log(chalk.cyan.bold(`🔑 ПУЛЛ ВАНИТИ-КЛЮЧЕЙ`));
  console.log(chalk.cyan.bold(`═══════════════════════════════════════`));
  console.log(chalk.cyan(`   Всего ключей: ${stats.total}`));
  console.log(chalk.cyan(`   Доступно: ${stats.available}`));
  console.log(chalk.cyan(`   Использовано: ${stats.used}`));
  console.log(chalk.cyan(`   Нужно на цикл: ${VANITY_POOL_CONFIG.keysPerCycle}`));
  
  if (stats.available < VANITY_POOL_CONFIG.keysPerCycle) {
    console.log(chalk.red(`\n⚠️  ВНИМАНИЕ: Недостаточно ключей для следующего цикла!`));
    console.log(chalk.yellow(`   Запустите генерацию перед началом цикла\n`));
  } else if (stats.available < VANITY_POOL_CONFIG.minPoolSize) {
    console.log(chalk.yellow(`\n⚠️  Рекомендуется пополнить пул (меньше ${VANITY_POOL_CONFIG.minPoolSize} ключей)\n`));
  } else {
    console.log(chalk.green(`\n✅ Пул готов к работе\n`));
  }
  
  return stats;
}

// ============= ЭКСПОРТ =============

export default {
  // Конфигурация
  VANITY_POOL_CONFIG,
  
  // Инициализация
  initVanityPool,
  
  // Управление пулом
  loadPool,
  savePool,
  getPoolStats,
  hasEnoughKeys,
  getVanityKeypairs,
  cleanupUsedKeys,
  
  // Генерация
  generateVanityKeys,
  startBackgroundGeneration,
  stopGeneration,
  isGenerating,
};