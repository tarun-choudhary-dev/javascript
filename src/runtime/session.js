import {LIMITS} from '../limits/policy.js';

// QuickJS runtime and context belong to one synchronous operation.
export function withQuickJSContext(moduleInstance, configure, use) {
  const runtime = moduleInstance.newRuntime();
  let context;
  try {
    runtime.setMemoryLimit(LIMITS.guestHeapBytes);
    runtime.setMaxStackSize(LIMITS.guestStackBytes);
    configure?.(runtime);
    context = runtime.newContext();
    return use(context);
  } finally {
    try { context?.dispose(); }
    finally { runtime.dispose(); }
  }
}
