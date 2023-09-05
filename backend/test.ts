import { performance } from "perf_hooks";
import supertest from "supertest";
import { buildApp } from "./app";

const app = supertest(buildApp());

async function basicLatencyTest() {
    await app.post("/reset").expect(204);
    const start = performance.now();
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    console.log(`Latency: ${performance.now() - start} ms`);
}

async function testRedisLatency() {
    const start = performance.now();
    const response = await app.get("/measure-redis").expect(200);
    console.log(`Redis Connection Latency (measured in app.ts): ${response.body.latency} ms`);
}

async function raceConditionTest() {
    // Reset the account balance first
    await app.post("/reset").expect(204);

    const charges = 100; // This value should be close to the initial balance to demonstrate the race condition
    const requests = Array(10).fill(0).map(() => app.post("/charge").send({ charges })); // sending 10 simultaneous requests

    const responses = await Promise.all(requests);
    let successfulCharges = 0;
    responses.forEach((response, index) => {
        if (response.body.isAuthorized) {
            successfulCharges++;
            console.log(`Request ${index + 1}: Charged successfully. Remaining balance: $${response.body.remainingBalance}`);
        } else {
            console.log(`Request ${index + 1}: Charge failed. Remaining balance: $${response.body.remainingBalance}`);
        }
    });

    // Assert that only one request was successful
    if (successfulCharges === 1) {
        console.log("Concurrency Testing: No race conditions detected.");
    } else {
        console.log(`Concurrency Testing: Detected race condition. ${successfulCharges} requests were successful.`);
    }
}

async function runTests() {
    await basicLatencyTest();
    await testRedisLatency();
    await raceConditionTest();
}

runTests().catch(console.error);
