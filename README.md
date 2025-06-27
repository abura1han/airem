# Airem

A TypeScript library for managing transactional workflows with sequential step execution, rollback on failure, retry logic, and event handling. `airem` provides a fluent, type-safe API to define and execute transactions, making it ideal for operations requiring atomicity and error recovery, such as database transactions, API call sequences, or stateful processes.

## Features
- **Fluent Interface**: Chainable methods to define steps, events, and execution.
- **Rollback Support**: Automatic rollback on failure with step-specific and global handlers.
- **Retry Logic**: Configurable retries for transient failures.
- **Step Events**: Hooks for `onStart`, `onSuccess`, and `onError` to monitor step execution.
- **Logging**: Optional logger for debugging and tracing.
- **Type Safety**: Full TypeScript support with generics for context types.

## Installation
Install `airem` via npm:

```bash
npm install airem
```

## Quick Start
Create a transaction, define steps with optional rollback and retry logic, and execute it:

```typescript
import { Transaction } from 'airem';

async function example() {
  const txn = new Transaction((msg, details) => console.log(msg, details))
    .step({
      name: 'user_query',
      execute: () => ({ userId: 123, step: 'user_query' }),
      rollback: (ctx, error) => console.log(`Reverting user_query: ${error.message}`),
      retry: { attempts: 2, delayMs: 100 }
    })
    .step({
      name: 'user_update',
      execute: (ctx) => {
        if (!ctx?.userId) throw new Error('Missing user');
        return { step: 'user_update', userId: ctx.userId };
      },
      rollback: (ctx, error) => console.log(`Reverting user_update: ${error.message}`)
    })
    .onStep({
      onStart: (step, ctx) => console.log(`Starting ${step}`),
      onSuccess: (step, result) => console.log(`Success ${step}`, result),
      onError: (step, error) => console.log(`Error in ${step}`, error.message)
    });

  try {
    const result = await txn.run();
    console.log('Transaction completed:', result);
  } catch (error) {
    console.error('Transaction failed:', error);
  }
}

example();
```

This example defines a transaction with two steps, retries the first step on failure, and logs step events. If a step fails, rollbacks are executed in reverse order.

## API Reference

### `Transaction` Class
Manages a sequence of steps with rollback, retry, and event handling.

#### Constructor
```typescript
new Transaction(logger?: (message: string, details?: any) => void)
```
- `logger`: Optional function to log messages and details (e.g., step execution, errors, rollbacks).
- Returns a new `Transaction` instance.

#### `step`
Adds a single step to the transaction.
```typescript
step<NextCtx>(step: TransactionStep<Ctx, NextCtx>): Transaction<NextCtx>
```
- `step`: A `TransactionStep` object with:
  - `name: string` - Unique name for the step.
  - `execute: (ctx: Ctx) => NextCtx | Promise<NextCtx>` - Function to execute the step.
  - `rollback?: (ctx: Ctx, error: Error) => void | Promise<void>` - Optional rollback function.
  - `retry?: { attempts: number; delayMs: number }` - Optional retry configuration.
- Returns the `Transaction` instance for chaining.

#### `steps`
Adds multiple steps to the transaction.
```typescript
steps<NextCtx>(steps: TransactionStep<Ctx, NextCtx>[]): Transaction<NextCtx>
```
- `steps`: Array of `TransactionStep` objects.
- Returns the `Transaction` instance for chaining.

#### `onStep`
Sets step event handlers and an optional global rollback function.
```typescript
onStep(events: {
  onStart?: (step: string, ctx: Ctx) => void | Promise<void>;
  onSuccess?: (step: string, ctx: Ctx, result: any) => void | Promise<void>;
  onError?: (step: string, ctx: Ctx, error: Error) => void | Promise<void>;
  rollback?: (ctx: Ctx, error: Error) => void | Promise<void>;
}): Transaction<Ctx>
```
- `events`: Object with event handlers:
  - `onStart`: Called before a step executes.
  - `onSuccess`: Called after a step succeeds.
  - `onError`: Called if a step fails (before retries are exhausted).
  - `rollback`: Global rollback handler called for each step during rollback.
