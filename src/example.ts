import { Transaction } from ".";

async function example() {
  const txn = new Transaction((msg, details) => console.log(msg, details))
    .step({
      name: "user_query",
      execute: () => {
        return { userId: 123, step: "user_query" };
      },
      rollback: (ctx, error) => {
        console.log(`Reverting user_query: ${error.message}`, ctx);
      },
      retry: { attempts: 2, delayMs: 100 },
    })
    .steps([
      {
        name: "user_update",
        execute: (ctx) => {
          if (!ctx?.userId) throw new Error("Missing user");
          return { step: "user_update", userId: ctx.userId };
        },
        rollback: (ctx, error) => {
          console.log(`Reverting user_update: ${error.message}`, ctx);
        },
      },
      {
        name: "step_3",
        execute: () => {
          throw new Error("Something failed in step 3");
        },
      },
    ])
    .onStep({
      onStart: (step, ctx) => console.log(`Starting ${step}`, ctx),
      onSuccess: (step, ctx, result) => console.log(`Success ${step}`, result),
      onError: (step, ctx, error) =>
        console.log(`Error in ${step}`, error.message),
      rollback: (ctx, error) =>
        console.log(`Global rollback`, ctx, error.message),
    });

  try {
    const result = await txn.run();
    console.log("Transaction completed:", result);
    // Outputs: { step: "user_update", userId: 123 } if successful
  } catch (error) {
    console.error("Transaction failed:", error);
  }
}

example();
