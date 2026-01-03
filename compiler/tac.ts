
import { SymbolTable, ProgramNode, BlockNode, StatementNode, ExpNode, AssignNode, CallNode, BeginEndNode, IfNode, WhileNode, ReadNode, WriteNode, BinOpNode, OddNode, NumNode, VarNode, Quadruple } from '../types';

export const TRANSLATION_SCHEME_DEF = `/* PL/0 语法制导翻译模式 (Syntax-Directed Translation Scheme) */
/* 符号说明: 
   .place - 存放变量或临时变量的名称
   .code  - 节点生成的代码序列
   newTemp() - 生成新的临时变量 (T1, T2...)
   newLabel() - 生成新的标号 (L1, L2...)
   emit(op, arg1, arg2, result) - 生成四元式
*/

Program -> Block
    { emit('GOTO', 'proc_main', _, _); }
    { Block.code }  // 生成所有过程声明和主程序体的代码
    { emit('LABEL', _, _, 'proc_main'); }
    { BlockBody.code }
    { emit('END', _, _, _); }

Statement -> id := Expression
    { E.place = Expression.place; }
    { emit(':=', E.place, _, id.name); }

Statement -> if Condition then Statement1
    { L_exit = newLabel(); }
    { emit('JZ', Condition.place, _, L_exit); }
    { Statement1.code }
    { emit('LABEL', _, _, L_exit); }

Statement -> while Condition do Statement1
    { L_begin = newLabel(); }
    { L_exit = newLabel(); }
    { emit('LABEL', _, _, L_begin); }
    { emit('JZ', Condition.place, _, L_exit); }
    { Statement1.code }
    { emit('JMP', _, _, L_begin); }
    { emit('LABEL', _, _, L_exit); }

Statement -> call id
    { emit('CALL', 'proc_' + id.name, _, _); }

Statement -> read ( IdList )
    { for id in IdList: 
        T = newTemp();
        emit('READ', _, _, T);
        emit(':=', T, _, id.name); 
    }

Statement -> write ( ExprList )
    { for expr in ExprList: 
        emit('WRITE', expr.place, _, _); 
    }

Statement -> begin StmtList end
    { for s in StmtList: s.code }

Expression -> Term { (+|-) Term }
    { E.place = Term1.place; }
    { for each op in sequence: 
        T_new = newTemp();
        emit(op, E.place, Term_next.place, T_new);
        E.place = T_new; 
    }

Condition -> odd Expression
    { C.place = newTemp(); }
    { emit('ODD', Expression.place, _, C.place); }

Condition -> Expr1 RelOp Expr2
    { C.place = newTemp(); }
    { emit(RelOp, Expr1.place, Expr2.place, C.place); }
`;

