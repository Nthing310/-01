import { Token, TokenType } from '../types';

const KEYWORDS: Record<string, TokenType> = {
  'program': TokenType.PROGRAM,
  'const': TokenType.CONST,
  'var': TokenType.VAR,
  'procedure': TokenType.PROCEDURE,
  'begin': TokenType.BEGIN,
  'end': TokenType.END,
  'odd': TokenType.ODD,
  'if': TokenType.IF,
  'then': TokenType.THEN,
  'else': TokenType.ELSE,
  'while': TokenType.WHILE,
  'do': TokenType.DO,
  'call': TokenType.CALL,
  'read': TokenType.READ,
  'write': TokenType.WRITE
};

const SYMBOLS: Record<string, TokenType> = {
  '+': TokenType.PLUS,
  '-': TokenType.MINUS,
  '*': TokenType.TIMES,
  '/': TokenType.SLASH,
  '(': TokenType.LPAREN,
  ')': TokenType.RPAREN,
  ',': TokenType.COMMA,
  ';': TokenType.SEMICOLON,
  '.': TokenType.PERIOD,
  '=': TokenType.EQL,
  '<>': TokenType.NEQ,
  '<': TokenType.LSS,
  '<=': TokenType.LEQ,
  '>': TokenType.GTR,
  '>=': TokenType.GEQ,
  ':=': TokenType.BECOMES
};

export class Lexer {
  private src: string;
  private pos: number = 0;
  private line: number = 1;

  constructor(src: string) {
    this.src = src;
  }

  private peek(): string {
    return this.pos < this.src.length ? this.src[this.pos] : '';
  }

  private advance(): string {
    const ch = this.src[this.pos++];
    if (ch === '\n') this.line++;
    return ch;
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.src.length) {
      const ch = this.peek();

      if (/\s/.test(ch)) {
        this.advance();
      } else if (/[a-zA-Z]/.test(ch)) {
        let ident = '';
        while (/[a-zA-Z0-9]/.test(this.peek())) {
          ident += this.advance();
        }
        const lower = ident.toLowerCase();
        if (lower in KEYWORDS) {
          tokens.push({ sym: KEYWORDS[lower], lexeme: lower, value: 0, line: this.line });
        } else {
          tokens.push({ sym: TokenType.IDENT, lexeme: ident, value: 0, line: this.line });
        }
      } else if (/[0-9]/.test(ch)) {
        let numStr = '';
        while (/[0-9]/.test(this.peek())) {
          numStr += this.advance();
        }
        tokens.push({ sym: TokenType.NUMBER, lexeme: numStr, value: parseInt(numStr, 10), line: this.line });
      } else if (ch === ':') {
        this.advance();
        if (this.peek() === '=') {
          this.advance();
          tokens.push({ sym: TokenType.BECOMES, lexeme: ':=', value: 0, line: this.line });
        } else {
          throw new Error(`Lexical Error at line ${this.line}: Expected '=' after ':'`);
        }
      } else if (ch === '<') {
        this.advance();
        if (this.peek() === '=') {
          this.advance();
          tokens.push({ sym: TokenType.LEQ, lexeme: '<=', value: 0, line: this.line });
        } else if (this.peek() === '>') {
          this.advance();
          tokens.push({ sym: TokenType.NEQ, lexeme: '<>', value: 0, line: this.line });
        } else {
          tokens.push({ sym: TokenType.LSS, lexeme: '<', value: 0, line: this.line });
        }
      } else if (ch === '>') {
        this.advance();
        if (this.peek() === '=') {
          this.advance();
          tokens.push({ sym: TokenType.GEQ, lexeme: '>=', value: 0, line: this.line });
        } else {
          tokens.push({ sym: TokenType.GTR, lexeme: '>', value: 0, line: this.line });
        }
      } else {
        // Single char symbols
        if (ch in SYMBOLS) {
          this.advance();
          tokens.push({ sym: SYMBOLS[ch], lexeme: ch, value: 0, line: this.line });
        } else {
          throw new Error(`Lexical Error at line ${this.line}: Unknown character '${ch}'`);
        }
      }
    }
    return tokens;
  }
}