- Returns the `Transaction` instance for chaining.

#### `run`
Executes the transaction, running steps sequentially and handling rollbacks on failure.
```typescript
async run(): Promise<Ctx>
```
- Returns a promise resolving to the context from the last step.
- Throws the original error if the transaction fails, after executing rollbacks.

### `TransactionStep` Interface
Defines a single transaction step.
```typescript
interface TransactionStep<Ctx = any, NextCtx = any> {
  name: string;
  execute: (ctx: Ctx) => NextCtx | Promise<NextCtx>;
  rollback?: (ctx: Ctx, error: Error) => void | Promise<void>;
  retry?: { attempts: number; delayMs: number };
}
```

## Advanced Example
This example demonstrates retries, logging, and event handling:

```typescript
import { Transaction } from 'airem';

async function runTransaction() {
  const logger = (msg: string, details?: any) => console.log(`[LOG] ${msg}`, details);

  const txn = new Transaction(logger)
    .step({
      name: 'fetch_data',
      execute: async () => {
        // Simulate API call that may fail
        if (Math.random() > 0.5) throw new Error('API failure');
        return { data: 'some_data' };
      },
      rollback: (ctx, error) => logger(`Reverting fetch_data: ${error.message}`, ctx),
      retry: { attempts: 3, delayMs: 200 }
    })
    .step({
      name: 'process_data',
      execute: (ctx) => {
        if (!ctx?.data) throw new Error('No data');
        return { processed: true, data: ctx.data };
      },
      rollback: (ctx, error) => logger(`Reverting process_data: ${error.message}`, ctx)
    })
    .onStep({
      onStart: (step, ctx) => logger(`Starting ${step}`, ctx),
      onSuccess: (step, ctx, result) => logger(`Completed ${step}`, result),
      onError: (step, ctx, error) => logger(`Failed ${step}`, error.message),
      rollback: (ctx, error) => logger(`Global rollback`, ctx)
    });

  try {
    const result = await txn.run();
    logger('Transaction completed', result);
  } catch (error) {
    logger('Transaction failed', error);
  }
}

runTransaction();
```

### Output (if `fetch_data` fails after one retry):
```
[LOG] Starting fetch_data undefined
[LOG] Failed fetch_data API failure
[LOG] Retrying step fetch_data after error { error: [Error: API failure] }
[LOG] Starting fetch_data undefined
[LOG] Failed fetch_data API failure
[LOG] Transaction failed, initiating rollback { error: [Error: API failure] }
[LOG] Global rollback undefined
[LOG] Transaction failed [Error: API failure]
```

## Type Safety
`airem` uses TypeScript generics to ensure type-safe context passing. For example:

```typescript
interface InitialContext { userId: number }
interface UpdatedContext { userId: number; updated: boolean }

const txn = new Transaction()
  .step<InitialContext>({
    name: 'init',
    execute: () => ({ userId: 123 })
  })
  .step<UpdatedContext>({
    name: 'update',
    execute: (ctx: InitialContext) => ({ userId: ctx.userId, updated: true })
  });

const result = await txn.run(); // Typed as UpdatedContext
```

## Error Handling
- If a step fails, `run()` triggers rollback for all completed steps in reverse order.
- Step-specific `rollback` handlers are called first, followed by the global `rollback` handler (if defined).
- Rollback failures are logged but do not interrupt the rollback process.
- The original error is rethrown after rollback.

## Best Practices
- **Step Names**: Use unique, descriptive names for steps to aid debugging.
- **Rollback Logic**: Ensure rollback functions are idempotent to handle repeated calls safely.
- **Retries**: Set reasonable `attempts` and `delayMs` values to avoid excessive retries.
- **Logging**: Provide a logger to trace transaction flow, especially in production.
- **Type Safety**: Define context interfaces to leverage TypeScript’s type checking.

## License
MIT
