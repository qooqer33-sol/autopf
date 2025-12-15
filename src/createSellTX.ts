import {
    PublicKey,
    Keypair,
    TransactionInstruction,
    SystemProgram,
    ComputeBudgetProgram
} from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import calculateSellAmount from './pumpCalcSell';
import { RPC_URL, WS_URL, TOKEN_2022_PROGRAM_ID, SYSTEM_PROGRAM_ID, PUMP_GLOBAL, PUMP_FEE_RECIPIENT, PUMP_EVENT_AUTHORITY, PUMP_FEE_CONFIG, PUMP_FEE_PROGRAM } from "./constants";

const PRIORITY_FEE_MICROLAMPORTS = 5_000_000; // 0.005 SOL

// 0slot staked_conn designated accounts (minimum 0.001 SOL transfer required)
const SLOT_STAKED_ACCOUNTS = [
    "Eb2KpSC8uMt9GmzyAEm5Eb1AAAgTjRaXWFjKyFXHZxF3",
    "FCjUJZ1qozm1e8romw216qyfQMaaWKxWsuySnumVCCNe",
    "ENxTEjSQ1YabmUpXAdCgevnHQ9MHdLv8tzFiuiYJqa13",
    "6rYLG55Q9RpsPGvqdPNJs4z5WTxJVatMB8zV3WJhs5EK",
    "Cix2bHfqPcKcM233mzxbLk14kSggUUiz2A87fJtGivXr"
];

interface Wallet {
    pubKey: string;
    privKey: string;
}

async function createSellTX(
    mint: PublicKey,
    bondingCurve: PublicKey,
    aBondingCurve: PublicKey,
    pump: PublicKey,
    wallet: Wallet,
    sellAmountLamports: number,
    tokenAccountPubKey: string,
    creatorVault: PublicKey,
    coinCreatorVaultAuthority: PublicKey,
    coinCreateVaultAta: PublicKey
): Promise<{ instructions: TransactionInstruction[], payer: Keypair }> {
    dotenv.config();
    const pubkey = wallet.pubKey;
    const secret = wallet.privKey;
    const owner = new PublicKey(pubkey);

    const payer = Keypair.fromSecretKey(bs58.decode(secret));

    // Используем константы из constants.ts
    const global = PUMP_GLOBAL;
    const feeRecipient = PUMP_FEE_RECIPIENT;
    const eventAuthority = PUMP_EVENT_AUTHORITY;
    const FeeConfig = PUMP_FEE_CONFIG;
    const FeeProgram = PUMP_FEE_PROGRAM;

    const keys = [
        { pubkey: global, isSigner: false, isWritable: false }, // global
        { pubkey: feeRecipient, isSigner: false, isWritable: true }, // feeRecipient
        { pubkey: mint, isSigner: false, isWritable: false }, // mint
        { pubkey: bondingCurve, isSigner: false, isWritable: true }, // bondingCurve
        { pubkey: aBondingCurve, isSigner: false, isWritable: true }, // associatedBondingCurve
        { pubkey: new PublicKey(tokenAccountPubKey), isSigner: false, isWritable: true }, // associatedUser
        { pubkey: owner, isSigner: true, isWritable: true }, // user
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }, // systemProgram
        { pubkey: creatorVault, isSigner: false, isWritable: true }, // creatorVault
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // tokenProgram
        { pubkey: eventAuthority, isSigner: false, isWritable: false }, // eventAuthority
        { pubkey: pump, isSigner: false, isWritable: false }, // program (Pump.fun)
        { pubkey: FeeConfig, isSigner: false, isWritable: false }, // additional key 13
        { pubkey: FeeProgram, isSigner: false, isWritable: false }, 
    ];

    const amountData = await calculateSellAmount(sellAmountLamports, bondingCurve.toBase58());
    if (!amountData) {
        throw new Error("Failed to calculate sell amount");
    }

    let slippage = 1 - 0.8;

    let minSolOutput = (amountData * 1e9);
    minSolOutput = minSolOutput * slippage;
    minSolOutput = parseInt(minSolOutput.toFixed(0));

    const sell = BigInt("12502976635542562355");
    const amount = BigInt(sellAmountLamports);
    const min_sol_output = BigInt(minSolOutput);

    const integers = [sell, amount, min_sol_output];

    const binary_segments = integers.map(integer => {
        const buffer = Buffer.alloc(8);
        buffer.writeBigUInt64LE(integer);
        return buffer;
    });

    const transactionBuffer = Buffer.concat(binary_segments);

    const swapOut = new TransactionInstruction({
        programId: pump,
        keys: keys,
        data: transactionBuffer
    });

    const priorityFeeIX = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_FEE_MICROLAMPORTS,
    });

    // Add instruction for 0slot staked_conn (minimum 0.001 SOL = 1_000_000 lamports)
    // This instruction should be inserted at the beginning for best performance
    const randomStakedAccount = SLOT_STAKED_ACCOUNTS[Math.floor(Math.random() * SLOT_STAKED_ACCOUNTS.length)];
    const SLOT_MIN_STAKE_LAMPORTS = 1_000_000; // 0.001 SOL
    const stakeIX = SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: new PublicKey(randomStakedAccount),
        lamports: SLOT_MIN_STAKE_LAMPORTS,
    });

    // Return array of instructions: stake transfer (first), priority fee, swap
    // Note: 0slot recommends inserting the stake transfer at the beginning
    return { instructions: [stakeIX, priorityFeeIX, swapOut], payer };
}

