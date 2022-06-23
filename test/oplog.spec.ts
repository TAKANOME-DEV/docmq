import anytest, { TestFn } from "ava";
import { MongoMemoryReplSet, MongoMemoryServer } from "mongodb-memory-server";
import { v4 } from "uuid";
import { Queue } from "../src/queue.js";

interface Context {
  mongo: MongoMemoryReplSet;
}

interface SimpleJob {
  success: boolean;
}

const test = anytest as TestFn<Context>;

// create a clean mongo in-memory for every test
test.before(async (t) => {
  const rs = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: v4(), storageEngine: "wiredTiger" },
  });
  t.context.mongo = rs;
});

// Makes sure the oplog is used to minimize polling load
// all other times, we'll a 1ms poll to move through tests as fast as possible
test("Leverages the oplog to minimize polling", async (t) => {
  const queue = new Queue<SimpleJob>(t.context.mongo.getUri(), v4());

  const p = new Promise<void>((resolve) => {
    queue.process(
      async (job, api) => {
        t.true(job.success);
        await api.ack();
        t.pass();
        resolve();
      },
      {
        concurrency: 1,
        pollIntervalMs: 40000,
      }
    );
  });

  t.timeout(15000, "Max wait time exceeded");
  await queue.enqueue({
    success: true,
  });
  await p; // wait for finish
});

test("Won't run without a replica set", async (t) => {
  const mms = await MongoMemoryServer.create({
    instance: {
      storageEngine: "wiredTiger",
    },
  });

  const queue = new Queue<SimpleJob>(mms.getUri(), v4());

  const p = new Promise<void>((resolve, reject) => {
    queue.process(
      async () => {
        t.fail(); // we should never reach this
        resolve();
      },
      {
        pollIntervalMs: 1,
      }
    );
    queue.events.on("error", (err) => {
      reject(err);
    });
  });

  t.throwsAsync(
    queue.enqueue({
      success: true,
    })
  );

  await t.throwsAsync(p); // wait for finish
  t.pass();
});