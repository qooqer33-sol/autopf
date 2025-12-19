/**
 * Модуль Twitter парсера для интеграции в основной проект
 * - Запускается автоматически при старте бота
 * - Парсит только когда твиттеры заканчиваются
 * - Логи скрыты (только критические ошибки)
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as fs from 'fs';
import * as path from 'path';

// ========== НАСТРОЙКИ ==========
const USERNAMES = [
  'Pumpfun',
  'solana',
  // Добавьте сколько угодно аккаунтов
];

const USER_IDS: Record<string, string> = {
  'Pumpfun': '1622243071806128131',
  'solana': '951329744804392960'
  // Добавьте ID для новых аккаунтов здесь
};

const MAX_ACCOUNT_AGE_HOURS = 5;
const MAX_FOLLOWERS_PER_ACCOUNT = 1000;
const MIN_TWITTER_THRESHOLD = 10; // Минимум твиттеров, при котором запускается парсинг

// RapidAPI
const RAPIDAPI_KEY = '9bdc8b69e0mshd06c9ef50e25398p190455jsnb9ae6ceced33';
const RAPIDAPI_HOST = 'x66.p.rapidapi.com';

// Прокси
const PROXY_URL = 'null';

const RESULTS_DIR = path.join(process.cwd(), 'results');

// Флаг для отслеживания состояния парсинга
let isParsingInProgress = false;
let lastParseTime = 0;
const MIN_PARSE_INTERVAL_MS = 30 * 60 * 1000; // Минимум 30 минут между парсингами

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

interface TwitterFollower {
  id: string;
  username: string;
  name: string;
  description: string;
  created_at: string;
  followers_count: number;
  following_count: number;
  tweets_count: number;
  verified: boolean;
  verified_type: string;
  is_blue_verified: boolean;
  location: string;
  profile_image_url: string;
}

const parseTwitterDate = (dateString: string): Date => {
  return new Date(dateString);
};

const isAccountRecent = (createdAt: string, maxHours: number): boolean => {
  const accountDate = parseTwitterDate(createdAt);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - accountDate.getTime());
  const diffHours = Math.ceil(diffTime / (1000 * 60 * 60));
  return diffHours <= maxHours;
};

/**
 * Проверка наличия реального фото профиля (не дефолтного)
 */
const hasRealProfileImage = (imageUrl: string): boolean => {
  if (!imageUrl) return false;
  // Twitter использует 'default_profile' в URL для дефолтных аватаров
  return !imageUrl.includes('default_profile');
};

const createRapidAxios = (proxyUrl: string | null) => {
  const config: any = {
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': RAPIDAPI_HOST
    },
    timeout: 30000
  };

  if (proxyUrl) {
    const agent = new HttpsProxyAgent(proxyUrl);
    config.httpsAgent = agent;
    config.proxy = false;
  }

  return axios.create(config);
};

const extractFollowersFromResponse = (data: any): TwitterFollower[] => {
  const followers: TwitterFollower[] = [];
  
  try {
    if (!data || !data.user || !data.user.result) {
      return followers;
    }

    const timeline = data.user.result.timeline?.timeline;
    if (!timeline || !timeline.instructions) {
      return followers;
    }

    for (const instruction of timeline.instructions) {
      if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
        for (const entry of instruction.entries) {
          if (entry.entryId.startsWith('cursor-')) {
            continue;
          }

          const userResult = entry.content?.itemContent?.user_results?.result;
          if (userResult && userResult.legacy) {
            const legacy = userResult.legacy;
            
            followers.push({
              id: userResult.rest_id,
              username: legacy.screen_name,
              name: legacy.name,
              description: legacy.description || '',
              created_at: legacy.created_at,
              followers_count: legacy.followers_count || 0,
              following_count: legacy.friends_count || 0,
              tweets_count: legacy.statuses_count || 0,
              verified: legacy.verified || false,
              verified_type: userResult.verified_type || '',
              is_blue_verified: userResult.is_blue_verified || false,
              location: legacy.location || '',
              profile_image_url: legacy.profile_image_url_https || ''
            });
          }
        }
      }
    }
  } catch (error) {
    // Тихо игнорируем ошибки
  }

  return followers;
};

const getNextCursor = (data: any): string | null => {
  try {
    const timeline = data.user.result.timeline?.timeline;
    if (!timeline || !timeline.instructions) {
      return null;
    }

    for (const instruction of timeline.instructions) {
      if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
        for (const entry of instruction.entries) {
          if (entry.entryId.startsWith('cursor-bottom-')) {
            return entry.content?.value;
          }
        }
      }
    }
  } catch (error) {
    // Тихо игнорируем
  }
  
  return null;
};

const getFollowers = async (userId: string, count: number = 100, cursor: string | null = null, proxyUrl: string | null = null): Promise<any> => {
  const params: any = {
    count: count.toString()
  };

  if (cursor) {
    params.cursor = cursor;
  }

  const url = `https://${RAPIDAPI_HOST}/user/${userId}/followers`;
  const axiosInstance = createRapidAxios(proxyUrl);

  try {
    const response = await axiosInstance.get(url, { params });
    return response.data;
  } catch (error) {
    return null;
  }
};

