import { PublicKey, Keypair, Connection, VersionedTransaction, TransactionMessage, TransactionInstruction, AddressLookupTableAccount } from '@solana/web3.js';
import { createSellTX } from './createSellTX';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { getWithRetry } from "./helper";
import { RPC_URL, WS_URL, PUMP_PROGRAM_ID } from "./constants";
import axios from 'axios';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

interface Wallet {
    pubKey: string;
    privKey: string;
}

function creatorVaultPda(creator: PublicKey, programId: PublicKey): PublicKey {
    const [creatorVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator-vault"), creator.toBuffer()],
        programId,
    );
    return creatorVault;
}

function coinCreatorVaultAuthorityPda(coinCreator: PublicKey, programId: PublicKey): PublicKey {
    const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator_vault"), coinCreator.toBuffer()],
        programId,
    );
    return coinCreatorVaultAuthority;
}

function coinCreatorVaultAta(
    coinCreatorVaultAuthority: PublicKey,
    mint: PublicKey,
    tokenProgram: PublicKey,
): PublicKey {
    return getAssociatedTokenAddressSync(
        mint,
        coinCreatorVaultAuthority,
        true,
        tokenProgram,
    );
}

async function sendTransactionTo0slot(transaction: VersionedTransaction): Promise<string> {
    const SLOT_API_KEY = process.env.SLOT_API_KEY || '7f3ebc6d31f44330bc78650ce3d86e99';
    const SLOT_SENDER_URL = 'http://de1.0slot.trade/';

    const serializedTx = transaction.serialize();
    const base64Tx = Buffer.from(serializedTx).toString('base64');

    const requestBody = {
        jsonrpc: "2.0",
        id: Date.now().toString(),
        method: "sendTransaction",
        params: [
            base64Tx,
            {
                encoding: "base64",
                skipPreflight: true,
                maxRetries: 0
            }
        ]
    };

    try {
        console.log(chalk.cyan(`📤 Отправка транзакции на 0slot...`));
        const response = await axios.post(SLOT_SENDER_URL, requestBody, {
            headers: {
                'Content-Type': 'application/json'
            },
            params: {
                'api-key': SLOT_API_KEY
            },
            timeout: 10000
        });

        if (response.status === 200) {
            const { result } = response.data;
            console.log(chalk.green(`✅ Транзакция отправлена на 0slot, сигнатура: ${result}`));
            return result;
        } else {
            throw new Error(`Unexpected response status: ${response.status}`);
        }
    } catch (error) {
        const errorMessage = (error as any).response?.data?.error?.message || (error as Error).message;
        
        console.error(chalk.red(`❌ Ошибка отправки на 0slot: ${errorMessage}`));
        
        if ((error as any).response?.data?.error?.code === 403) {
            throw new Error(`0slot API error: ${errorMessage} (Check API key or method)`);
        } else if ((error as any).response?.data?.error?.code === 419) {
            throw new Error(`0slot rate limit exceeded: ${errorMessage}`);
        }
        
        throw new Error(`Failed to send transaction to 0slot: ${errorMessage}`);
    }
}

/**
 * Функция для подтверждения транзакции с вебсокет подпиской
 * Это более надежный метод, чем RPC confirmTransaction
 */
async function confirmTransactionWithWebsocket(
    connection: Connection,
    signature: string,
    timeoutMs: number = 120000
): Promise<boolean> {
    return new Promise((resolve) => {
        let confirmed = false;
        let subscriptionId: number | null = null;

        // Timeout
        const timeoutId = setTimeout(() => {
            if (!confirmed && subscriptionId !== null) {
                console.warn(chalk.yellow(`⏱️  Timeout при подтверждении транзакции ${signature}`));
                connection.removeSignatureListener(subscriptionId);
                resolve(false);
            }
        }, timeoutMs);

        // Подписываемся на изменения сигнатуры через вебсокет
        subscriptionId = connection.onSignature(
            signature,
            (result) => {
                confirmed = true;
                clearTimeout(timeoutId);

                if (result.err) {
                    console.error(chalk.red(`❌ Транзакция ${signature} не прошла: ${JSON.stringify(result.err)}`));
                    resolve(false);
                } else {
                    console.log(chalk.green(`✅ Транзакция ${signature} подтверждена!`));
                    resolve(true);
                }
            },
            'confirmed' // Слушаем 'confirmed' статус
        );

        console.log(chalk.cyan(`⏳ Ожидание подтверждения ${signature.slice(0, 8)}...`));
    });
}