/**
 * 语义分析与中间代码生成器
 * 采用语法制导翻译 (Syntax-Directed Translation) 模式
 */
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

  // S -> id := E
  // S.code = E.code || gen(:=, E.place, _, id.place)
  public generate(ast: ProgramNode) {
    this.code = [];
    const mainLabel = "proc_main";
    
    // SDT: Program -> Block
    this.emit("GOTO", mainLabel, "", "");
    
    // Generate code for procedure declarations first (to keep layout clean)
    this.translateBlockProcs(ast.block);

    // Main program entry
    this.emit("LABEL", "", "", mainLabel);
    this.translateBlockBody(ast.block);
    this.emit("END", "", "", "");
  }

  // Block -> ConstDecl VarDecl ProcDecl Statement
  private translateBlockProcs(node: BlockNode) {
    for (const proc of node.procs) {
      // ProcDecl -> procedure id ; Block ;
      const procLabel = `proc_${proc.name}`;
      this.procLabels[proc.name] = procLabel;
      
      const skipLabel = this.newLabel();
      this.emit("JMP", "", "", skipLabel); // Skip procedure body during sequential flow
      
      this.emit("LABEL", "", "", procLabel);
      
      // Enter Scope
      const prevTable = this.currentTable;
      const childTable = this.currentTable.children.find(t => t.name === proc.name);
      if (childTable) this.currentTable = childTable;

      // Recursive translation
      this.translateBlockProcs(proc.block); 
      this.translateBlockBody(proc.block);  
      
      // Semantic Action: Return from procedure
      this.emit("RET", "", "", "");

      // Exit Scope
      this.currentTable = prevTable;
      
      this.emit("LABEL", "", "", skipLabel);
    }
  }

  private translateBlockBody(node: BlockNode) {
    this.translateStatement(node.statement);
  }

  private translateStatement(stmt: StatementNode) {
    if (stmt instanceof AssignNode) {
      // Production: Statement -> id := Expression
      // Semantic Action: 
      //   E.place = translateExpression(Expr)
      //   emit(':=', E.place, _, id.name)
      const ePlace = this.translateExpression(stmt.expr);
      this.emit(":=", ePlace, "", stmt.varName);

    } else if (stmt instanceof BeginEndNode) {
      // Production: Statement -> begin StmtList end
      for (const s of stmt.statements) {
        this.translateStatement(s);
      }

    } else if (stmt instanceof IfNode) {
      // Production: Statement -> if Condition then Statement
      // Scheme:
      //   cond.place = translateExpression(Condition)
      //   emit('JZ', cond.place, _, L_exit)
      //   translateStatement(Statement)
      //   L_exit:
      const condPlace = this.translateExpression(stmt.condition);
      const labelExit = this.newLabel();
      this.emit("JZ", condPlace, "", labelExit);
      this.translateStatement(stmt.thenStmt);
      this.emit("LABEL", "", "", labelExit);

    } else if (stmt instanceof WhileNode) {
      // Production: Statement -> while Condition do Statement
      // Scheme:
      //   L_begin:
      //   cond.place = translateExpression(Condition)
      //   emit('JZ', cond.place, _, L_exit)
      //   translateStatement(Statement)
      //   emit('JMP', _, _, L_begin)
      //   L_exit:
      const labelBegin = this.newLabel();
      const labelExit = this.newLabel();
      this.emit("LABEL", "", "", labelBegin);
      const condPlace = this.translateExpression(stmt.condition);
      this.emit("JZ", condPlace, "", labelExit);
      this.translateStatement(stmt.doStmt);
      this.emit("JMP", "", "", labelBegin);
      this.emit("LABEL", "", "", labelExit);

    } else if (stmt instanceof CallNode) {
        // Production: Statement -> call id
        // Semantic Action: emit('CALL', proc_id, _, _)
        const procLabel = this.procLabels[stmt.procName] || `proc_${stmt.procName}`;
        this.emit("CALL", procLabel, "", "");

    } else if (stmt instanceof ReadNode) {
        // Production: Statement -> read(idList)
        for(const v of stmt.vars) {
            const t = this.newTemp();
            this.emit("READ", "", "", t);
            this.emit(":=", t, "", v);
        }

    } else if (stmt instanceof WriteNode) {
        // Production: Statement -> write(exprList)
        for(const e of stmt.exprs) {
            const t = this.translateExpression(e);
            this.emit("WRITE", t, "", "");
        }
    }
  }

  // Expression -> Term { + Term }
  // Returns: E.place (the name of the temporary variable holding the result)
  private translateExpression(node: ExpNode): string {
    if (node instanceof NumNode) {
      // Production: Factor -> num
      // Action: T = newTemp(); emit(':=', num.val, _, T); return T
      const t = this.newTemp();
      this.emit(":=", node.value.toString(), "", t);
      return t;

    } else if (node instanceof VarNode) {
        // Production: Factor -> id
        // Action: T = newTemp(); emit(':=', id.name, _, T); return T
        const t = this.newTemp();
        this.emit(":=", node.name, "", t);
        return t;

    } else if (node instanceof BinOpNode) {
      // Production: E -> E1 op E2
      // Action: 
      //   T1 = translate(E1)
      //   T2 = translate(E2)
      //   T = newTemp()
      //   emit(op, T1, T2, T)
      //   return T
      const t1 = this.translateExpression(node.left);
      const t2 = this.translateExpression(node.right);
      const t = this.newTemp();
      this.emit(node.op, t1, t2, t);
      return t;

    } else if (node instanceof OddNode) {
      // Production: Condition -> odd E
      const t1 = this.translateExpression(node.expr);
      const t = this.newTemp();
      this.emit("ODD", t1, "", t);
      return t;
    }
    return "";
  }
}
