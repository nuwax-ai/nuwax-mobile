/**
 * @fileoverview Prism JSON grammar extension
 */
export default function (Prism) {
  Prism.languages.json = {
    'property': {
      pattern: /"(?:\\.|[^\\"\r\n])*"(?=\s*:)/,
      greedy: true
    },
    'string': {
      pattern: /"(?:\\.|[^\\"\r\n])*"(?!\s*:)/,
      greedy: true
    },
    'comment': /\/\/.*|\/\*[\s\S]*?\*\//,
    'number': /-?\d+\.?\d*(?:[eE][+-]?\d+)?/,
    'punctuation': /[{}[\],]/,
    'operator': /:/,
    'boolean': /\b(?:true|false)\b/,
    'null': /\bnull\b/
  };
}