const getAllFollowersFiltered = async (
  userId: string, 
  maxHours: number, 
  maxFollowers: number = 10000, 
  proxyUrl: string | null = null
): Promise<{ all: TwitterFollower[], recent: TwitterFollower[] }> => {
  let allFollowers: TwitterFollower[] = [];
  let recentFollowers: TwitterFollower[] = [];
  let cursor: string | null = null;

  try {
    do {
      const data = await getFollowers(userId, 100, cursor, proxyUrl);

      if (!data) {
        break;
      }

      const followers = extractFollowersFromResponse(data);
      
      if (followers.length === 0) {
        break;
      }

      // Фильтруем: только недавние аккаунты С реальным фото профиля
      const filtered = followers.filter(follower => {
        const isRecent = isAccountRecent(follower.created_at, maxHours);
        const hasPhoto = hasRealProfileImage(follower.profile_image_url);
        return isRecent && hasPhoto;
      });

      allFollowers = allFollowers.concat(followers);
      recentFollowers = recentFollowers.concat(filtered);

      cursor = getNextCursor(data);

      if (allFollowers.length >= maxFollowers) {
        break;
      }

      if (cursor) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

    } while (cursor);

    return {
      all: allFollowers,
      recent: recentFollowers
    };

  } catch (error) {
    return {
      all: allFollowers,
      recent: recentFollowers
    };
  }
};

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========

/**
 * Подсчёт доступных твиттеров в папке results
 */
export function countAvailableTwitters(): number {
  try {
    if (!fs.existsSync(RESULTS_DIR)) {
      return 0;
    }

    const files = fs.readdirSync(RESULTS_DIR)
      .filter(file => file.match(/^combined_recent_followers_\d+\.json$/))
      .sort();

    if (files.length === 0) {
      return 0;
    }

    // Считаем твиттеров в последнем файле
    const latestFile = path.join(RESULTS_DIR, files[files.length - 1]);
    const data = fs.readFileSync(latestFile, 'utf-8');
    const users = JSON.parse(data);
    
    return Array.isArray(users) ? users.length : 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Запуск парсинга твиттеров (тихий режим)
 */
export async function runTwitterParser(): Promise<boolean> {
  // Проверяем, не идёт ли уже парсинг
  if (isParsingInProgress) {
    return false;
  }

  // Проверяем минимальный интервал
  const now = Date.now();
  if (now - lastParseTime < MIN_PARSE_INTERVAL_MS) {
    return false;
  }

  isParsingInProgress = true;
  lastParseTime = now;

  try {
    // Создаем папку results, если не существует
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }

    const timestamp = Date.now();
    let allRecentFollowers: TwitterFollower[] = [];

    // Обрабатываем каждый аккаунт
    for (const username of USERNAMES) {
      const userId = USER_IDS[username];
      
      if (!userId) {
        continue;
      }

      const result = await getAllFollowersFiltered(userId, MAX_ACCOUNT_AGE_HOURS, MAX_FOLLOWERS_PER_ACCOUNT, PROXY_URL);
      allRecentFollowers = allRecentFollowers.concat(result.recent);
    }

    // Сохраняем объединенный JSON файл
    if (allRecentFollowers.length > 0) {
      const combinedJsonFilename = path.join(RESULTS_DIR, `combined_recent_followers_${timestamp}.json`);
      fs.writeFileSync(combinedJsonFilename, JSON.stringify(allRecentFollowers, null, 2));
      console.log(`🔄 Парсер: найдено ${allRecentFollowers.length} новых твиттеров`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`❌ Ошибка парсера: ${(error as Error).message}`);
    return false;
  } finally {
    isParsingInProgress = false;
  }
}

/**
 * Проверка и автоматический запуск парсинга при необходимости
 * Вызывается из основного цикла бота
 */
export async function checkAndParseIfNeeded(): Promise<void> {
  const availableCount = countAvailableTwitters();
  
  if (availableCount < MIN_TWITTER_THRESHOLD) {
    console.log(`🔄 Мало твиттеров (${availableCount}), запускаем парсинг...`);
    await runTwitterParser();
  }
}

/**
 * Инициализация парсера при старте бота
 * Проверяет наличие твиттеров и запускает парсинг если нужно
 */
export async function initializeParser(): Promise<void> {
  const availableCount = countAvailableTwitters();
  
  if (availableCount === 0) {
    console.log(`🔄 Нет твиттеров, запускаем начальный парсинг...`);
    await runTwitterParser();
  } else {
    console.log(`✅ Доступно ${availableCount} твиттеров`);
  }
}

/**
 * Установка порога минимального количества твиттеров
 */
export function setMinTwitterThreshold(threshold: number): void {
  // Можно добавить логику для динамического изменения порога
}

export default {
  countAvailableTwitters,
  runTwitterParser,
  checkAndParseIfNeeded,
  initializeParser,
  setMinTwitterThreshold
};