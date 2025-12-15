/**
 * Типы данных для менеджера циклов Solana
 */

// ============= TWITTER TYPES =============

export interface TwitterUser {
  id: string;
  username: string;
  name: string;
  description: string;
  profile_image_url: string;
}

// ============= WALLET TYPES =============

export interface WalletInfo {
  publicKey: string;
  privateKey: string;
  name: string;
  createdAt: string;
}

// ============= LAUNCH RESULT TYPES =============

export interface LaunchResult {
  username: string;
  name: string;
  mint: string;
  initialBalance: number;
  finalBalance: number;
  profit: number;
  isProfit: boolean;
  timestamp: number;
}

export interface WorkerLaunchResult {
  walletName: string;
  walletAddress: string;
  solAmount: number;
  initialBalance: number;
  finalBalance: number;
  profit: number;
  isProfit: boolean;
  mint?: string;
  timestamp: number;
}

// ============= ROUND TYPES =============

export interface RoundInfo {
  roundId: string;
  cycleNumber: number;
  bankWallet: WalletInfo;
  intermediateWallet: WalletInfo;
  workerWallets: WalletInfo[];
  workerLaunches: WorkerLaunchResult[];
  startBalance: number;
  endBalance: number;
  totalProfit: number;
  isProfit: boolean;
  createdAt: string;
  completedAt?: string;
}

// ============= BOT STATE TYPES =============

export interface BotState {
  lastThreeResults: LaunchResult[];
  consecutiveLosses: number;
  isPaused: boolean;
  pauseUntil: number;
  currentFile: string | null;
  currentUserIndex: number;
}

// ============= CYCLE MANAGER STATE TYPES =============

export interface CycleManagerState {
  cycleNumber: number;
  lastRoundId: string;
  totalCycles: number;
  totalProfit: number;
  isPaused: boolean;
  pauseUntil: number;
  lastUpdateTime: string;
}

// ============= MINT DATA TYPES =============

export interface MintData {
  mint: string;
  bCurve: string;
  aBCurve: string;
  userQuoteToken: string;
  twitterUrl?: string;
  twitterUsername?: string;
}

// ============= TOKEN METADATA TYPES =============

export interface TokenMetadata {
  name: string;
  symbol: string;
  uri: string;
  description: string;
  imageFilename: string;
  photoStatus: string;
}