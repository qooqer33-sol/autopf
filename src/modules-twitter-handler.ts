/**
 * Модуль для работы с Twitter данными и фото профилей
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas } from 'canvas';
import axios from 'axios';
import { TwitterUser, TokenMetadata } from './cycle-types';

// ============= TWITTER FILE OPERATIONS =============
const RESULTS_DIR = path.join(process.cwd(), 'results');

export function findNextTwitterFile(lastProcessedFile?: string | null): string | null {
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(file => file.match(/^combined_recent_followers_\d+\.json$/))
    .sort();

  if (files.length === 0) {
    return null;
  }

  // Extract just filename if full path was passed
  const lastFilename = lastProcessedFile ? path.basename(lastProcessedFile) : null;

  if (!lastFilename) {
    return path.join(RESULTS_DIR, files[0]);
  }

  const currentIndex = files.indexOf(lastFilename);
  if (currentIndex === -1 || currentIndex === files.length - 1) {
    return path.join(RESULTS_DIR, files[0]);
  }

  return path.join(RESULTS_DIR, files[currentIndex + 1]);
}

export function loadTwitterUsers(filepath: string): TwitterUser[] {
  try {
    if (!fs.existsSync(filepath)) {
      throw new Error(`Файл не найден: ${filepath}`);
    }
    
    const data = fs.readFileSync(filepath, 'utf-8');
    const cleanData = data.charCodeAt(0) === 0xFEFF ? data.slice(1) : data;
    
    let users;
    try {
      users = JSON.parse(cleanData);
    } catch (jsonError) {
      const fixedData = cleanData
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']');
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

// ============= NAME CLEANING =============

/**
 * Удаляет все цифры из строки
 */
export function removeDigits(input: string): string {
  return input.replace(/\d/g, '');
}

/**
 * Капитализирует первую букву слова, остальные в нижнем регистре
 */
export function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Разделяет строку на 2 слова для поля name
 * - Убирает все цифры
 * - Если есть пробел или underscore — разделяет по ним
 * - Если нет — делит примерно пополам
 * 
 * Примеры:
 * - Turysta1997 -> Tury sta
 * - Qauntblocks -> Qaunt blocks
 * - ElLic8u -> El Lic
 * - bellee2opp -> bel lee
 */
export function splitNameIntoTwoWords(input: string): string {
  // 1. Убираем все цифры
  let cleaned = removeDigits(input);
  
  // 2. Убираем лишние пробелы и точки
  cleaned = cleaned.replace(/\./g, '').trim();
  
  // Если пустая строка после очистки — возвращаем дефолт
  if (!cleaned) {
    return 'Token Name';
  }
  
  // 3. Если уже есть пробел — возвращаем первые 2 слова
  if (cleaned.includes(' ')) {
    const words = cleaned.split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) {
      return `${capitalize(words[0])} ${capitalize(words[1])}`;
    }
    // Если только одно слово после разделения, делим его
    cleaned = words[0] || cleaned;
  }
  
  // 4. Если есть underscore — разделяем по нему
  if (cleaned.includes('_')) {
    const parts = cleaned.split('_').filter(p => p.length > 0);
    if (parts.length >= 2) {
      return `${capitalize(parts[0])} ${capitalize(parts[1])}`;
    }
    cleaned = parts[0] || cleaned;
  }
  
  // 5. Пробуем найти границу между словами по CamelCase
  // Например: HelloWorld -> Hello World, SkyOnTrust -> Sky On Trust
  // Разбиваем по заглавным буквам
  const camelCaseWords = cleaned.split(/(?=[A-Z])/).filter(w => w.length > 0);
  // Проверяем, что хотя бы одно слово имеет более 1 буквы (чтобы не разбивать ABC на A B C)
  const hasRealWords = camelCaseWords.some(w => w.length > 1);
  if (camelCaseWords.length >= 2 && hasRealWords) {
    // Если нашли 2+ слова по CamelCase, возвращаем их все (максимум 4 слова)
    const wordsToUse = camelCaseWords.slice(0, 4);
    return wordsToUse.map(w => capitalize(w)).join(' ');
  }
  
  // 6. Если строка слишком короткая (<=3 символа) — дублируем
  if (cleaned.length <= 3) {
    return `${capitalize(cleaned)} ${capitalize(cleaned)}`;
  }
  
  // 7. Делим примерно пополам
  // Примеры из задания:
  // - Turysta (7 симв.) -> Tury sta (4+3) - делим после 4-го
  // - Qauntblocks (11 симв.) -> Qaunt blocks (5+6) - делим после 5-го
  // - ElLic (5 симв.) -> El Lic (2+3) - делим после 2-го
  // - belleeeopp (9 симв.) -> bel lee (3+3, обрезаем)
  // 
  // Логика: делим примерно посередине, но вторая часть максимум 6 символов
  const len = cleaned.length;
  
  // Для коротких строк (4-6 симв.) делим пополам
  // Для длинных строк делим так, чтобы вторая часть была 3-6 символов
  let splitPoint: number;
  
  if (len <= 6) {
    // Для коротких: делим пополам (округляя вниз)
    splitPoint = Math.floor(len / 2);
  } else if (len <= 10) {
    // Для средних: делим так, чтобы вторая часть была 3-4 символа
    // Turysta(7) -> 4+3, Qauntblocks(11) -> 5+6
    splitPoint = Math.ceil(len / 2);
    // Но не больше len-3 (чтобы вторая часть была минимум 3 символа)
    if (splitPoint > len - 3) {
      splitPoint = len - 3;
    }
  } else {
    // Для длинных: вторая часть 5-6 символов
    splitPoint = len - 6;
  }
  
  const firstPart = cleaned.substring(0, splitPoint);
  const secondPart = cleaned.substring(splitPoint);
  
  // Капитализируем каждое слово
  return `${capitalize(firstPart)} ${capitalize(secondPart)}`;
}

