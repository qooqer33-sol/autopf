
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import chalk from 'chalk';
import { PUMP_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants";

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getKeypairFromBs58(bs58String: string): Keypair | null {
    try {
        const privateKeyObject = bs58.decode(bs58String);
        const privateKey = Uint8Array.from(privateKeyObject);
        const keypair = Keypair.fromSecretKey(privateKey);
        return keypair;
    } catch (e) {
        console.log(chalk.red(`Error creating keypair: ${e}`));
        process.exit(1);
    }
}

export function getBondingCurve(mint: PublicKey, programId: PublicKey = PUMP_PROGRAM_ID): PublicKey {
    const [bondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), mint.toBuffer()],
        programId
    );
    return bondingCurve;
}