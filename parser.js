/**
 * Twitter парсер для МНОЖЕСТВЕННЫХ аккаунтов с объединением в один Excel
 * - User ID через константы (hardcoded)
 * - Подписчики через RapidAPI
 * - Фильтрация: только аккаунты созданные максимум 5 часов назад
 * - Проверка нескольких аккаунтов
 * - Объединение всех результатов в один Excel файл
 * 
 * npm install axios https-proxy-agent xlsx
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';
import XLSX from 'xlsx';

// ========== НАСТРОЙКИ ==========
// ДОБАВЬТЕ СЮДА ВСЕ АККАУНТЫ, КОТОРЫЕ НУЖНО ПРОВЕРИТЬ
const USERNAMES = [
  'Pumpfun',
  'solana',
  // Добавьте сколько угодно аккаунтов
];

// Hardcoded User IDs для аккаунтов
const USER_IDS = {
  'Pumpfun': '1622243071806128131',
  'solana': '951329744804392960'
  // Добавьте ID для новых аккаунтов здесь
};

const MAX_ACCOUNT_AGE_HOURS = 5; // Максимальный возраст аккаунта в часах
const MAX_FOLLOWERS_PER_ACCOUNT = 1000; // Максимум подписчиков на аккаунт

// RapidAPI (для получения подписчиков)
const RAPIDAPI_KEY = '9bdc8b69e0mshd06c9ef50e25398p190455jsnb9ae6ceced33';
const RAPIDAPI_HOST = 'x66.p.rapidapi.com';

// Прокси
const PROXY_URL = 'http://user229219:q0fai8@23.26.142.37:1171';
// const PROXY_URL = null; // Отключить прокси
// ===============================

const RESULTS_DIR = 'results';

// Парсинг даты Twitter формата
const parseTwitterDate = (dateString) => {
  return new Date(dateString);
};

// Проверка возраста аккаунта
const isAccountRecent = (createdAt, maxHours) => {
  const accountDate = parseTwitterDate(createdAt);
  const now = new Date();
  const diffTime = Math.abs(now - accountDate);
  const diffHours = Math.ceil(diffTime / (1000 * 60 * 60));
  return diffHours <= maxHours;
};

// Создаем axios instance для RapidAPI
const createRapidAxios = (proxyUrl) => {
  const config = {
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

// Извлечение подписчиков из ответа RapidAPI
const extractFollowersFromResponse = (data) => {
  const followers = [];
  
  try {
    if (!data || !data.user || !data.user.result) {
      console.log('⚠️  Неожиданная структура ответа (нет data.user.result)');
      return followers;
    }

    const timeline = data.user.result.timeline?.timeline;
    if (!timeline || !timeline.instructions) {
      console.log('⚠️  Timeline не найден');
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
    console.error('❌ Ошибка при извлечении данных:', error.message);
  }

  return followers;
};

// Получение курсора для следующей страницы
const getNextCursor = (data) => {
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
    // Тихо игнорируем ошибку
  }
  
  return null;
};

// Получение подписчиков через RapidAPI
const getFollowers = async (userId, count = 100, cursor = null, proxyUrl = null) => {
  const params = {
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
    console.error('❌ Ошибка при запросе подписчиков:', error.message);
    if (error.response) {
      console.error('   Статус:', error.response.status);
      console.error('   Данные:', JSON.stringify(error.response.data).substring(0, 200));
    }
    return null;
  }
};

// Получение всех подписчиков с фильтрацией по дате
const getAllFollowersFiltered = async (userId, maxHours, maxFollowers = 10000, proxyUrl = null) => {
  let allFollowers = [];
  let recentFollowers = [];
  let cursor = null;
  let pageCount = 0;

  try {
    do {
      pageCount++;
      console.log(`   📄 Загрузка страницы ${pageCount}...`);

      const data = await getFollowers(userId, 100, cursor, proxyUrl);

      if (!data) {
        console.error('   ❌ Не удалось получить данные');
        break;
      }

      const followers = extractFollowersFromResponse(data);
      
      if (followers.length === 0) {
        console.log('   ⚠️  Подписчики не найдены на этой странице');
      } else {
        console.log(`   ✅ Получено подписчиков: ${followers.length}`);
        
        const filtered = followers.filter(follower => {
          return isAccountRecent(follower.created_at, maxHours);
        });

        allFollowers = allFollowers.concat(followers);
        recentFollowers = recentFollowers.concat(filtered);
        
        console.log(`   📊 Всего получено: ${allFollowers.length}`);
        console.log(`   ✨ Подходящих (≤${maxHours} часов): ${recentFollowers.length}`);
      }

      cursor = getNextCursor(data);

      if (allFollowers.length >= maxFollowers) {
        console.log(`   🎯 Достигнут лимит: ${maxFollowers} подписчиков`);
        break;
      }

      if (cursor) {
        console.log('   ⏳ Задержка 2 сек...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log('   ℹ️  Больше нет страниц');
      }

    } while (cursor);

    console.log(`   ✅ Итого для этого аккаунта: ${allFollowers.length} всего, ${recentFollowers.length} недавних`);
    
    return {
      all: allFollowers,
      recent: recentFollowers
    };

  } catch (error) {
    console.error('   ❌ Ошибка при запросе:', error.message);
    return {
      all: allFollowers,
      recent: recentFollowers
    };
  }
};

/**
 * Сохранение данных в Excel формат
 */
