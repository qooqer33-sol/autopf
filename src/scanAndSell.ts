import { PublicKey, Connection, ParsedAccountData } from '@solana/web3.js';
import { getWithRetry } from "./helper";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import dotenv from 'dotenv';
import { checkCurveAndSell } from "./curveChecker";
import { getKeypairFromBs58, getBondingCurve } from "./create";
import { saveAmount, wipeAmountsFile } from "./amountSaver";
import { PUMP_PROGRAM_ID, RPC_URL, WS_URL } from "./constants";
import chalk from 'chalk';

dotenv.config();

async function fetchTokenAndWaitForBuys() {
    const rpcURL = RPC_URL;
    const wsURL = WS_URL;
    const pubKey = process.env.DEV_ADDRESS as string;
    const pk = process.env.SIGNER_PRIVATE_KEY as string;
    const pollingInterval = 50;

    const connection = new Connection(rpcURL, {
        commitment: 'confirmed',
        wsEndpoint: wsURL
    });

    let firstMintAddr = "";
    let firstTokenBalance = 0;

    console.log(chalk.cyan(`Starting polling for tokens...`));

    while (!firstMintAddr) {
        try {
            const accounts = await getWithRetry(async () => {
                console.log("Trying to get token accounts:");
                return await connection.getParsedTokenAccountsByOwner(
                    new PublicKey(pubKey),
                    { programId: TOKEN_2022_PROGRAM_ID }
                );
            }, true);

            for (const account of accounts.value) {
                const parsedAccountInfo = account.account.data.parsed.info;
                const decimals = parsedAccountInfo.tokenAmount.decimals;
                const mintAddress = parsedAccountInfo.mint;
                const tokenBalance = parsedAccountInfo.tokenAmount.uiAmount;

                if (decimals === 6 && tokenBalance > 0) {
                    console.log(chalk.green(`Token ${mintAddress} found, checking for bonding curve...`));
                    firstMintAddr = mintAddress;
                    firstTokenBalance = parseFloat(tokenBalance as string);
                    break;
                }
            }

            if (!firstMintAddr) {
                console.log(chalk.yellow(`No suitable tokens found on wallet. Retrying in ${pollingInterval}ms...`));
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
                continue;
            }

            const signerKeypair = getKeypairFromBs58(pk)!;
            const tokenPubKey = new PublicKey(firstMintAddr);
            const bCurve = getBondingCurve(tokenPubKey, PUMP_PROGRAM_ID);
            const aBCurve = getAssociatedTokenAddressSync(tokenPubKey, bCurve, true, TOKEN_2022_PROGRAM_ID);
            const creator = new PublicKey(pubKey);

            const mintData = {
                mint: tokenPubKey.toBase58(),
                bCurve: bCurve.toBase58(),
                aBCurve: aBCurve.toBase58(),
                userQuoteToken: getAssociatedTokenAddressSync(
                    new PublicKey('So11111111111111111111111111111111111111112'),
                    creator,
                    false,
                    TOKEN_PROGRAM_ID
                ).toBase58(),
            };

            wipeAmountsFile();
            saveAmount(pubKey, firstTokenBalance);

            await checkCurveAndSell(true, mintData);
        } catch (error) {
            console.log(chalk.red(`Error during polling: ${(error as Error).message}. Retrying in ${pollingInterval}ms...`));
            await new Promise(resolve => setTimeout(resolve, pollingInterval));
        }
    }
}

export default fetchTokenAndWaitForBuys;