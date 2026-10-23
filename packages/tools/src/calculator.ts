import { AgentError, defineTool } from '@node-agent/core';
import { all, create } from 'mathjs';
import { z } from 'zod';

if (!all) throw new Error('mathjs: "all" factories are missing');
const math = create(all);
const evaluate = math.evaluate;

const disabled = (name: string) => () => {
  throw new Error(`Function ${name} is disabled`);
};

math.import(
  {
    createUnit: disabled('createUnit'),
    import: disabled('import'),
    evaluate: disabled('evaluate'),
    parse: disabled('parse'),
    reviver: disabled('reviver'),
    simplify: disabled('simplify'),
    derivative: disabled('derivative'),
    resolve: disabled('resolve'),
  },
  { override: true },
);

export type CalculateResponse = {
  expression: string;
  result: string;
};

export const calculatorTool = defineTool({
  name: 'calculator',
  description:
    'Evaluates a mathematical expression and returns the exact result. Use this for any ' +
    'arithmetic, powers, roots, trigonometry or unit conversion instead of computing in your ' +
    'head, since you often make mistakes with large numbers.',
  input: z.object({
    expression: z
      .string()
      .describe('A single expression, e.g. "12345 * 6789", "sqrt(2) ^ 2" or "2 inch to cm"')
      .max(200),
  }),
  async execute(input): Promise<CalculateResponse> {
    if (input.expression === '') {
      throw new AgentError(
        `Invalid expression: "${input.expression}". E.g. "12 * 34"`,
        'invalid_expression_input',
      );
    }

    let value: unknown;
    try {
      value = evaluate(input.expression);
    } catch (err) {
      throw new AgentError(
        `Could not evaluate "${input.expression}": ${err instanceof Error ? err.message : err}`,
        'invalid_expression_execution',
        { cause: err },
      );
    }

    const kind = math.typeOf(value);
    if (kind === 'function' || kind === 'undefined' || kind === 'ResultSet') {
      throw new AgentError(
        'Expression must produce a single value, e.g. "2 * (3 + 4)".',
        'invalid_expression_kind',
      );
    }

    return {
      expression: input.expression,
      result: math.format(value, { precision: 14, upperExp: 21 }),
    };
  },
});
