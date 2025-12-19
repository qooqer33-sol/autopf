import chalk from "chalk";
import { fetchTotalAmount } from "./amountSaver";
import { getWithRetry } from "./helper";
import { Connection, PublicKey } from "@solana/web3.js";
import { dumpAll } from "./dumpAll";
import dotenv from "dotenv";
import * as readline from "readline";
import { RPC_URL } from "./constants";

let breakCurveTrigger = false;
let cheapestSaleTrigger = false;

const enableKeypressListener = () => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }

    const keypressHandler = (str: string, key: readline.Key) => {
        if (key && key.name === 'b') {
            console.log('[ "B" pressed ]');
            breakCurveTrigger = true;
        } else if (key && key.name === 'l') {
            console.log('[ "L" pressed: initiating cheapest sale ]');
            cheapestSaleTrigger = true;
            breakCurveTrigger = true;
        } else if (key && (key.name === 'c' && key.ctrl)) {
            console.log('Ctrl+C pressed');
            process.exit();
        } else if (key && (key.name === 'z' && key.ctrl)) {
            console.log('Ctrl+Z pressed');
            process.stdin.pause();
        }
    };

    process.stdin.on('keypress', keypressHandler);

    return () => {
        process.stdin.off('keypress', keypressHandler);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
    };
};

function colorHex(ix: number): string {
    const colors = [
        "#B33C3C", "#b36e3c", "#B3B33C", "#3CB33C", "#3CB3B3", "#3C3CB3", "#B33CB3"
    ];
    return colors[ix % colors.length];
}

/**
 * Проверка кривой и продажа токена
 * @param withDev - использовать ли dev режим
 * @param mintData - данные о токене (mint, bCurve, aBCurve, userQuoteToken)
 * @param workerAddress - адрес рабочего кошелька
 * @param workerPrivateKey - приватный ключ рабочего кошелька (в формате base58)
 */
async function checkCurveAndSell(
    withDev: boolean,
    mintData: any,
    workerAddress?: string,
    workerPrivateKey?: string
) {
    dotenv.config();

    breakCurveTrigger = false;
    cheapestSaleTrigger = false;
    
    const url = RPC_URL;
    const tokenThresholdMillions = parseInt(process.env.TOKEN_THRESHOLD_MILLIONS as string);
    console.log(chalk.cyan(`Using TOKEN_THRESHOLD_MILLIONS: ${tokenThresholdMillions}`));
    const connection = new Connection(url, { commitment: 'confirmed' });

    const mint = mintData.mint;
    const bCurve = mintData.bCurve;
    const aBCurve = mintData.aBCurve;
    const userQuoteToken = mintData.userQuoteToken;

    const totalBoughtSPLTokensAmount = fetchTotalAmount();
    const tokenTotalSupply = 1000000000;
    const minExpectedBuys = tokenTotalSupply - totalBoughtSPLTokensAmount - tokenThresholdMillions * 1000000;
    let continueChecking = true;
    let colorIx = 0;
    const disableKeypressListener = enableKeypressListener();

    // ТАЙМЕР 15 СЕКУНД ДЛЯ АВТОМАТИЧЕСКОГО ВЫВОДА
    let autoSellTriggered = false;
    const autoSellTimeout = setTimeout(() => {
        if (!autoSellTriggered && continueChecking) {
            console.log(chalk.yellow.bold('\n⏰ ТАЙМЕР 15 СЕКУНД ИСТЕК! Автоматически выводим токены...\n'));
            autoSellTriggered = true;
            breakCurveTrigger = true;
        }
    }, 60000);

    console.log(chalk.cyan(`Starting curve polling... Min expected buys: ${Math.floor(minExpectedBuys).toLocaleString()}`));
    while (continueChecking) {
        try {
            const curveTokenAccount = await getWithRetry(async () => {
                return await connection.getTokenAccountsByOwner(new PublicKey(bCurve), { mint: new PublicKey(mint) });
            });
            if (!curveTokenAccount.value || curveTokenAccount.value.length === 0) {
                console.log(chalk.red("Bonding curve token account not found. Retrying in 0.5 seconds..."));
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            const bCurveTokenAccountPubKey = curveTokenAccount.value[0].pubkey.toBase58();
            const bCurveTokenAccountBalance = await getWithRetry(async () => {
                return await connection.getTokenAccountBalance(new PublicKey(bCurveTokenAccountPubKey));
            });
            const bCurveTokenAmount = parseInt(bCurveTokenAccountBalance.value.amount) / 1e6;

            if (bCurveTokenAmount > minExpectedBuys) {
                // Проверяем был ли нажат триггер
                if (breakCurveTrigger) {
                    continueChecking = false;
                    clearTimeout(autoSellTimeout);
                    console.log(chalk.green("Manual trigger activated. Initiating sale..."));
                    await dumpAll(withDev, cheapestSaleTrigger, mintData, workerAddress, workerPrivateKey);
                    break;
                }
                
                const needMore = bCurveTokenAmount - minExpectedBuys;
                console.log(chalk.hex(colorHex(colorIx))`Need ${Math.floor(needMore).toLocaleString()} more [Retrying every 0.5 sec] ["B" = INSTANT SELL] ["L" = CHEAPEST SALE] ["Ctrl+C" = STOP]`);
                colorIx++;
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;  // Условие не выполнено, продолжаем ждать
            }

            // Условие выполнено ИЛИ триггер сработал
            continueChecking = false;
            clearTimeout(autoSellTimeout);
            console.log(chalk.green("Curve condition met or manual trigger activated. Initiating sale..."));
            await dumpAll(withDev, cheapestSaleTrigger, mintData, workerAddress, workerPrivateKey);
        } catch (error) {
            console.log(chalk.red(`Error checking curve: ${(error as Error).message}. Retrying in 0.5 seconds...`));
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    clearTimeout(autoSellTimeout);
    disableKeypressListener();
}

export { checkCurveAndSell };