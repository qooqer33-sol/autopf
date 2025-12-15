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
  const currentDir = process.cwd();
  const files = fs.readdirSync(RESULTS_DIR)
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
    return files[0];
  }
  
  return files[currentIndex + 1];
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

export function cleanName(input: string): string {
  let cleaned = input.replace(/\d+$/, '').trim();
  if (cleaned.includes('_')) {
    cleaned = cleaned.split('_')[0];
  }
  return cleaned || input;
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
 */
export async function prepareTokenAssets(twitterUser: TwitterUser): Promise<TokenMetadata> {
  try {
    const imageFilename = `${twitterUser.username}_${Date.now()}.png`;
    let photoStatus = '';
    let imagePath = '';

    if (!hasRealProfileImage(twitterUser.profile_image_url)) {
      imagePath = generateAvatarImage(cleanName(twitterUser.name), imageFilename);
      photoStatus = '(сгенерировано)';
    } else {
      imagePath = await downloadProfileImage(twitterUser.profile_image_url, imageFilename);
      photoStatus = '(скачано)';
    }

    const cleanedName = cleanName(twitterUser.name);
    const cleanedUsername = cleanName(twitterUser.username);

    console.log(chalk.cyan('🐜 Метаданные токена:'));
    console.log(chalk.cyan(`  📄 Название: ${cleanedName}`));
    console.log(chalk.cyan(`  💵 Тикер: ${cleanedUsername}`));
    console.log(chalk.cyan(`  📝 Описание: ${twitterUser.description || `Token for ${cleanedName}`}`));
    console.log(chalk.cyan(`  🛸 Фото: ${photoStatus}\n`));

    return {
      name: cleanedName,
      symbol: cleanedUsername,
      uri: imagePath, // ВРЕМЕННО ИСПОЛЬЗУЕМ URI ДЛЯ ПЕРЕДАЧИ ПУТИ К ФАЙЛУ
      description: twitterUser.description || `Token for ${cleanedName}`,
      imageFilename,
      photoStatus,
    };
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Ошибка при обработке фото: ${(error as Error).message}`));
    return {
      name: cleanName(twitterUser.name),
      symbol: cleanName(twitterUser.username),
      uri: '', // Оставляем пустым при ошибке
      description: twitterUser.description || `Token for ${cleanName(twitterUser.name)}`,
      imageFilename: '',
      photoStatus: '(ошибка)',
    };
  }
}

export default {
  findNextTwitterFile,
  loadTwitterUsers,
  cleanName,
  hasRealProfileImage,
  generateAvatarImage,
  downloadProfileImage,
  prepareTokenAssets,
};