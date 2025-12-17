/**
 * Модуль для работы с Pinata IPFS
 * 
 * ОБНОВЛЕНИЯ:
 * 1. Формат метадаты pump.fun: showName, createdOn
 * 2. Тикер всегда заглавными буквами (toUpperCase)
 * 3. Фото загружается отдельно на IPFS, ссылка в поле image
 * 4. Gateway: ipfs.io (как у pump.fun)
 */

import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

// ============= КОНФИГУРАЦИЯ =============

// Pinata API credentials (из .env)
const PINATA_API_KEY = process.env.PINATA_API_KEY || '';
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY || '';

// IPFS Gateway - используем ipfs.io как pump.fun
const PINATA_GATEWAY = 'https://ipfs.io/ipfs';

// API endpoints
const PINATA_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const PINATA_JSON_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

// ============= ТИПЫ =============

interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

interface TokenMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string;
  showName: boolean;
  createdOn: string;
  twitter?: string;
}

// ============= ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =============

/**
 * Проверка наличия API ключей Pinata
 */
function validatePinataCredentials(): void {
  if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
    throw new Error('Pinata API credentials not found. Set PINATA_API_KEY and PINATA_SECRET_KEY in .env');
  }
}

/**
 * Получение заголовков для Pinata API
 */
function getPinataHeaders(): Record<string, string> {
  return {
    'pinata_api_key': PINATA_API_KEY,
    'pinata_secret_api_key': PINATA_SECRET_KEY,
  };
}

// ============= ЗАГРУЗКА ФАЙЛОВ =============

/**
 * Загрузка файла (изображения) на IPFS через Pinata
 * 
 * @param filePath - Путь к файлу на диске
 * @returns CID (хеш) загруженного файла
 */
