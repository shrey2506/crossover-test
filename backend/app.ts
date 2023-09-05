import express from "express";
import { createClient } from "redis";
import { json } from "body-parser";

const DEFAULT_BALANCE = 100;

interface ChargeResult {
    isAuthorized: boolean;
    remainingBalance: number;
    charges: number;
}

// Create a global Redis client instance and connect it.
const client = createClient({
    url: `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`
});
client.connect();

async function reset(account: string): Promise<void> {
    try {
        await client.set(`${account}/balance`, DEFAULT_BALANCE.toString());
    } catch (error) {
        console.error("Error while resetting account balance", error);
        throw error;
    }
}

async function acquireLock(client: any, lockKey: string, timeout = 10000, retryCount = 3, retryDelay = 100): Promise<boolean> {
    for (let i = 0; i < retryCount; i++) {
        const result = await client.set(lockKey, "LOCKED", "NX", "PX", timeout);
        if (result === "OK") {
            return true;
        }
        // If the lock is not acquired, wait for the retry delay before trying again
        await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
    return false;  // Return false if the lock could not be acquired after retrying
}

async function releaseLock(client: any, lockKey: string): Promise<void> {
    await client.del(lockKey);
}

async function charge(account: string, charges: number): Promise<ChargeResult> {
    const key = `${account}/balance`;
    const lockKey = `${key}:lock`;

    // Acquire the lock.
    const hasLock = await acquireLock(client, lockKey);
    if (!hasLock) {
        throw new Error("Failed to acquire lock");
    }

    try {
        const balance = parseInt((await client.get(key)) ?? "0");
        console.log(balance)
        if (balance >= charges) {
            await client.set(key, (balance - charges).toString());
            return { isAuthorized: true, remainingBalance: balance - charges, charges };
        } else {
            return { isAuthorized: false, remainingBalance: balance, charges: 0 };
        }
    } catch (error) {
        console.error("Error while charging account", error);
        throw error;
    } finally {
        // Always release the lock in a finally block to ensure it gets released.
        await releaseLock(client, lockKey);
    }
}



export function buildApp(): express.Application {
    const app = express();
    app.use(json());

    app.get("/measure-redis", async (_req, res) => {
        const start = Date.now();
        await client.ping();  // Simple Redis ping operation to measure latency
        const latency = Date.now() - start;
        res.status(200).json({ latency });
    });

    app.post("/reset", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            await reset(account);
            console.log(`Successfully reset account ${account}`);
            res.sendStatus(204);
        } catch (e) {
            console.error("Error while resetting account", e);
            res.status(500).json({ error: String(e) });
        }
    });

    app.post("/charge", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            const result = await charge(account, req.body.charges ?? 10);
            console.log(`Successfully charged account ${account}`);
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({ error: String(e) });
        }
    });

    return app;
}

// Handle process termination gracefully
process.on('exit', () => {
    client.disconnect();
});

process.on('SIGINT', () => {
    client.disconnect();
    process.exit();
});
