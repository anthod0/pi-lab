export function interpolateEnv(
  input: string,
  source: Readonly<NodeJS.ProcessEnv>,
): { value: string; missingVariables: string[] } {
  const parts: string[] = [];
  const missingVariables = new Set<string>();
  let cursor = 0;

  while (cursor < input.length) {
    const start = input.indexOf("${", cursor);
    if (start === -1) {
      parts.push(input.slice(cursor));
      break;
    }

    const escaped = start > cursor && input[start - 1] === "$";
    const tokenStart = escaped ? start - 1 : start;
    parts.push(input.slice(cursor, tokenStart));

    // Consume the whole token, including unsupported nested expressions, so
    // their inner references cannot be expanded accidentally.
    let depth = 1;
    let end = start + 2;
    for (; end < input.length; end++) {
      if (input[end] === "{") depth++;
      if (input[end] === "}" && --depth === 0) break;
    }
    if (depth !== 0) {
      parts.push(input.slice(tokenStart));
      break;
    }

    const token = input.slice(start, end + 1);
    const body = input.slice(start + 2, end);
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?::-(.*))?$/s.exec(body);
    if (escaped) {
      parts.push(token);
    } else if (!match || body.includes("${")) {
      parts.push(token);
    } else {
      const [, name, fallback] = match;
      const value = Object.hasOwn(source, name) ? source[name] : undefined;
      if (fallback !== undefined && (value === undefined || value === "")) {
        parts.push(fallback);
      } else if (value !== undefined) {
        parts.push(value);
      } else {
        parts.push(token);
        missingVariables.add(name);
      }
    }
    cursor = end + 1;
  }

  return { value: parts.join(""), missingVariables: [...missingVariables] };
}
