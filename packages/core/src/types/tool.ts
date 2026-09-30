/** A JSON Schema object describing a tool's parameters. */
export type JsonSchema = Record<string, unknown>;

/** A model's request to call a tool; `arguments` is a JSON string, as in OpenAI. */
export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

/** A tool the model may call, described by a name, a description and a parameter schema. */
export type ToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchema };
};
