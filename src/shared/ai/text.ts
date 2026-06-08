/**
 * Strip a Markdown code fence the model wraps its output in despite instructions — a leading
 * ```` ```<lang> ```` (json / markdown / md / js / …, or none) and the trailing ```` ``` ````.
 * One shared helper so a new fence variant only has to be handled in a single place.
 */
export const stripFences = (s: string): string =>
  s.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim()
