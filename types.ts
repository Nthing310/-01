
// --- Lexer Types ---
export enum TokenType {
  NULL, IDENT, NUMBER,
  PLUS, MINUS, TIMES, SLASH,
  EQL, NEQ, LSS, LEQ, GTR, GEQ, BECOMES,
  LPAREN, RPAREN, COMMA, SEMICOLON, PERIOD,
  PROGRAM, CONST, VAR, PROCEDURE, BEGIN, END, ODD,
  IF, THEN, ELSE, WHILE, DO,
  CALL, READ, WRITE
}

export interface Token {
  sym: TokenType;
  lexeme: string;
  value: number;
  line: number;
}

// --- AST Types ---
export type ASTNode = 
  | ProgramNode | BlockNode | ConstDeclNode | VarDeclNode 
  | ProcNode | BodyNode | StatementNode | ExpNode;

export class ProgramNode {
  constructor(public name: string, public block: BlockNode) {}
}

export class BlockNode {
  constructor(
    public constDecl: ConstDeclNode | null,
    public varDecl: VarDeclNode | null,
    public procs: ProcNode[],
    public body: BodyNode
  ) {}
}

export class ConstDeclNode {
  constructor(public consts: { name: string; value: number }[]) {}
}

export class VarDeclNode {
  constructor(public vars: string[]) {}
}

export class ProcNode {
  constructor(public name: string, public params: string[], public block: BlockNode) {}
}

export class BodyNode {
  constructor(public statements: StatementNode[]) {}
}

export type StatementNode = 
  | AssignNode | IfNode | WhileNode | CallNode | ReadNode | WriteNode | BodyNode;

export class AssignNode {
  constructor(public varName: string, public expr: ExpNode) {}
}

export class IfNode {
  constructor(public lexp: ExpNode, public thenStmt: StatementNode, public elseStmt: StatementNode | null) {}
}

export class WhileNode {
  constructor(public lexp: ExpNode, public bodyStmt: StatementNode) {}
}

export class CallNode {
  constructor(public procName: string, public args: ExpNode[]) {}
}

export class ReadNode {
  constructor(public vars: string[]) {}
}

export class WriteNode {
  constructor(public exprs: ExpNode[]) {}
}

export type ExpNode = BinOpNode | OddNode | NumNode | VarNode | ParenNode;

export class BinOpNode {
  constructor(public op: string, public left: ExpNode, public right: ExpNode) {}
}

export class OddNode {
  constructor(public expr: ExpNode) {}
}

export class NumNode {
  constructor(public value: number) {}
}

export class VarNode {
  constructor(public name: string) {}
}

export class ParenNode {
  constructor(public expr: ExpNode) {}
}

// --- Symbol Table Types ---
export class SymbolEntry {
  constructor(
    public name: string,
    public kind: 'constant' | 'variable' | 'procedure',
    public valLevel: number, // value for const, level for others
    public addr: number | string, // offset for var, address/label for proc
    public size: number,
    public numParams: number = 0
  ) {}
}

export class SymbolTable {
  public entries: SymbolEntry[] = [];
  public children: SymbolTable[] = [];
  public varOffset: number = 3; // Start after SL, DL, RA

  constructor(public name: string, public level: number = 0) {}

  public add_symbol(entry: SymbolEntry) {
    this.entries.push(entry);
  }
}

// --- TAC Types ---
export interface Quadruple {
  op: string;
  arg1: string;
  arg2: string;
  result: string;
  id: number;
}

// --- P-Code Types ---
export enum PCodeF {
  LIT = 'LIT', OPR = 'OPR', LOD = 'LOD', STO = 'STO',
  CAL = 'CAL', INT = 'INT', JMP = 'JMP', JPC = 'JPC',
  RED = 'RED', WRT = 'WRT'
}

export interface Instruction {
  f: PCodeF;
  l: number;
  a: number | string; // Allow string for label resolution phase
}
