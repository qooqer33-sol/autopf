import chalk from 'chalk';
import { dumpAll } from './dumpAll';
import promptSync from 'prompt-sync';
import dotenv from "dotenv";
import { checkCurveAndSell } from "./curveChecker";
import fetchTokenAndWaitForBuys from './scanAndSell';
import { RPC_URL, WS_URL } from "./constants";
import fs from 'fs';

process.removeAllListeners('warning');
process.removeAllListeners('ExperimentalWarning');

const normalizeBool = (input: any) => {
    switch (input.toLowerCase()) {
        case 'y':
            return true;
        case 'n':
            return false;
        default:
            return false;
    }
};

async function sell() {
    dotenv.config();
    const prompt = promptSync();

    console.log("\n");
    console.log(chalk.hex("#72F6AA")("1. Scan & Sell"));
    console.log(chalk.hex("#b72bfd")("2. Check Curve and Sell"));
    console.log(chalk.hex("#b72bfd")("3. Dump All"));
    console.log(chalk.redBright("0. Return to Main Menu"));

    const userInput = prompt("Choose an option: ");

    switch (userInput) {
        case '1':
            await fetchTokenAndWaitForBuys();
            break;

        case '2':
            const withDev = await parseWithDev();
            const mintData = await loadMintData();
            if (!mintData) return;
            await checkCurveAndSell(withDev, mintData);
            break;

        case '3':
            const withDevv = await parseWithDev();
            const mintData2 = await loadMintData();
            if (!mintData2) return;
            await dumpAll(withDevv, true, mintData2);
            break;

        case '0':
            console.log(chalk.yellow("Returning to Main Menu..."));
            break;

        default:
            console.log(chalk.redBright("Invalid option"));
            break;
    }

    async function parseWithDev() {
        const withDev = prompt("Sell dev wallet (Y/n): ");
        return normalizeBool(withDev);
    }

    async function loadMintData() {
        try {
            const mintDataRaw = fs.readFileSync('mint.json', 'utf8');
            const mintData = JSON.parse(mintDataRaw);
            if (!mintData.mint || !mintData.bCurve || !mintData.aBCurve || !mintData.userQuoteToken) {
                console.log(chalk.red('Invalid mint.json: missing required fields'));
                return null;
            }
            return mintData;
        } catch (error) {
            console.log(chalk.red(`Error loading mint.json: ${(error as Error).message}`));
            return null;
        }
    }
}

export default sell;