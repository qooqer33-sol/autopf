async function sleep(ms: number) {
    if (ms) return new Promise(resolve => setTimeout(resolve, ms));
    return Promise.resolve();
}

async function getWithRetry<T>(fn: () => Promise<T>, rerunOnNullAndEmpty: boolean = false): Promise<T> {
    const maxAttempts = 1000;
    const delay = 50;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const result = await fn();
            
            // Правильная логика проверки валидности результата
            const isValid = result !== null && 
                           result !== undefined && 
                           (!Array.isArray(result) || result.length > 0);
            
            // Возвращаем если результат валидный ИЛИ если не нужно переделывать на null/empty
            if (isValid || !rerunOnNullAndEmpty) {
                return result;
            }
            
            console.log(`Empty or null result [Retrying in ${delay / 1000} seconds...]`);
        } catch (error: any) {
            if (attempt === maxAttempts) {
                throw error;
            }
            console.warn(`Try #${attempt}. Error: ${error.message || error} [Retrying in ${delay / 1000} seconds...]`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    throw new Error("Maximum retry attempts reached, operation failed.");
}

export { getWithRetry, sleep };