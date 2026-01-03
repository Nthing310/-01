
import { Token, TokenType, ProgramNode, BlockNode, ConstDeclNode, VarDeclNode, ProcNode, StatementNode, AssignNode, CallNode, BeginEndNode, IfNode, WhileNode, ReadNode, WriteNode, ExpNode, OddNode, BinOpNode, NumNode, VarNode } from '../types';

export class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private match(type: TokenType): Token {
    const t = this.peek();
    if (t && t.sym === type) {
      this.pos++;
      return t;
    }
    throw new Error(`Syntax Error at line ${t?.line}: Expected ${TokenType[type]} but found ${t ? TokenType[t.sym] : 'EOF'}`);
  }

  public parse(): ProgramNode {
    const block = this.parseBlock();
    this.match(TokenType.PERIOD);
    return new ProgramNode(block);
  }

  private parseBlock(): BlockNode {
    let constDecl: ConstDeclNode | null = null;
    if (this.peek()?.sym === TokenType.CONST) {
      this.match(TokenType.CONST);
      const consts = [];
      do {
        const id = this.match(TokenType.IDENT).lexeme;
        this.match(TokenType.EQL);
        const val = this.match(TokenType.NUMBER).value;
        consts.push({ name: id, value: val });
        if (this.peek()?.sym === TokenType.COMMA) {
          this.match(TokenType.COMMA);
        } else {
          break;
        }
      } while (true);
      this.match(TokenType.SEMICOLON);
      constDecl = new ConstDeclNode(consts);
    }

    let varDecl: VarDeclNode | null = null;
    if (this.peek()?.sym === TokenType.VAR) {
      this.match(TokenType.VAR);
      const vars = [];
      do {
        vars.push(this.match(TokenType.IDENT).lexeme);
        if (this.peek()?.sym === TokenType.COMMA) {
          this.match(TokenType.COMMA);
        } else {
          break;
        }
      } while (true);
      this.match(TokenType.SEMICOLON);
      varDecl = new VarDeclNode(vars);
    }

    const procs: ProcNode[] = [];
    while (this.peek()?.sym === TokenType.PROCEDURE) {
      this.match(TokenType.PROCEDURE);
      const name = this.match(TokenType.IDENT).lexeme;
      this.match(TokenType.SEMICOLON);
      const block = this.parseBlock();
      this.match(TokenType.SEMICOLON);
      procs.push(new ProcNode(name, block));
    }

    const stmt = this.parseStatement();
    return new BlockNode(constDecl, varDecl, procs, stmt);
  }

  private parseStatement(): StatementNode {
    const t = this.peek();
    if (t?.sym === TokenType.IDENT) {
      const name = this.match(TokenType.IDENT).lexeme;
      this.match(TokenType.BECOMES);
      const expr = this.parseExpression();
      return new AssignNode(name, expr);
    } else if (t?.sym === TokenType.CALL) {
      this.match(TokenType.CALL);
      const name = this.match(TokenType.IDENT).lexeme;
      return new CallNode(name);
    } else if (t?.sym === TokenType.BEGIN) {
      this.match(TokenType.BEGIN);
      const stmts = [];
      stmts.push(this.parseStatement());
      while (this.peek()?.sym === TokenType.SEMICOLON) {
        this.match(TokenType.SEMICOLON);
        stmts.push(this.parseStatement());
      }
      this.match(TokenType.END);
      return new BeginEndNode(stmts);
    } else if (t?.sym === TokenType.IF) {
      this.match(TokenType.IF);
      const cond = this.parseCondition();
      this.match(TokenType.THEN);
      const thenStmt = this.parseStatement();
      return new IfNode(cond, thenStmt);
    } else if (t?.sym === TokenType.WHILE) {
      this.match(TokenType.WHILE);
      const cond = this.parseCondition();
      this.match(TokenType.DO);
      const doStmt = this.parseStatement();
      return new WhileNode(cond, doStmt);
    } else if (t?.sym === TokenType.READ) {
      this.match(TokenType.READ);
      this.match(TokenType.LPAREN);
      const vars = [];
      do {
        vars.push(this.match(TokenType.IDENT).lexeme);
        if (this.peek()?.sym === TokenType.COMMA) {
          this.match(TokenType.COMMA);
        } else {
          break;
        }
      } while (true);
      this.match(TokenType.RPAREN);
      return new ReadNode(vars);
    } else if (t?.sym === TokenType.WRITE) {
      this.match(TokenType.WRITE);
      this.match(TokenType.LPAREN);
      const exprs = [];
      do {
        exprs.push(this.parseExpression());
        if (this.peek()?.sym === TokenType.COMMA) {
          this.match(TokenType.COMMA);
        } else {
          break;
        }
      } while (true);
      this.match(TokenType.RPAREN);
      return new WriteNode(exprs);
    } else {
      // Empty statement
      return new BeginEndNode([]);
    }
  }

  private parseCondition(): ExpNode {
    if (this.peek()?.sym === TokenType.ODD) {
      this.match(TokenType.ODD);
      const expr = this.parseExpression();
      return new OddNode(expr);
    } else {
      const left = this.parseExpression();
      const opToken = this.peek();
      if (opToken && [TokenType.EQL, TokenType.NEQ, TokenType.LSS, TokenType.LEQ, TokenType.GTR, TokenType.GEQ].includes(opToken.sym)) {
        this.match(opToken.sym);
        const right = this.parseExpression();
        let op = opToken.lexeme;
        if(opToken.sym === TokenType.NEQ) op = '<>'; // Normalize # to <> if used
        return new BinOpNode(op, left, right);
      }
      throw new Error("Expected relational operator");
    }
  }

  private parseExpression(): ExpNode {
    let sign = '';
    if (this.peek()?.sym === TokenType.PLUS || this.peek()?.sym === TokenType.MINUS) {
      sign = this.match(this.peek()!.sym).lexeme;
    }
    let term = this.parseTerm();
    if (sign === '-') {
      term = new BinOpNode('-', new NumNode(0), term);
    }

    while (this.peek()?.sym === TokenType.PLUS || this.peek()?.sym === TokenType.MINUS) {
      const op = this.match(this.peek()!.sym).lexeme;
      const right = this.parseTerm();
      term = new BinOpNode(op, term, right);
    }
    return term;
  }

  private parseTerm(): ExpNode {
    let factor = this.parseFactor();
    while (this.peek()?.sym === TokenType.TIMES || this.peek()?.sym === TokenType.SLASH) {
      const op = this.match(this.peek()!.sym).lexeme;
      const right = this.parseFactor();
      factor = new BinOpNode(op, factor, right);
    }
    return factor;
  }

  private parseFactor(): ExpNode {
    const t = this.peek();
    if (t?.sym === TokenType.IDENT) {
      return new VarNode(this.match(TokenType.IDENT).lexeme);
    } else if (t?.sym === TokenType.NUMBER) {
      return new NumNode(this.match(TokenType.NUMBER).value);
    } else if (t?.sym === TokenType.LPAREN) {
      this.match(TokenType.LPAREN);
      const expr = this.parseExpression();
      this.match(TokenType.RPAREN);
      return expr;
    }
    throw new Error("Expected factor");
  }
}
