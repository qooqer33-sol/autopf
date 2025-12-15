import { PublicKey } from '@solana/web3.js';

// Pump.fun программа
export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

// Token2022 программа (обязательна для новых токенов)
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// Старая программа токенов (для совместимости)
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJsyFbPVwwQQfg5LkcKSo5STKMp");

// RPC URLs
export const RPC_URL = process.env.RPC_URL || "http://fra.corvus-labs.io:8899";
export const WS_URL = process.env.WS_URL || "ws://fra.corvus-labs.io:8900";

// Пороги и параметры
export const TOKEN_THRESHOLD_MILLIONS = parseInt(process.env.TOKEN_THRESHOLD_MILLIONS || '100');

// Глобальные адреса Pump.fun
export const PUMP_GLOBAL = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
export const PUMP_FEE_RECIPIENT = new PublicKey("G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP");
export const PUMP_EVENT_AUTHORITY = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
export const PUMP_FEE_CONFIG = new PublicKey("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
export const PUMP_FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

// Системные программы
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");