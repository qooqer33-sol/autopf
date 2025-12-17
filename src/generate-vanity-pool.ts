#!/usr/bin/env npx ts-node

/**
 * Скрипт для предварительной генерации пула ванити-ключей
 * 
 * Использование:
 *   npx ts-node src/generate-vanity-pool.ts [количество]
 * 
 * Примеры:
 *   npx ts-node src/generate-vanity-pool.ts        # Генерирует до targetPoolSize (30)
 *   npx ts-node src/generate-vanity-pool.ts 10     # Генерирует 10 ключей
 *   npx ts-node src/generate-vanity-pool.ts 50     # Генерирует 50 ключей
 */

import {
  initVanityPool,
  generateVanityKeys,
  getPoolStats,
  VANITY_POOL_CONFIG,
} from './modules-vanity-pool';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('\n═══════════════════════════════════════'));
  console.log(chalk.cyan.bold('🔑 ГЕНЕРАТОР ПУЛА ВАНИТИ-КЛЮЧЕЙ'));
  console.log(chalk.cyan.bold('═══════════════════════════════════════\n'));
  
  // Инициализация пула
  initVanityPool();
  
  // Получаем текущую статистику
  const stats = getPoolStats();
  
  // Определяем сколько генерировать
  let targetCount: number;
  
  if (process.argv[2]) {
    // Если передано количество в аргументах
    targetCount = parseInt(process.argv[2], 10);
    if (isNaN(targetCount) || targetCount <= 0) {
      console.error(chalk.red('❌ Неверное количество. Используйте положительное число.'));
      process.exit(1);
    }
  } else {
    // По умолчанию генерируем до целевого размера пула
    targetCount = Math.max(0, VANITY_POOL_CONFIG.targetPoolSize - stats.available);
  }
  
  if (targetCount === 0) {
    console.log(chalk.green('✅ Пул уже заполнен!'));
    console.log(chalk.cyan(`   Доступно: ${stats.available} ключей`));
    console.log(chalk.cyan(`   Цель: ${VANITY_POOL_CONFIG.targetPoolSize} ключей\n`));
    return;
  }
  
  console.log(chalk.cyan(`📊 Текущее состояние пула:`));
  console.log(chalk.cyan(`   Всего: ${stats.total}`));
  console.log(chalk.cyan(`   Доступно: ${stats.available}`));
  console.log(chalk.cyan(`   Использовано: ${stats.used}`));
  console.log(chalk.cyan(`\n🎯 Будет сгенерировано: ${targetCount} ключей\n`));
  
  // Оценка времени
  const estimatedMinutes = targetCount * 1.5; // ~1.5 мин на ключ в среднем
  console.log(chalk.yellow(`⏱️  Примерное время: ${estimatedMinutes.toFixed(0)}-${(estimatedMinutes * 2).toFixed(0)} минут\n`));
  
  // Запуск генерации
  const startTime = Date.now();
  
  try {
    await generateVanityKeys(targetCount, (generated, total, rate) => {
      // Колбэк прогресса (уже логируется внутри функции)
    });
  } catch (error) {
    console.error(chalk.red(`\n❌ Ошибка генерации: ${(error as Error).message}`));
    process.exit(1);
  }
  
  // Итоги
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const finalStats = getPoolStats();
  
  console.log(chalk.green.bold('\n═══════════════════════════════════════'));
  console.log(chalk.green.bold('✅ ГЕНЕРАЦИЯ ЗАВЕРШЕНА'));
  console.log(chalk.green.bold('═══════════════════════════════════════'));
  console.log(chalk.green(`   Время: ${totalTime} минут`));
  console.log(chalk.green(`   В пуле доступно: ${finalStats.available} ключей`));
  console.log(chalk.green(`   Файл пула: ${VANITY_POOL_CONFIG.poolFilePath}\n`));
}

main().catch(console.error);