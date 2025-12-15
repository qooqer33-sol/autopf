import fs from 'fs';

async function loadWallets() {
    const rawData = fs.readFileSync("./wallets.txt", "utf8");
    let lines = rawData.trim().split("\n");
    const numberOfWalletsToUse = parseInt(process.env.NUMBER_OF_WALLETS_TO_USE as string);
    let wallets: { pubKey: string; privKey: string; }[] = [];

    for (let i = 0; i < lines.length && i < numberOfWalletsToUse; i++) {
        let line = lines[i];
        const parts = line.split(':');
        if (parts.length === 2) {
            line = line.replace(/\r$/, '');
            const publicKey = parts[0];
            const privateKey = parts[1];
            wallets.push({ pubKey: publicKey, privKey: privateKey });
        }
    }
    return wallets;
}

export default loadWallets;