/**
 * Продажа всех токенов с рабочего кошелька
 * Рабочий кошелек сам платит за свою продажу
 * @param withDev - использовать ли dev режим
 * @param low_tip - использовать ли низкую комиссию
 * @param mintData - данные о токене
 * @param workerAddress - адрес рабочего кошелька
 * @param workerPrivateKey - приватный ключ рабочего кошелька (base58)
 */
async function dumpAll(
    withDev: boolean = false,
    low_tip: boolean = false,
    mintData: any,
    workerAddress?: string,
    workerPrivateKey?: string
): Promise<void> {
    console.log(chalk.cyan.bold('\n═══════════════════════════════════════'));
    console.log(chalk.cyan.bold('🔄 НАЧАЛО ПРОЦЕССА ПРОДАЖИ'));
    console.log(chalk.cyan.bold('═══════════════════════════════════════\n'));

    if (!mintData || typeof mintData !== 'object') {
        console.error(chalk.red('❌ Ошибка: mintData не определен или невалиден'));
        console.error(chalk.red(`   Данные: ${JSON.stringify(mintData)}`));
        return;
    }

    const ca = mintData.mint;
    const bCurve = mintData.bCurve;
    const aBCurve = mintData.aBCurve;
    const userQuoteToken = mintData.userQuoteToken;

    if (!ca || !bCurve || !aBCurve || !userQuoteToken) {
        console.error(chalk.red('❌ Ошибка: Неполные данные mintData'));
        console.error(chalk.red(`   mint: ${ca}`));
        console.error(chalk.red(`   bCurve: ${bCurve}`));
        console.error(chalk.red(`   aBCurve: ${aBCurve}`));
        console.error(chalk.red(`   userQuoteToken: ${userQuoteToken}`));
        return;
    }

    // Определяем адрес и приватный ключ для использования
    const effectiveWorkerAddress = workerAddress || (process.env.DEV_ADDRESS as string);
    const effectiveWorkerPrivateKey = workerPrivateKey || (process.env.SIGNER_PRIVATE_KEY as string);

    if (!effectiveWorkerAddress || !effectiveWorkerPrivateKey) {
        console.error(chalk.red('❌ Ошибка: Не указан адрес или приватный ключ рабочего кошелька'));
        return;
    }

    const rpcURL = RPC_URL;
    const ws = WS_URL;
    const fast_sell = "TRUE" === process.env.FAST_SELL as string;

    console.log(chalk.cyan(`📋 Параметры:`));
    console.log(chalk.cyan(`   Mint: ${ca}`));
    console.log(chalk.cyan(`   Bonding Curve: ${bCurve}`));
    console.log(chalk.cyan(`   Рабочий кошелек: ${effectiveWorkerAddress}`));
    console.log(chalk.cyan(`   Fast Sell: ${fast_sell}\n`));

    // Логируем Twitter информацию если есть
    if (mintData.twitterUrl) {
        console.log(chalk.cyan(`📱 Twitter: ${mintData.twitterUrl}`));
        console.log(chalk.cyan(`👤 Username: @${mintData.twitterUsername}\n`));
    }


    // Загружаем рабочий кошелек как подписанта
    let workerKeypair: Keypair;
    try {
        workerKeypair = Keypair.fromSecretKey(bs58.decode(effectiveWorkerPrivateKey));
        console.log(chalk.green(`✅ Рабочий кошелек загружен как подписант: ${workerKeypair.publicKey.toBase58()}`));
    } catch (error) {
        console.error(chalk.red(`❌ Ошибка при загрузке рабочего кошелька: ${(error as Error).message}`));
        return;
    }

    const connection = new Connection(rpcURL, {
        commitment: 'confirmed',
        wsEndpoint: ws
    });

    // Используем рабочий кошелек для поиска токенов
    const wallet: Wallet = {
        pubKey: effectiveWorkerAddress,
        privKey: effectiveWorkerPrivateKey
    };

    console.log(chalk.cyan(`👛 Рабочий кошелек (плательщик): ${wallet.pubKey}\n`));

    const lookupTablePubkey = new PublicKey(process.env.LUT_ADDRESS as string);
    let lookupTable;
    try {
        lookupTable = await getWithRetry(async () => {
            console.log(chalk.cyan(`📍 Загрузка таблицы адресов...`));
            const table = await connection.getAddressLookupTable(lookupTablePubkey);
            if (!table.value) throw new Error(`Lookup table ${lookupTablePubkey.toBase58()} not found`);
            console.log(chalk.green(`✅ Таблица адресов загружена`));
            return table.value;
        }, true);
    } catch (error) {
        console.error(chalk.red(`❌ Ошибка загрузки таблицы адресов: ${(error as Error).message}`));
        return;
    }

    const transactions: VersionedTransaction[] = [];
    const signatures: string[] = [];

    let tokenAccountPubKey: string;

    try {
        console.log(chalk.cyan(`🔍 Поиск аккаунта токена в рабочем кошельке...`));
        const tokenAccounts = await getWithRetry(async () => {
            return await connection.getTokenAccountsByOwner(new PublicKey(wallet.pubKey), { mint: new PublicKey(ca) });
        }, true);

        if (tokenAccounts.value.length === 0) {
            console.error(chalk.red(`❌ Аккаунт токена не найден для кошелька ${wallet.pubKey}`));
            return;
        }

        tokenAccountPubKey = tokenAccounts.value[0].pubkey.toBase58();
        console.log(chalk.green(`✅ Аккаунт токена найден: ${tokenAccountPubKey}`));

        const tokenAccountBalance = await getWithRetry(async () => {
            console.log(chalk.cyan(`💰 Получение баланса токена...`));
            return await connection.getTokenAccountBalance(new PublicKey(tokenAccountPubKey));
        });

        if (!tokenAccountBalance.value) {
            console.error(chalk.red(`❌ Баланс не найден для аккаунта ${tokenAccountPubKey}`));
            return;
        }

        const sellAmount = tokenAccountBalance.value.uiAmount;
        const sellAmountLamports = Math.floor(sellAmount! * 1e6);

        console.log(chalk.cyan(`💵 Баланс токена: ${sellAmount} токенов (${sellAmountLamports} lamports)\n`));

        if (sellAmount && sellAmount <= 100) {
            console.warn(chalk.yellow(`⚠️  Баланс токена слишком низкий (${sellAmount}), пропускаем.\n`));
            return;
        }

        console.log(chalk.green.bold(`📊 Сумма продажи: ${sellAmount} токенов = ${sellAmountLamports} lamports`));

        let instructions: TransactionInstruction[];
        let payer: Keypair;

        console.log(chalk.cyan(`\n🔧 Создание инструкций транзакции...`));
        const creator = new PublicKey(wallet.pubKey);
        const creatorVault = creatorVaultPda(creator, PUMP_PROGRAM_ID);
        const coinCreatorVaultAuthority = coinCreatorVaultAuthorityPda(creator, PUMP_PROGRAM_ID);
        const coinCreateVaultAta = coinCreatorVaultAta(coinCreatorVaultAuthority, new PublicKey(ca), TOKEN_2022_PROGRAM_ID);

        try {
            ({ instructions, payer } = await createSellTX(
                new PublicKey(ca),
                new PublicKey(bCurve),
                new PublicKey(aBCurve),
                PUMP_PROGRAM_ID,
                wallet,
                sellAmountLamports,
                tokenAccountPubKey,
                creatorVault,
                coinCreatorVaultAuthority,
                coinCreateVaultAta,
            ));
            console.log(chalk.green(`✅ Инструкции созданы (${instructions.length} инструкций)`));
            console.log(chalk.cyan(`   Payer: ${payer.publicKey.toBase58()}`));
        } catch (error) {
            console.error(chalk.red(`❌ Ошибка при создании инструкций: ${(error as Error).message}`));
            if (error instanceof Error && error.stack) {
                console.error(chalk.red(`   Stack: ${error.stack}`));
            }
            throw error;
        }

        const recentBlockhash = await getWithRetry(async () => {
            console.log(chalk.cyan(`⛓️  Получение последнего блокхеша...`));
            return await connection.getLatestBlockhash();
        }, true);

        console.log(chalk.green(`✅ Блокхеш получен: ${recentBlockhash.blockhash}`));

        const messageV0 = new TransactionMessage({
            payerKey: payer.publicKey,
            instructions: instructions,
            recentBlockhash: recentBlockhash.blockhash,
        }).compileToV0Message([lookupTable]);

        const serMessage = messageV0.serialize();
        if (serMessage.length > 1232) {
            console.error(chalk.red.bold(`❌ Транзакция слишком большая: ${serMessage.length} bytes (макс 1232)`));
            return;
        }
        console.log(chalk.cyan(`📦 Размер транзакции: ${serMessage.length} bytes`));

        const fullTX = new VersionedTransaction(messageV0);
        
        // ВАЖНО: Подписываем только рабочим кошельком (он же платит)
        fullTX.sign([workerKeypair]);

        console.log(chalk.cyan(`\n🧪 Симуляция транзакции...`));
        const simulationResult = await connection.simulateTransaction(fullTX);
        if (simulationResult.value.err) {
            console.error(chalk.red(`❌ Симуляция не прошла: ${JSON.stringify(simulationResult.value.err)}`));
            if (simulationResult.value.logs) {
                console.error(chalk.red(`📋 Логи симуляции:`));
                simulationResult.value.logs.forEach((log, index) => {
                    console.error(chalk.red(`   [${index}] ${log}`));
                });
            }
            return;
        }
        console.log(chalk.green(`✅ Симуляция прошла успешно`));

        transactions.push(fullTX);
        signatures.push(bs58.encode(fullTX.signatures[0]));
    } catch (error) {
        console.error(chalk.red(`❌ Ошибка при создании транзакции: ${(error as Error).message}`));
        if (error instanceof Error && error.stack) {
            console.error(chalk.red(`📍 Stack: ${error.stack}`));
        }
        return;
    }

    if (transactions.length === 0) {
        console.warn(chalk.yellow("⚠️  Нет валидных транзакций для отправки, пропускаем.\n"));
        return;
    }

    const submittedSignatures: string[] = [];
    console.log(chalk.cyan.bold(`\n📤 ОТПРАВКА ТРАНЗАКЦИЙ\n`));
    
    for (const tx of transactions) {
        try {
            const signature = await sendTransactionTo0slot(tx);
            submittedSignatures.push(signature);
        } catch (error) {
            console.error(chalk.red(`❌ Ошибка при отправке транзакции: ${(error as Error).message}`));
        }
    }

    if (submittedSignatures.length === 0) {
        console.error(chalk.red(`❌ Ни одна транзакция не была отправлена успешно`));
        return;
    }

    console.log(chalk.cyan.bold(`\n⏳ ПОДТВЕРЖДЕНИЕ ТРАНЗАКЦИЙ (ЧЕРЕЗ ВЕБСОКЕТ)\n`));

    // Используем вебсокет подписку вместо RPC
    const confirmationResults = await Promise.all(
        submittedSignatures.map(signature => confirmTransactionWithWebsocket(connection, signature, 120000))
    );

    const successCount = confirmationResults.filter(result => result).length;
    const failCount = confirmationResults.filter(result => !result).length;

    console.log(chalk.cyan.bold(`\n═══════════════════════════════════════`));
    console.log(chalk.cyan.bold(`📊 РЕЗУЛЬТАТЫ ПРОДАЖИ`));
    console.log(chalk.cyan.bold(`═══════════════════════════════════════`));
    console.log(chalk.green(`✅ Успешно: ${successCount}`));
    if (failCount > 0) {
        console.log(chalk.red(`❌ Не удалось: ${failCount}`));
    }
    console.log(chalk.cyan.bold(`═══════════════════════════════════════\n`));
}

export { dumpAll };