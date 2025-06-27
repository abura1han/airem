/**
 * Defines a step function that transforms context from Ctx to NextCtx.
 * Can be synchronous or asynchronous.
 */
type StepFunction<Ctx = any, NextCtx = any> = (
  ctx: Ctx
) => NextCtx | Promise<NextCtx>;

/**
 * Defines a rollback function that handles cleanup for a step.
 * Receives the context and the error that triggered the rollback.
 */
type RollbackFunction<Ctx = any> = (
  ctx: Ctx,
  error: Error
) => void | Promise<void>;

/**
 * Defines step event handlers for onStart, onSuccess, and onError.
 */
interface StepEvents<Ctx = any> {
  onStart?: (step: string, ctx: Ctx) => void | Promise<void>;
  onSuccess?: (step: string, ctx: Ctx, result: any) => void | Promise<void>;
  onError?: (step: string, ctx: Ctx, error: Error) => void | Promise<void>;
}

/**
 * Defines a transaction step with execution, optional rollback, and retry logic.
 */
interface TransactionStep<Ctx = any, NextCtx = any> {
  name: string; // Unique name for the step
  execute: StepFunction<Ctx, NextCtx>; // Function to execute the step
  rollback?: RollbackFunction<Ctx>; // Optional rollback function
  retry?: { attempts: number; delayMs: number }; // Optional retry configuration
}

/**
 * Transaction class for managing a sequence of steps with rollback and retry capabilities.
 */
class Transaction<Ctx = any> {
  private tasks: TransactionStep[] = []; // Stores the sequence of steps
  private globalRollback?: RollbackFunction; // Global rollback handler
  private stepEvents: StepEvents = {}; // Step event handlers
  private logger?: (message: string, details?: any) => void; // Optional logger

  /**
   * Constructor to initialize the transaction with an optional logger.
   * @param logger - Optional function to log messages and details
   */
  constructor(logger?: (message: string, details?: any) => void) {
    this.logger = logger;
  }

  /**
   * Adds a single step to the transaction.
   * @param step - The step configuration with name, execute, and optional rollback/retry
   * @returns The transaction instance for chaining
   */
  step<NextCtx = any>(
    step: TransactionStep<Ctx, NextCtx>
  ): Transaction<NextCtx> {
    this.tasks.push(step);
    return this as unknown as Transaction<NextCtx>;
  }

  /**
   * Adds multiple steps to the transaction.
   * @param steps - Array of step configurations
   * @returns The transaction instance for chaining
   */
  steps<NextCtx = any>(
    steps: TransactionStep<Ctx, NextCtx>[]
  ): Transaction<NextCtx> {
    this.tasks.push(...steps);
    return this as unknown as Transaction<NextCtx>;
  }

  /**
   * Sets step event handlers (onStart, onSuccess, onError) and global rollback.
   * @param events - Object containing event handlers and optional rollback
   * @returns The transaction instance for chaining
   */
  onStep(
    events: StepEvents<Ctx> & { rollback?: RollbackFunction<Ctx> }
  ): Transaction<Ctx> {
    this.stepEvents = {
      onStart: events.onStart,
      onSuccess: events.onSuccess,
      onError: events.onError,
    };
    this.globalRollback = events.rollback;
    return this;
  }

  /**
   * Executes the transaction, running steps sequentially with retries and handling rollbacks on failure.
   * @returns The context from the last step
   * @throws The error that caused the transaction to fail after rollback
   */
  async run(): Promise<Ctx> {
    type Context = { step: string; ctx: any };
    const contexts: Context[] = []; // Stores context for rollback
    let context: any = undefined; // Current context

    try {
      for (const { name, execute, retry } of this.tasks) {
        this.logger?.(`Starting step: ${name}`, { context });
        await this.stepEvents.onStart?.(name, context);

        let attempts = retry?.attempts ?? 1;
        let lastError: Error | undefined;

        // Retry logic
        while (attempts > 0) {
          try {
            const result = await execute(context);
            this.logger?.(`Step ${name} succeeded`, { result });
            await this.stepEvents.onSuccess?.(name, context, result);
            contexts.push({ step: name, ctx: context });
            context = result;
            break;
          } catch (error) {
            lastError = error as Error;
            attempts--;
            if (attempts > 0 && retry?.delayMs) {
              this.logger?.(`Retrying step ${name} after error`, { error });
              await new Promise((resolve) =>
                setTimeout(resolve, retry.delayMs)
              );
            } else {
              this.logger?.(`Step ${name} failed`, { error });
              await this.stepEvents.onError?.(name, context, lastError);
              throw error; // Rethrow after retries exhausted
            }
          }
        }
      }

      return context; // Return the last step's context
    } catch (error) {
      this.logger?.(`Transaction failed, initiating rollback`, { error });
      // Rollback in reverse order
      for (let i = contexts.length - 1; i >= 0; i--) {
        const { step, ctx } = contexts[i] as Context;
        const stepDef = this.tasks.find((s) => s.name === step);

        // Step-specific rollback
        if (stepDef?.rollback) {
          try {
            this.logger?.(`Executing step-specific rollback for ${step}`, {
              ctx,
            });
            await stepDef.rollback(ctx, error as Error);
          } catch (revertErr) {
            this.logger?.(`Step-specific rollback failed for ${step}`, {
              revertErr,
            });
            console.warn(
              `Step-specific rollback failed for "${step}":`,
              revertErr
            );
          }
        }

        // Global rollback
        if (this.globalRollback) {
          try {
            this.logger?.(`Executing global rollback for ${step}`, { ctx });
            await this.globalRollback(ctx, error as Error);
          } catch (revertErr) {
            this.logger?.(`Global rollback failed for ${step}`, { revertErr });
            console.warn(`Global rollback failed for "${step}":`, revertErr);
          }
        }
      }
      throw error; // Rethrow original error
    }
  }
}

export { Transaction, type TransactionStep };
