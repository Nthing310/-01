import { Token, TokenType, ProgramNode, BlockNode, ConstDeclNode, VarDeclNode, ProcNode, BodyNode, StatementNode, AssignNode, CallNode, IfNode, WhileNode, ReadNode, WriteNode, ExpNode, OddNode, BinOpNode, NumNode, VarNode, ParenNode } from '../types';

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
    throw new Error(`Syntax Error at line ${t?.line || 'end'}: Expected ${TokenType[type]} but found ${t ? TokenType[t.sym] : 'EOF'}`);
  }

  public parse(): ProgramNode {
    this.match(TokenType.PROGRAM);
    const id = this.match(TokenType.IDENT);
    this.match(TokenType.SEMICOLON);
    const block = this.parseBlock();
    this.match(TokenType.PERIOD);
    return new ProgramNode(id.lexeme, block);
  }

  private parseBlock(): BlockNode {
    let constDecl: ConstDeclNode | null = null;
    if (this.peek()?.sym === TokenType.CONST) {
      constDecl = this.parseConstDecl();
    }

    let varDecl: VarDeclNode | null = null;
    if (this.peek()?.sym === TokenType.VAR) {
      varDecl = this.parseVarDecl();
    }

    const procs: ProcNode[] = [];
    while (this.peek()?.sym === TokenType.PROCEDURE) {
      procs.push(this.parseProc());
    }

    const body = this.parseBody();
    return new BlockNode(constDecl, varDecl, procs, body);
  }

  private parseConstDecl(): ConstDeclNode {
    this.match(TokenType.CONST);
    const consts: { name: string, value: number }[] = [];
    do {
      const id = this.match(TokenType.IDENT);
      this.match(TokenType.BECOMES); // The PDF says := for const decl, standard Pascal is = but we follow PDF
      const num = this.match(TokenType.NUMBER);
      consts.push({ name: id.lexeme, value: num.value });
      if (this.peek()?.sym === TokenType.COMMA) {
        this.match(TokenType.COMMA);
      } else {
        break;
      }
    } while (true);
    this.match(TokenType.SEMICOLON); // PDF spec says semi after const block
    return new ConstDeclNode(consts);
  }

  private parseVarDecl(): VarDeclNode {
    this.match(TokenType.VAR);
    const vars: string[] = [];
    do {
      const id = this.match(TokenType.IDENT);
      vars.push(id.lexeme);
      if (this.peek()?.sym === TokenType.COMMA) {
        this.match(TokenType.COMMA);
      } else {
        break;
      }
    } while (true);
    
    if (this.peek()?.sym === TokenType.SEMICOLON) {
      this.match(TokenType.SEMICOLON);
    }
    return new VarDeclNode(vars);
  }

  private parseProc(): ProcNode {
    this.match(TokenType.PROCEDURE);
    const id = this.match(TokenType.IDENT);
    this.match(TokenType.LPAREN);
    const params: string[] = [];
    if (this.peek()?.sym === TokenType.IDENT) {
      do {
        params.push(this.match(TokenType.IDENT).lexeme);
        if (this.peek()?.sym === TokenType.COMMA) {
          this.match(TokenType.COMMA);
        } else {
          break;
        }
      } while (true);
    }
    this.match(TokenType.RPAREN);
    this.match(TokenType.SEMICOLON);
    const block = this.parseBlock();
    this.match(TokenType.SEMICOLON);
    return new ProcNode(id.lexeme, params, block);
  }

  private parseBody(): BodyNode {
    this.match(TokenType.BEGIN);
    const stmts: StatementNode[] = [];
    stmts.push(this.parseStatement());
    while (this.peek()?.sym === TokenType.SEMICOLON) {
      this.match(TokenType.SEMICOLON);
      // PDF Error handling: "not allowed last statement semi" logic is optional but good.
      if (this.peek()?.sym !== TokenType.END) {
        stmts.push(this.parseStatement());
      }
    }
    this.match(TokenType.END);
    return new BodyNode(stmts);
  }

  private parseStatement(): StatementNode {
    const sym = this.peek()?.sym;
    if (sym === TokenType.IDENT) {
      const id = this.match(TokenType.IDENT);
      this.match(TokenType.BECOMES);
      const expr = this.parseExpression();
      return new AssignNode(id.lexeme, expr);
    } else if (sym === TokenType.IF) {
      this.match(TokenType.IF);
      const lexp = this.parseLExp();
      this.match(TokenType.THEN);
      const thenStmt = this.parseStatement();
      let elseStmt: StatementNode | null = null;
      if (this.peek()?.sym === TokenType.ELSE) {
        this.match(TokenType.ELSE);
        elseStmt = this.parseStatement();
      }
      return new IfNode(lexp, thenStmt, elseStmt);
    } else if (sym === TokenType.WHILE) {
      this.match(TokenType.WHILE);
      const lexp = this.parseLExp();
      this.match(TokenType.DO);
      const stmt = this.parseStatement();
      return new WhileNode(lexp, stmt);
    } else if (sym === TokenType.CALL) {
      this.match(TokenType.CALL);
      const id = this.match(TokenType.IDENT);
      const args: ExpNode[] = [];
      if (this.peek()?.sym === TokenType.LPAREN) {
        this.match(TokenType.LPAREN);
        if (this.peek()?.sym !== TokenType.RPAREN) {
          do {
            args.push(this.parseExpression());
            if (this.peek()?.sym === TokenType.COMMA) {
              this.match(TokenType.COMMA);
            } else {
              break;
            }
          } while (true);
        }
        this.match(TokenType.RPAREN);
      }
      return new CallNode(id.lexeme, args);
    } else if (sym === TokenType.BEGIN) {
      return this.parseBody();
    } else if (sym === TokenType.READ) {
      this.match(TokenType.READ);
      this.match(TokenType.LPAREN);
      const vars: string[] = [];
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
    } else if (sym === TokenType.WRITE) {
      this.match(TokenType.WRITE);
      this.match(TokenType.LPAREN);
      const exprs: ExpNode[] = [];
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
      // Empty statement or error. PL/0 usually assumes a statement.
      // To prevent infinite loops on error, let's consume or error.
      // But Body parser handles empty between semi-colons? No.
      throw new Error(`Syntax Error at line ${this.peek()?.line}: Unexpected token ${TokenType[sym!]}`);
    }
  }

  private parseLExp(): ExpNode {
    if (this.peek()?.sym === TokenType.ODD) {
      this.match(TokenType.ODD);
      const expr = this.parseExpression();
      return new OddNode(expr);
    }
    const left = this.parseExpression();
    const sym = this.peek()?.sym;
    if (sym === TokenType.EQL || sym === TokenType.NEQ || sym === TokenType.LSS || 
        sym === TokenType.LEQ || sym === TokenType.GTR || sym === TokenType.GEQ) {
      const op = this.match(sym!).lexeme;
      const right = this.parseExpression();
      return new BinOpNode(op, left, right);
    }
    throw new Error(`Syntax Error: Expected relational operator in lexp`);
  }

  private parseExpression(): ExpNode {
    let sign = '';
    if (this.peek()?.sym === TokenType.PLUS || this.peek()?.sym === TokenType.MINUS) {
      sign = this.match(this.peek()!.sym).lexeme;
    }
    let node = this.parseTerm();
    if (sign === '-') {
      node = new BinOpNode('-', new NumNode(0), node);
    }

    while (this.peek()?.sym === TokenType.PLUS || this.peek()?.sym === TokenType.MINUS) {
      const op = this.match(this.peek()!.sym).lexeme;
      const right = this.parseTerm();
      node = new BinOpNode(op, node, right);
    }
    return node;
  }

  private parseTerm(): ExpNode {
    let node = this.parseFactor();
    while (this.peek()?.sym === TokenType.TIMES || this.peek()?.sym === TokenType.SLASH) {
      const op = this.match(this.peek()!.sym).lexeme;
      const right = this.parseFactor();
      node = new BinOpNode(op, node, right);
    }
    return node;
  }

  private parseFactor(): ExpNode {
    const sym = this.peek()?.sym;
    if (sym === TokenType.IDENT) {
      return new VarNode(this.match(TokenType.IDENT).lexeme);
    } else if (sym === TokenType.NUMBER) {
      return new NumNode(this.match(TokenType.NUMBER).value);
    } else if (sym === TokenType.LPAREN) {
      this.match(TokenType.LPAREN);
      const expr = this.parseExpression();
      this.match(TokenType.RPAREN);
      return new ParenNode(expr);
    }
    throw new Error(`Syntax Error: Unexpected factor ${TokenType[sym!]}`);
  }
}