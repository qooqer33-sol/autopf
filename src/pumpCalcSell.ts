import BN from 'bn.js';
import fs from 'fs';
import {Connection, PublicKey} from '@solana/web3.js';
import { BondingCurveLayout } from './PUMP_LAYOUT';
import {getWithRetry} from "./helper";
import { RPC_URL, WS_URL } from "./constants";

interface Reserves {
    virtualSolReserves: BN;
    virtualTokenReserves: BN;
    realTokenReserves: BN;
    feeBasisPoints: BN;
    rSolReserves: number;
    tokenTotalSupply: number;
    adjustedVTokenReserve: number;
    adjustedVSolReserve: number;
    virtualTokenPrice: number;
}

interface NewReserves {
    virtualSolReserves: string;
    virtualTokenReserves: string;
    realTokenReserves: string;
    feeBasisPoints: string;
    rSolReserves: number;
    tokenTotalSupply: number;
    adjustedVTokenReserve: number;
    adjustedVSolReserve: number;
    virtualTokenPrice: number;
}

async function getReserves(bonding_curve: string): Promise<Reserves> {
    const rpcURL = RPC_URL;
    const wsURL = WS_URL;

    const conn = new Connection(rpcURL, {
        commitment: 'confirmed',
        wsEndpoint: wsURL,
    });

    const curve = new PublicKey(bonding_curve);
    console.log(`Fetching data for curve: ${curve.toBase58()}`);

    const data = await getWithRetry(async () => {
        return await conn.getAccountInfo(curve, {commitment: 'confirmed'});
    }, true)


    if (data === null) {
        throw new Error('Error Parsing Data, Likely RPC Issue.');
    }

    const buffer = Buffer.from(data.data).slice(8);
    const decodedData = BondingCurveLayout.deserialize(buffer);
    const virtualSolReserves = new BN(decodedData.virtualSolReserves.toString());
    const virtualTokenReserves = new BN(decodedData.virtualTokenReserves.toString());
    const realTokenReserves = new BN(decodedData.realTokenReserves.toString());
    const rSolReserves = Number(decodedData.realSolReserves);
    const tokenTotalSupply = Number(decodedData.tokenTotalSupply);
    const adjustedVTokenReserve = parseFloat(virtualTokenReserves.toString()) / 1e6;
    const adjustedVSolReserve = parseFloat(virtualSolReserves.toString()) / 1e9;
    const virtualTokenPrice = adjustedVSolReserve / adjustedVTokenReserve;
    const feeBasisPoints = new BN('10000');

    return {
        virtualSolReserves,
        virtualTokenReserves,
        realTokenReserves,
        feeBasisPoints,
        rSolReserves,
        tokenTotalSupply,
        adjustedVTokenReserve,
        adjustedVSolReserve,
        virtualTokenPrice,
    };
}

function updateReserves(newReserves: NewReserves): void {
    const updatedReserves = {
        virtualSolReserves: newReserves.virtualSolReserves,
        virtualTokenReserves: newReserves.virtualTokenReserves,
        realTokenReserves: newReserves.realTokenReserves,
        rSolReserves: newReserves.rSolReserves,
        tokenTotalSupply: newReserves.tokenTotalSupply,
        adjustedVTokenReserve: newReserves.adjustedVTokenReserve,
        adjustedVSolReserve: newReserves.adjustedVSolReserve,
        virtualTokenPrice: newReserves.virtualTokenPrice,
    };
    fs.writeFileSync('./res/sellRes.json', JSON.stringify(updatedReserves, null, 2));
}

function calculateFee(e: BN, feeBasisPoints: BN): BN {
    return e.mul(feeBasisPoints).div(new BN('10000'));
}

function sellQuote(e: BN, t: Reserves): BN {
    if (e.eq(new BN(0)) || !t) {
        return new BN(0);
    }
    const product = t.virtualSolReserves.mul(t.virtualTokenReserves);
    const newTokenReserves = t.virtualTokenReserves.add(e);
    const newSolAmount = product.div(newTokenReserves).add(new BN(1));
    let solToReceive = t.virtualSolReserves.sub(newSolAmount);
    solToReceive = BN.min(solToReceive, t.realTokenReserves);
    return solToReceive;
}

async function calculateSellAmount(tokenAmountToSell: number, bonding_curve: string): Promise<number> {
    try {
        const t = await getReserves(bonding_curve); // Read current reserves from JSON

        let sol = sellQuote(new BN(tokenAmountToSell), t);
        if (sol.isNeg()) {
            sol = new BN(0);
        }
        const formattedSol = sol.toNumber() / 1e9;
        const formattedTokens = tokenAmountToSell / 1e6;

        if (isNaN(formattedTokens)) {
            throw new Error('Invalid input, please provide a valid number.');
        }

        // Update reserves for the next transaction
        const product = t.virtualSolReserves.mul(t.virtualTokenReserves);
        const newTokenReserves = t.virtualTokenReserves.add(new BN(tokenAmountToSell));
        const newSolAmount = product.div(newTokenReserves).add(new BN(1));
        let solToReceive = t.virtualSolReserves.sub(newSolAmount);
        solToReceive = BN.min(solToReceive, t.realTokenReserves);

        // Calculate fee and adjust reserves
        const fee = calculateFee(new BN(tokenAmountToSell), t.feeBasisPoints);
        t.virtualTokenReserves = newTokenReserves.sub(fee);
        t.virtualSolReserves = t.virtualSolReserves.sub(solToReceive);

        // Write updated reserves back to JSON
        updateReserves({
            virtualSolReserves: t.virtualSolReserves.toString(),
            virtualTokenReserves: t.virtualTokenReserves.toString(),
            realTokenReserves: t.realTokenReserves.toString(),
            feeBasisPoints: t.feeBasisPoints.toString(),
            rSolReserves: t.rSolReserves,
            tokenTotalSupply: t.tokenTotalSupply,
            adjustedVTokenReserve: t.adjustedVTokenReserve,
            adjustedVSolReserve: t.adjustedVSolReserve,
            virtualTokenPrice: t.virtualTokenPrice,
        });

        return formattedSol;
    } catch (error) {
        console.error(error as Error);
        throw error; // Rethrow the error after logging it
    }
}

export default calculateSellAmount;