/**
 * Очищает имя для использования (устаревшая функция, оставлена для совместимости)
 */
export function cleanName(input: string): string {
  return splitNameIntoTwoWords(input);
}

/**
 * Сокращает тикер до максимум 10 символов
 * Убирает пробелы, специальные символы И ЦИФРЫ
 * @deprecated Используйте getTickerFromName() для новой логики
 */
export function truncateTicker(input: string, maxLength: number = 10): string {
  // Убираем пробелы, специальные символы И ЦИФРЫ — оставляем только буквы
  let cleaned = input.replace(/[^a-zA-Z]/g, '');
  
  // Сокращаем до maxLength символов
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength);
  }
  
  // Если пустая строка — генерируем случайный тикер
  if (!cleaned) {
    cleaned = 'TOKEN';
  }
  
  return cleaned;
}

/**
 * Получает тикер из имени токена
 * Берёт первое слово из name и делает его капсом
 * 
 * Примеры:
 * - "Bob Streamer" -> "BOB"
 * - "Crypto King" -> "CRYPTO"
 * - "Sky On Trust" -> "SKY"
 */
export function getTickerFromName(tokenName: string, maxLength: number = 10): string {
  // Разбиваем по пробелам и берём первое слово
  const words = tokenName.split(/\s+/).filter(w => w.length > 0);
  let firstWord = words[0] || 'TOKEN';
  
  // Убираем все кроме букв
  firstWord = firstWord.replace(/[^a-zA-Z]/g, '');
  
  // Сокращаем до maxLength
  if (firstWord.length > maxLength) {
    firstWord = firstWord.substring(0, maxLength);
  }
  
  // Если пусто — дефолт
  if (!firstWord) {
    firstWord = 'TOKEN';
  }
  
  // Возвращаем капсом
  return firstWord.toUpperCase();
}

// ============= PROFILE IMAGE OPERATIONS =============

export function hasRealProfileImage(imageUrl: string): boolean {
  return !imageUrl.includes('default_profile');
}

export function generateAvatarImage(name: string, filename: string): string {
  try {
    const initial = name.charAt(0).toUpperCase();
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#A8E6CF', '#FFD3B6', '#FFAAA5', '#AA96DA', '#FCBAD3', '#A8D8EA'];
    const colorIndex = name.charCodeAt(0) % colors.length;
    const bgColor = colors[colorIndex];
    
    const canvas = createCanvas(200, 200);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 200, 200);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 100px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, 100, 100);
    
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

export async function downloadProfileImage(imageUrl: string, filename: string): Promise<string> {
  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000 });
    const filepath = path.join(process.cwd(), 'profile_images', filename);
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

/**
 * Подготовка ассетов для токена (фото, метаданные)
 * Возвращает путь к локальному файлу с фото и метаданные
 * 
 * ОБНОВЛЕНО:
 * - name = Twitter name, разделённое на 2 слова без цифр
 * - symbol = Twitter username без цифр (сокращённый до 10 символов)
 */
export async function prepareTokenAssets(twitterUser: TwitterUser): Promise<TokenMetadata> {
  try {
    const imageFilename = `${twitterUser.username}_${Date.now()}.png`;
    let photoStatus = '';
    let imagePath = '';

    // Для генерации аватара используем оригинальное имя
    const originalName = twitterUser.name;

    if (!hasRealProfileImage(twitterUser.profile_image_url)) {
      imagePath = generateAvatarImage(originalName, imageFilename);
      photoStatus = '(сгенерировано)';
    } else {
      imagePath = await downloadProfileImage(twitterUser.profile_image_url, imageFilename);
      photoStatus = '(скачано)';
    }

    // ОБНОВЛЕНО: name = Twitter name разделённое на 2 слова без цифр
    const tokenName = splitNameIntoTwoWords(twitterUser.name);
    // ОБНОВЛЕНО: symbol = первое слово из name капсом (max 10 chars)
    const tokenSymbol = getTickerFromName(tokenName);

    console.log(chalk.cyan('🐜 Метаданные токена:'));
    console.log(chalk.cyan(`  📄 Название (name): ${tokenName}`));
    console.log(chalk.cyan(`  💵 Тикер (symbol): ${tokenSymbol}`));
    console.log(chalk.cyan(`  📝 Описание: ${twitterUser.description || `Token for ${tokenName}`}`));
    console.log(chalk.cyan(`  🛸 Фото: ${photoStatus}\n`));

    return {
      name: tokenName,      // Twitter name разделённое на 2 слова
      symbol: tokenSymbol,  // Twitter username без цифр (сокращённый до 10 символов)
      uri: imagePath,
      description: twitterUser.description || `Token for ${tokenName}`,
      imageFilename,
      photoStatus,
    };
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Ошибка при обработке фото: ${(error as Error).message}`));
    
    // ОБНОВЛЕНО: даже при ошибке используем правильную логику
    const tokenName = splitNameIntoTwoWords(twitterUser.name);
    const tokenSymbol = getTickerFromName(tokenName);
    
    return {
      name: tokenName,
      symbol: tokenSymbol,
      uri: '',
      description: twitterUser.description || `Token for ${tokenName}`,
      imageFilename: '',
      photoStatus: '(ошибка)',
    };
  }
}

export default {
  findNextTwitterFile,
  loadTwitterUsers,
  cleanName,
  splitNameIntoTwoWords,
  removeDigits,
  truncateTicker,
  getTickerFromName,
  capitalize,
  hasRealProfileImage,
  generateAvatarImage,
  downloadProfileImage,
  prepareTokenAssets,
};