const saveToExcel = (followers, filename) => {
  try {
    console.log(`\n📊 Создание Excel файла...`);

    const excelData = followers.map(follower => ({
      'ID': follower.id,
      'NAME': follower.name,
      'USERNAME': follower.username,
      'DESCRIPTION': follower.description || '',
      'VERIFIED': follower.verified ? 'ИСТИНА' : 'ЛОЖЬ',
      'CREATED_AT': follower.created_at,
      'X': `https://x.com/${follower.username}`
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    const columnWidths = [
      { wch: 20 }, // ID
      { wch: 25 }, // NAME
      { wch: 20 }, // USERNAME
      { wch: 50 }, // DESCRIPTION
      { wch: 10 }, // VERIFIED
      { wch: 30 }, // CREATED_AT
      { wch: 40 }  // X
    ];
    worksheet['!cols'] = columnWidths;

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, filename);
    console.log(`💾 Excel файл сохранён: ${filename}`);
    
    return true;
  } catch (error) {
    console.error('❌ Ошибка при создании Excel:', error.message);
    return false;
  }
};

// Главная функция для обработки множественных аккаунтов
const main = async () => {
  // 1. Создаем папку results, если она не существует
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR);
    console.log(`📁 Создана папка для результатов: ${RESULTS_DIR}`);
  }

  console.log('='.repeat(70));
  console.log('🔍 ПАРСИНГ ПОДПИСЧИКОВ ДЛЯ МНОЖЕСТВЕННЫХ АККАУНТОВ');
  console.log('='.repeat(70));
  console.log(`📋 Аккаунтов для проверки: ${USERNAMES.length}`);
  console.log(`📅 Фильтр: аккаунты созданные ≤${MAX_ACCOUNT_AGE_HOURS} часов назад`);
  console.log('='.repeat(70));

  const timestamp = Date.now();
  let allFollowersFromAllAccounts = [];
  let allRecentFollowersFromAllAccounts = [];

  // Обрабатываем каждый аккаунт
  for (let i = 0; i < USERNAMES.length; i++) {
    const username = USERNAMES[i];
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🔄 [${i + 1}/${USERNAMES.length}] Обработка аккаунта: @${username}`);
    console.log('='.repeat(70));

    // Получаем User ID из констант
    const userId = USER_IDS[username];
    
    if (!userId) {
      console.error(`❌ Не найдено User ID для @${username}. Пропускаем...`);
      continue;
    }

    console.log(`✓ User ID: ${userId}`);

    // Получаем подписчиков
    console.log(`\n🚀 Получение подписчиков для @${username}...`);
    const result = await getAllFollowersFiltered(userId, MAX_ACCOUNT_AGE_HOURS, MAX_FOLLOWERS_PER_ACCOUNT, PROXY_URL);

    // Сохраняем отдельные JSON файлы для каждого аккаунта в папку results
    const allFilename = `${RESULTS_DIR}/followers_all_${username}_${timestamp}.json`;
    fs.writeFileSync(allFilename, JSON.stringify(result.all, null, 2));
    console.log(`\n💾 Все подписчики @${username} сохранены (JSON): ${allFilename}`);

    const recentFilename = `${RESULTS_DIR}/followers_recent_${username}_${timestamp}.json`;
    fs.writeFileSync(recentFilename, JSON.stringify(result.recent, null, 2));
    console.log(`💾 Недавние подписчики @${username} сохранены (JSON): ${recentFilename}`);

    // Добавляем в общий массив
    allFollowersFromAllAccounts = allFollowersFromAllAccounts.concat(result.all);
    allRecentFollowersFromAllAccounts = allRecentFollowersFromAllAccounts.concat(result.recent);

    console.log(`\n✅ Аккаунт @${username} обработан:`);
    console.log(`   📊 Всего подписчиков: ${result.all.length}`);
    console.log(`   ✨ Недавних подписчиков: ${result.recent.length}`);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('⭐ ОБЩИЕ РЕЗУЛЬТАТЫ');
  console.log('='.repeat(70));
  console.log(`📊 Всего подписчиков (все аккаунты): ${allFollowersFromAllAccounts.length}`);
  console.log(`✨ Всего недавних подписчиков (все аккаунты): ${allRecentFollowersFromAllAccounts.length}`);

  // Сохраняем объединенный JSON файл в папку results
  const combinedJsonFilename = `${RESULTS_DIR}/combined_recent_followers_${timestamp}.json`;
  fs.writeFileSync(combinedJsonFilename, JSON.stringify(allRecentFollowersFromAllAccounts, null, 2));
  console.log(`\n💾 Объединенный JSON файл сохранен: ${combinedJsonFilename}`);

  // Сохраняем объединенный Excel файл в папку results
  const combinedExcelFilename = `${RESULTS_DIR}/combined_recent_followers_${timestamp}.xlsx`;
  saveToExcel(allRecentFollowersFromAllAccounts, combinedExcelFilename);

  console.log(`\n🎉 Завершено.`);
};

// Функция для запуска скрипта каждый час
const runHourly = async () => {
  const ONE_HOUR_MS = 3600000; // 1 час в миллисекундах

  while (true) {
    const now = new Date();
    console.log(`\n\n======================================================================`);
    console.log(`[${now.toISOString()}] 🚀 Запуск парсинга...`);
    console.log(`======================================================================`);
    
    try {
      await main();
    } catch (error) {
      console.error(`\n🚨 КРИТИЧЕСКАЯ ОШИБКА В ОСНОВНОМ ЦИКЛЕ: ${error.message}`);
      console.error(error);
    }

    console.log(`\n😴 Ожидание 1 час...`);
    await new Promise(resolve => setTimeout(resolve, ONE_HOUR_MS));
  }
};

// Запуск бесконечного цикла
runHourly();