async function createSellTXWithTip(
    mint: PublicKey,
    bondingCurve: PublicKey,
    aBondingCurve: PublicKey,
    pump: PublicKey,
    wallet: Wallet,
    sellAmountLamports: number,
    tokenAccountPubKey: string,
    isLowTip: boolean = false,
    creatorVault: PublicKey,
    coinCreatorVaultAuthority: PublicKey,
    coinCreateVaultAta: PublicKey
): Promise<{ instructions: TransactionInstruction[], payer: Keypair }> {
    dotenv.config();

    const pubkey = wallet.pubKey;
    const secret = wallet.privKey;
    const owner = new PublicKey(pubkey);

    const payer = Keypair.fromSecretKey(bs58.decode(secret));

    // Используем константы из constants.ts
    const global = PUMP_GLOBAL;
    const feeRecipient = PUMP_FEE_RECIPIENT;
    const eventAuthority = PUMP_EVENT_AUTHORITY;
    const FeeConfig = PUMP_FEE_CONFIG;
    const FeeProgram = PUMP_FEE_PROGRAM;

    const keys = [
        { pubkey: global, isSigner: false, isWritable: false }, // global
        { pubkey: feeRecipient, isSigner: false, isWritable: true }, // feeRecipient
        { pubkey: mint, isSigner: false, isWritable: false }, // mint
        { pubkey: bondingCurve, isSigner: false, isWritable: true }, // bondingCurve
        { pubkey: aBondingCurve, isSigner: false, isWritable: true }, // associatedBondingCurve
        { pubkey: new PublicKey(tokenAccountPubKey), isSigner: false, isWritable: true }, // associatedUser
        { pubkey: owner, isSigner: true, isWritable: true }, // user
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }, // systemProgram
        { pubkey: creatorVault, isSigner: false, isWritable: true }, // creatorVault
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // tokenProgram
        { pubkey: eventAuthority, isSigner: false, isWritable: false }, // eventAuthority
        { pubkey: pump, isSigner: false, isWritable: false }, // program (Pump.fun)
        { pubkey: FeeConfig, isSigner: false, isWritable: false }, // additional key 13
        { pubkey: FeeProgram, isSigner: false, isWritable: false }, 
    ];

    const amountData = await calculateSellAmount(sellAmountLamports, bondingCurve.toBase58());
    if (!amountData) {
        throw new Error("Failed to calculate sell amount");
    }

    let slippage = 1 - 0.8;

    let minSolOutput = (amountData * 1e9);
    minSolOutput = minSolOutput * slippage;
    minSolOutput = parseInt(minSolOutput.toFixed(0));

    const sell = BigInt("12502976635542562355");
    const amount = BigInt(sellAmountLamports);
    const min_sol_output = BigInt(minSolOutput);

    const integers = [sell, amount, min_sol_output];

    const binary_segments = integers.map(integer => {
        const buffer = Buffer.alloc(8);
        buffer.writeBigUInt64LE(integer);
        return buffer;
    });

    const transactionBuffer = Buffer.concat(binary_segments);

    const swapOut = new TransactionInstruction({
        programId: pump,
        keys: keys,
        data: transactionBuffer
    });

    const priorityFeeIX = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_FEE_MICROLAMPORTS,
    });

    // Add instruction for 0slot staked_conn with variable amount based on isLowTip
    const randomStakedAccount = SLOT_STAKED_ACCOUNTS[Math.floor(Math.random() * SLOT_STAKED_ACCOUNTS.length)];
    const SLOT_STAKE_LAMPORTS = isLowTip ? 3_000_000 : 3_000_000; // 0.001 SOL for low, 0.002 SOL for normal
    const stakeIX = SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: new PublicKey(randomStakedAccount),
        lamports: SLOT_STAKE_LAMPORTS,
    });

    // Return array of instructions: stake transfer (first), priority fee, swap
    return { instructions: [stakeIX, priorityFeeIX, swapOut], payer };
}

export { createSellTX, createSellTXWithTip };