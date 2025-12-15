/**
 * Модуль для работы с Pinata IPFS
 * Загружает фото и метаданные на IPFS через Pinata и возвращает прямые ссылки на gateway
 * С поддержкой Twitter URL в метаданные
 */

import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import chalk from 'chalk';

// Pinata конфигурация
const PINATA_API_KEY = process.env.PINATA_API_KEY || '51a28282bfa2e05b27c1';
const PINATA_API_SECRET = process.env.PINATA_API_SECRET || 'bca0860a35495a287334b3a20de3c5015c85410599730e1ba70a5bc58bc0a2cb';
const PINATA_JWT = process.env.PINATA_JWT || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiI4MWVjYTI1ZS03NzY1LTQ2ODctOWNhZS1mNTliNjk4NzFlNWYiLCJlbWFpbCI6ImRhZGFuYmlsMzNAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBpbl9wb2xpY3kiOnsicmVnaW9ucyI6W3siZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiRlJBMSJ9LHsiZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiTllDMSJ9XSwidmVyc2lvbiI6MX0sIm1mYV9lbmFibGVkIjpmYWxzZSwic3RhdHVzIjoiQUNUSVZFIn0sImF1dGhlbnRpY2F0aW9uVHlwZSI6InNjb3BlZEtleSIsInNjb3BlZEtleUtleSI6IjUxYTI4MjgyYmZhMmUwNWIyN2MxIiwic2NvcGVkS2V5U2VjcmV0IjoiYmNhMDg2MGEzNTQ5NWEyODczMzRiM2EyMGRlM2M1MDE1Yzg1NDEwNTk5NzMwZTFiYTcwYTViYzU4YmMwYTJjYiIsImV4cCI6MTc5NzMzNzQ5Mn0.HvUPJHMuERZhoJ-oXXJD9Q3Owyzr2-4YUVa0ztDsNdg';
const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

/**
 * Загрузка файла (фото) на Pinata
 * @param filePath - путь к файлу
 * @returns IPFS hash (CID)
 */
async function uploadFileToPinata(filePath: string): Promise<string> {
  try {
    console.log(chalk.cyan(`⚡️ Загрузка файла на Pinata: ${path.basename(filePath)}`));

    if (!fs.existsSync(filePath)) {
      throw new Error(`Файл не найден: ${filePath}`);
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));

    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'pinata_api_key': PINATA_API_KEY,
          'pinata_secret_api_key': PINATA_API_SECRET,
        },
        timeout: 30000,
      }
    );

    if (response.status !== 200 || !response.data.IpfsHash) {
      throw new Error(`Pinata API error: ${response.data.error || 'Unknown error'}`);
    }

    const ipfsHash = response.data.IpfsHash;
    console.log(chalk.green(`✅ Файл загружен! IPFS Hash: ${ipfsHash}`));

    return ipfsHash;
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка при загрузке файла на Pinata: ${(error as Error).message}`));
    throw error;
  }
}

/**
 * Загрузка JSON метаданных на Pinata
 * @param metadata - объект с метаданными
 * @returns IPFS hash (CID)
 */
async function uploadJsonToPinata(metadata: object): Promise<string> {
  try {
    console.log(chalk.cyan('⚡️ Загрузка JSON метаданных на Pinata...'));

    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      metadata,
      {
        headers: {
          'pinata_api_key': PINATA_API_KEY,
          'pinata_secret_api_key': PINATA_API_SECRET,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    if (response.status !== 200 || !response.data.IpfsHash) {
      throw new Error(`Pinata API error: ${response.data.error || 'Unknown error'}`);
    }

    const ipfsHash = response.data.IpfsHash;
    console.log(chalk.green(`✅ JSON метаданные загружены! IPFS Hash: ${ipfsHash}`));

    return ipfsHash;
  } catch (error) {
    console.error(chalk.red(`❌ Ошибка при загрузке JSON на Pinata: ${(error as Error).message}`));
    throw error;
  }
}

/**
 * Главная функция для загрузки фото и метаданных на IPFS через Pinata
 * Возвращает прямую ссылку на gateway
 * @param tokenName - имя токена
 * @param tokenSymbol - тикер токена
 * @param tokenDescription - описание токена
 * @param imagePath - путь к файлу с фото
 * @param twitterUrl - URL Twitter профиля (опционально)
 * @param twitterUsername - имя пользователя Twitter (опционально)
 * @returns Прямая ссылка на gateway (e.g., https://gateway.pinata.cloud/ipfs/QmHash...)
 */
export async function createTokenUriWithPinata(
  tokenName: string,
  tokenSymbol: string,
  tokenDescription: string,
  imagePath: string,
  twitterUrl?: string,
  twitterUsername?: string
): Promise<string> {
  try {
    console.log(chalk.cyan.bold('\n📦 Создание URI метаданных через Pinata...'));

    // 1. Загружаем фото на IPFS
    const imageIpfsHash = await uploadFileToPinata(imagePath);
    // Используем прямую ссылку на gateway для фото
    const imageUrl = `${PINATA_GATEWAY}/${imageIpfsHash}`;

    // 2. Создаем JSON метаданные
    const metadata: any = {
      name: tokenName,
      symbol: tokenSymbol,
      description: tokenDescription,
      image: imageUrl, // Прямая ссылка на фото
      attributes: [],
      properties: {
        files: [
          {
            uri: imageUrl,
            type: 'image/png',
          },
        ],
        category: 'image',
      },
    };

    // 3. Добавляем Twitter информацию если есть
    if (twitterUrl) {
      metadata.twitter = twitterUrl;
      metadata.social = {
        twitter: twitterUrl,
      };
    }

    if (twitterUsername) {
      metadata.twitterUsername = twitterUsername;
    }

    // 4. Загружаем JSON на IPFS
    const metadataIpfsHash = await uploadJsonToPinata(metadata);
    // Возвращаем прямую ссылку на gateway для метаданных
    const metadataUri = `${PINATA_GATEWAY}/${metadataIpfsHash}`;

    console.log(chalk.green.bold(`✅ URI метаданных успешно создан: ${metadataUri}\n`));

    return metadataUri;
  } catch (error) {
    console.error(chalk.red(`❌ Не удалось создать URI метаданных: ${(error as Error).message}`));
    // Возвращаем пустую строку или стандартный URI в случае ошибки
    return 'https://pump.fun';
  }
}

export default { createTokenUriWithPinata };