import { writeFileSync, readFileSync, existsSync } from 'fs';
import chalk from "chalk";

// Function to save the amount to a JSON file associated with a mint key
function saveAmount(mint: string, amount: number, filePath: string = 'amounts.json'): void {
    let data: Record<string, number> = {};

    if (existsSync(filePath)) {
        const fileContent = readFileSync(filePath, 'utf8');
        data = JSON.parse(fileContent);
    }

    data[mint] = amount;

    writeFileSync(filePath, JSON.stringify(data));
}

// Function to fetch the sum of all amounts from the JSON file
function fetchTotalAmount(filePath: string = 'amounts.json'): number {
    if (!existsSync(filePath)) {
        console.log("File does not exist. Returning zero amount.");
        return 0;
    }

    const fileContent = readFileSync(filePath, 'utf8');
    const data: Record<string, number> = JSON.parse(fileContent);
    return Object.values(data).reduce((acc: number, current: number) => acc + current, 0);
}

// Function to wipe or reset the contents of amounts.json
function wipeAmountsFile(filePath: string = 'amounts.json'): void {
    try {
        writeFileSync(filePath, JSON.stringify({}));
        console.log(chalk.grey("The contents of the amounts file have been successfully wiped."));
    } catch (error: any) {
        console.error(`Failed to wipe the file: ${error.message}`);
    }
}

export { saveAmount, fetchTotalAmount, wipeAmountsFile };