export async function uploadFileToPinata(filePath: string): Promise<string> {
  validatePinataCredentials();

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const formData = new FormData();
  const fileStream = fs.createReadStream(filePath);
  const fileName = path.basename(filePath);

  formData.append('file', fileStream, { filename: fileName });

  // Опциональные метаданные для Pinata
  const pinataMetadata = JSON.stringify({
    name: fileName,
  });
  formData.append('pinataMetadata', pinataMetadata);

  try {
    const response = await axios.post<PinataResponse>(PINATA_FILE_URL, formData, {
      maxBodyLength: Infinity,
      headers: {
        ...getPinataHeaders(),
        ...formData.getHeaders(),
      },
    });

    console.log(`✅ Файл загружен на IPFS: ${response.data.IpfsHash}`);
    return response.data.IpfsHash;
  } catch (error: any) {
    console.error('❌ Ошибка загрузки файла на Pinata:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Загрузка JSON на IPFS через Pinata
 * 
 * @param jsonData - Объект для загрузки
 * @param name - Имя для метаданных Pinata
 * @returns CID (хеш) загруженного JSON
 */
export async function uploadJsonToPinata(jsonData: object, name?: string): Promise<string> {
  validatePinataCredentials();

  const body = {
    pinataContent: jsonData,
    pinataMetadata: {
      name: name || 'token-metadata.json',
    },
  };

  try {
    const response = await axios.post<PinataResponse>(PINATA_JSON_URL, body, {
      headers: {
        ...getPinataHeaders(),
        'Content-Type': 'application/json',
      },
    });

    console.log(`✅ JSON загружен на IPFS: ${response.data.IpfsHash}`);
    return response.data.IpfsHash;
  } catch (error: any) {
    console.error('❌ Ошибка загрузки JSON на Pinata:', error.response?.data || error.message);
    throw error;
  }
}

// ============= СОЗДАНИЕ МЕТАДАТЫ ТОКЕНА =============

/**
 * Создание URI метадаты токена для pump.fun
 * 
 * Формат метадаты pump.fun:
 * {
 *   "name": "Token Name",
 *   "symbol": "SYMBOL",        // ← Всегда заглавными
 *   "description": "...",
 *   "image": "https://ipfs.io/ipfs/{IMAGE_CID}",
 *   "showName": true,          // ← Обязательно для pump.fun
 *   "createdOn": "https://pump.fun",  // ← Обязательно для pump.fun
 *   "twitter": "https://x.com/username"  // ← Опционально
 * }
 * 
 * @param tokenName - Название токена
 * @param tokenSymbol - Символ токена (будет преобразован в заглавные)
 * @param tokenDescription - Описание токена
 * @param imagePath - Путь к изображению на диске
 * @param twitterUrl - URL Twitter аккаунта (опционально)
 * @param pinataName - Имя для метаданных Pinata (опционально)
 * @returns Полный URL метадаты на IPFS
 */
export async function createTokenUriWithPinata(
  tokenName: string,
  tokenSymbol: string,
  tokenDescription: string,
  imagePath: string,
  twitterUrl?: string,
  pinataName?: string
): Promise<string> {
  console.log('\n📤 Создание метадаты токена для pump.fun...');
  console.log(`   Название: ${tokenName}`);
  console.log(`   Символ: ${tokenSymbol.toUpperCase()}`);
  console.log(`   Изображение: ${imagePath}`);

  // 1. Загружаем изображение на IPFS
  console.log('\n🖼️  Загрузка изображения на IPFS...');
  const imageCid = await uploadFileToPinata(imagePath);
  const imageUrl = `${PINATA_GATEWAY}/${imageCid}`;
  console.log(`   URL изображения: ${imageUrl}`);

  // 2. Создаём метадату в формате pump.fun
  const metadata: TokenMetadata = {
    name: tokenName,
    symbol: tokenSymbol.toUpperCase(),  // ← ВСЕГДА ЗАГЛАВНЫМИ
    description: tokenDescription || '',
    image: imageUrl,
    showName: true,                      // ← ОБЯЗАТЕЛЬНО для pump.fun
    createdOn: 'https://pump.fun',       // ← ОБЯЗАТЕЛЬНО для pump.fun
  };

  // Добавляем Twitter если есть
  if (twitterUrl) {
    metadata.twitter = twitterUrl;
    console.log(`   Twitter: ${twitterUrl}`);
  }

  console.log('\n📋 Метадата токена:');
  console.log(JSON.stringify(metadata, null, 2));

  // 3. Загружаем метадату на IPFS
  console.log('\n📤 Загрузка метадаты на IPFS...');
  const metadataCid = await uploadJsonToPinata(
    metadata,
    pinataName || `${tokenSymbol.toUpperCase()}-metadata`
  );

  const metadataUrl = `${PINATA_GATEWAY}/${metadataCid}`;
  console.log(`\n✅ Метадата создана: ${metadataUrl}`);

  return metadataUrl;
}

/**
 * Создание URI метадаты из URL изображения (без загрузки файла)
 * Используется когда изображение уже загружено на IPFS
 * 
 * @param tokenName - Название токена
 * @param tokenSymbol - Символ токена (будет преобразован в заглавные)
 * @param tokenDescription - Описание токена
 * @param imageUrl - URL изображения (уже на IPFS)
 * @param twitterUrl - URL Twitter аккаунта (опционально)
 * @param pinataName - Имя для метаданных Pinata (опционально)
 * @returns Полный URL метадаты на IPFS
 */
export async function createTokenUriFromImageUrl(
  tokenName: string,
  tokenSymbol: string,
  tokenDescription: string,
  imageUrl: string,
  twitterUrl?: string,
  pinataName?: string
): Promise<string> {
  console.log('\n📤 Создание метадаты токена из URL изображения...');
  console.log(`   Название: ${tokenName}`);
  console.log(`   Символ: ${tokenSymbol.toUpperCase()}`);
  console.log(`   URL изображения: ${imageUrl}`);

  // Создаём метадату в формате pump.fun
  const metadata: TokenMetadata = {
    name: tokenName,
    symbol: tokenSymbol.toUpperCase(),  // ← ВСЕГДА ЗАГЛАВНЫМИ
    description: tokenDescription || '',
    image: imageUrl,
    showName: true,                      // ← ОБЯЗАТЕЛЬНО для pump.fun
    createdOn: 'https://pump.fun',       // ← ОБЯЗАТЕЛЬНО для pump.fun
  };

  // Добавляем Twitter если есть
  if (twitterUrl) {
    metadata.twitter = twitterUrl;
    console.log(`   Twitter: ${twitterUrl}`);
  }

  console.log('\n📋 Метадата токена:');
  console.log(JSON.stringify(metadata, null, 2));

  // Загружаем метадату на IPFS
  console.log('\n📤 Загрузка метадаты на IPFS...');
  const metadataCid = await uploadJsonToPinata(
    metadata,
    pinataName || `${tokenSymbol.toUpperCase()}-metadata`
  );

  const metadataUrl = `${PINATA_GATEWAY}/${metadataCid}`;
  console.log(`\n✅ Метадата создана: ${metadataUrl}`);

  return metadataUrl;
}

/**
 * Загрузка изображения из URL и сохранение на IPFS
 * 
 * @param imageUrl - URL изображения для загрузки
 * @param tempDir - Директория для временных файлов
 * @returns CID загруженного изображения
 */
export async function uploadImageFromUrl(
  imageUrl: string,
  tempDir: string = '/tmp'
): Promise<string> {
  console.log(`\n🔗 Загрузка изображения из URL: ${imageUrl}`);

  // Скачиваем изображение
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
  });

  // Определяем расширение файла
  const contentType = response.headers['content-type'] || 'image/png';
  const extension = contentType.includes('jpeg') || contentType.includes('jpg')
    ? '.jpg'
    : contentType.includes('gif')
    ? '.gif'
    : contentType.includes('webp')
    ? '.webp'
    : '.png';

  // Сохраняем во временный файл
  const tempFilePath = path.join(tempDir, `temp_image_${Date.now()}${extension}`);
  fs.writeFileSync(tempFilePath, response.data);
  console.log(`   Сохранено во временный файл: ${tempFilePath}`);

  try {
    // Загружаем на IPFS
    const cid = await uploadFileToPinata(tempFilePath);
    return cid;
  } finally {
    // Удаляем временный файл
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

// ============= ЭКСПОРТ =============

export default {
  uploadFileToPinata,
  uploadJsonToPinata,
  createTokenUriWithPinata,
  createTokenUriFromImageUrl,
  uploadImageFromUrl,
  PINATA_GATEWAY,
};