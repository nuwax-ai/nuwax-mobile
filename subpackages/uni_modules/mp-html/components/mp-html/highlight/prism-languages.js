/**
 * @fileoverview Additional Prism grammars for Java, Python, and TypeScript
 */
export default function (Prism) {
  // JSON
  if (!Prism.languages.json) {
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

  // Java
  if (!Prism.languages.java) {
    Prism.languages.java = Prism.languages.extend('clike', {
      'keyword': /\b(?:abstract|continue|for|new|switch|assert|default|goto|package|synchronized|boolean|do|if|private|this|break|double|implements|protected|throw|byte|else|import|public|throws|case|enum|instanceof|return|transient|catch|extends|int|short|try|char|final|interface|static|void|class|finally|long|strictfp|volatile|const|float|native|super|while)\b/,
      'number': /\b0b[01]+\b|\b0x[\da-f]*\.?[\da-f]+(?:p[+-]?\d+)?\b|(?:\b\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[df]?\b/i,
      'operator': {
        pattern: /(^|[^.])(?:<<=?|>>>=?|>>=?|==?|!=|&&?|\|\|?|[+*\/%^-]=?|[?:~]|[-+]{1,2})/m,
        lookbehind: true
      }
    });

    Prism.languages.insertBefore('java', 'function', {
      'annotation': {
        alias: 'punctuation',
        pattern: /(^|[^.])@\w+/,
        lookbehind: true
      }
    });
  }

  // Python
  if (!Prism.languages.python) {
    Prism.languages.python = {
      'comment': {
        pattern: /(^|[^\\])#.*/,
        lookbehind: true
      },
      'string-interpolation': {
        pattern: /(?:f|rf|fr)(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^\\"\r\n])*"|'(?:\\.|[^\\'\r\n])*')/i,
        greedy: true,
        inside: {
          'interpolation': {
            pattern: /((?:^|[^{])(?:{{)*){[\s\S]*?}/,
            lookbehind: true,
            inside: {
              'rest': null
            }
          },
          'string': /[\s\S]+/
        }
      },
      'string': {
        pattern: /(?:[bru]|rb|br)?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^\\"\r\n])*"|'(?:\\.|[^\\'\r\n])*')/i,
        greedy: true
      },
      'function': {
        pattern: /((?:^|\s)def\s+)\w+(?=\s*\()/g,
        lookbehind: true
      },
      'class-name': {
        pattern: /(\bclass\s+)\w+/i,
        lookbehind: true
      },
      'keyword': /\b(?:as|assert|async|await|break|class|continue|def|del|elif|else|except|exec|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|print|raise|return|try|while|with|yield)\b/,
      'builtin': /\b(?:bool|bytearray|bytes|complex|dict|float|frozenset|int|list|set|str|tuple|type|Any|Callable|Dict|List|Optional|Set|Tuple|Union)\b/,
      'boolean': /\b(?:True|False|None)\b/,
      'number': /\b(?:\d+\.?\d*(?:[eE][+-]?\d+)?|0x[\da-f]+|0b[01]+|0o[0-7]+)\b/i,
      'operator': /[-+*/%=<>!&|^~]+/,
      'punctuation': /[()\[\]{},.:;]/
    };
    Prism.languages.python['string-interpolation'].inside['interpolation'].inside.rest = Prism.languages.python;
  }

  // TypeScript
  if (!Prism.languages.typescript) {
    Prism.languages.typescript = Prism.languages.extend('javascript', {
      'keyword': /\b(?:abstract|as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|is|keyof|let|module|namespace|new|null|of|package|private|protected|public|readonly|return|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield|any|boolean|constructor|declare|never|number|object|string|symbol|unknown)\b/,
      'operator': /\.[.]{2}|=>|\+\+|--|\*\*|[-+*/%]=?|[!=]=?=?|&&?|\|\|?|[?^%]|~(?!=)/
    });
    Prism.languages.ts = Prism.languages.typescript;
  }
}
