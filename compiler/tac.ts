
import { SymbolTable, ProgramNode, BlockNode, StatementNode, ExpNode, AssignNode, IfNode, WhileNode, CallNode, ReadNode, WriteNode, BinOpNode, OddNode, NumNode, VarNode, ParenNode, Quadruple } from '../types';

export class TACGenerator {
  public code: Quadruple[] = [];
  private tempCount: number = 0;
  private labelCount: number = 0;
  private currentTable: SymbolTable;
  private procLabels: Record<string, string> = {};

  constructor(symbolTable: SymbolTable) {
    this.currentTable = symbolTable;
  }

  private newTemp(): string {
    return `T${++this.tempCount}`;
  }

  private newLabel(): string {
    return `L${++this.labelCount}`;
  }

  private emit(op: string, arg1: string, arg2: string, result: string) {
    this.code.push({ id: this.code.length, op, arg1, arg2, result });
  }

  public generate(ast: ProgramNode) {
    this.code = [];
    const mainLabel = "proc_main";
    this.emit("GOTO", mainLabel, "", "");
    
    // Generate procs recursively
    this.genBlockProcs(ast.block);

    // Main body
    this.emit("LABEL", "", "", mainLabel);
    this.genBlockBody(ast.block);
    this.emit("END", "", "", "");
  }

  private genBlockProcs(node: BlockNode) {
    for (const proc of node.procs) {
      const procLabel = `proc_${proc.name}`;
      this.procLabels[proc.name] = procLabel;
      
      const skipLabel = this.newLabel();
      this.emit("JMP", "", "", skipLabel); // Skip procedure def during linear flow
      
      this.emit("LABEL", "", "", procLabel);
      
      const prevTable = this.currentTable;
      const childTable = this.currentTable.children.find(t => t.name === proc.name);
      if (childTable) this.currentTable = childTable;

      this.genBlockProcs(proc.block); // Nested procs
      this.genBlockBody(proc.block);  // Body of proc
      this.emit("RET", proc.name, "", "");

      this.currentTable = prevTable;
      
      this.emit("LABEL", "", "", skipLabel);
    }
  }

  private genBlockBody(node: BlockNode) {
    if (node.body) {
      for (const stmt of node.body.statements) {
        this.genStatement(stmt);
      }
    }
  }

  private genStatement(stmt: StatementNode) {
    if (stmt instanceof AssignNode) {
      const t = this.genExp(stmt.expr);
      this.emit(":=", t, "", stmt.varName);
    } else if (stmt instanceof IfNode) {
      const cond = this.genExp(stmt.lexp);
      const labelElse = this.newLabel();
      const labelEnd = this.newLabel();
      this.emit("JZ", cond, "", labelElse);
      this.genStatement(stmt.thenStmt);
      this.emit("JMP", "", "", labelEnd);
      this.emit("LABEL", "", "", labelElse);
      if (stmt.elseStmt) {
        this.genStatement(stmt.elseStmt);
      }
      this.emit("LABEL", "", "", labelEnd);
    } else if (stmt instanceof WhileNode) {
      const labelBegin = this.newLabel();
      const labelEnd = this.newLabel();
      this.emit("LABEL", "", "", labelBegin);
      const cond = this.genExp(stmt.lexp);
      this.emit("JZ", cond, "", labelEnd);
      this.genStatement(stmt.bodyStmt);
      this.emit("JMP", "", "", labelBegin);
      this.emit("LABEL", "", "", labelEnd);
    } else if (stmt instanceof CallNode) {
        // Param passing
        for(const arg of stmt.args) {
            const t = this.genExp(arg);
            this.emit("PARAM", t, "", "");
        }
        const procLabel = this.procLabels[stmt.procName] || `proc_${stmt.procName}`;
        const nargs = stmt.args.length.toString();
        const ret = this.newTemp();
        this.emit("CALL", procLabel, nargs, ret);
    } else if (stmt instanceof ReadNode) {
        for(const v of stmt.vars) {
            const t = this.newTemp();
            this.emit("READ", "", "", t);
            this.emit(":=", t, "", v);
        }
    } else if (stmt instanceof WriteNode) {
        for(const e of stmt.exprs) {
            const t = this.genExp(e);
            this.emit("WRITE", t, "", "");
        }
    } else if (stmt instanceof Object) {
        // BodyNode handling
        if ('statements' in stmt) {
             for(const s of (stmt as any).statements) {
                 this.genStatement(s);
             }
        }
    }
  }

  private genExp(node: ExpNode): string {
    if (node instanceof NumNode) {
      const t = this.newTemp();
      this.emit(":=", node.value.toString(), "", t);
      return t;
    } else if (node instanceof VarNode) {
        const entry = this.lookup(node.name);
        if (entry && entry.kind === 'constant') {
            const t = this.newTemp();
            this.emit(":=", entry.valLevel.toString(), "", t);
            return t;
        }
        // Force load to temp to maintain stack order in binary ops (e.g. Var < Num)
        const t = this.newTemp();
        this.emit(":=", node.name, "", t);
        return t;
    } else if (node instanceof BinOpNode) {
      const t1 = this.genExp(node.left);
      const t2 = this.genExp(node.right);
      const t = this.newTemp();
      this.emit(node.op, t1, t2, t);
      return t;
    } else if (node instanceof OddNode) {
      const t1 = this.genExp(node.expr);
      const t = this.newTemp();
      this.emit("ODD", t1, "", t);
      return t;
    } else if (node instanceof ParenNode) {
      return this.genExp(node.expr);
    }
    return "";
  }

  private lookup(name: string) {
      let t: SymbolTable | undefined = this.currentTable;
      while(t) { 
          const found = t.entries.find(e => e.name === name);
          if(found) return found;
          // Simple lookup traversing might need parent pointers for full correctness
          // if we had deep nesting accessing globals, but for PL/0 demos this is often sufficient.
          break; 
      }
      return null;
  }
}
