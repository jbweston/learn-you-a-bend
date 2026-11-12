const U32_MAX = 4294967295;
const STRING_LIMIT = 1024;

function integer(value, max, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be an integer from 0 to ${max}.`);
  }
}

function text(value, label) {
  if (typeof value !== 'string' || value.length > STRING_LIMIT) {
    throw new Error(`${label} must be text of at most ${STRING_LIMIT} characters.`);
  }
}

// Validate at the worker boundary too, before invoking any compiled code.
export function validateArgs(operation, args) {
  const arities = {
    values: 0, square: 1, area: 2, sum: 1, functions: 2,
    replicate: 2, parse: 2, greeting: 1, pow2: 1, law_sample: 1, array: 2,
  };
  if (!Object.hasOwn(arities, operation)) throw new Error('Unknown demo operation.');
  if (!Array.isArray(args) || args.length !== arities[operation]) {
    throw new Error('Invalid demo arguments.');
  }
  switch (operation) {
    case 'values': break;
    case 'square': integer(args[0], U32_MAX, 'Number'); break;
    case 'area':
      integer(args[0], 1, 'Shape');
      integer(args[1], U32_MAX, 'Size');
      break;
    case 'sum':
      if (!Array.isArray(args[0]) || args[0].length > 128) {
        throw new Error('List must contain at most 128 U32 values.');
      }
      for (const value of args[0]) integer(value, U32_MAX, 'List item');
      break;
    case 'functions':
    case 'array':
      for (const value of args) integer(value, U32_MAX, 'U32 input');
      break;
    case 'replicate':
      integer(args[0], 64, 'Count');
      integer(args[1], U32_MAX, 'Value');
      break;
    case 'parse':
      text(args[0], 'First string');
      text(args[1], 'Second string');
      break;
    case 'greeting': text(args[0], 'Name'); break;
    case 'pow2': integer(args[0], 16, 'Counter'); break;
    case 'law_sample': integer(args[0], 256, 'Natural number'); break;
  }
  return args;
}

export function toBendList(values) {
  return values.reduceRight((tail, head) => ({ $: 'Con', head, tail }), { $: 'Nil' });
}

export function errorText(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export async function dispatch(operation, args) {
  validateArgs(operation, args);
  const { default: examples } = await import('./generated/examples.mjs');
  if (typeof examples?.[operation] !== 'function') {
    throw new Error(`Compiled runtime is missing ${operation}. Rebuild the tutorial.`);
  }
  // Only the validated whitelist is reachable; no source text is compiled here.
  return examples[operation](...(operation === 'sum' ? [toBendList(args[0])] : args));
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async (event) => {
    try {
      const { operation, args } = event.data ?? {};
      const value = await dispatch(operation, args);
      self.postMessage({ ok: true, value });
    } catch (error) {
      self.postMessage({ ok: false, error: errorText(error) });
    }
  };
}
