
import { SymbolTable, SymbolEntry, ProgramNode, BlockNode, ConstDeclNode, VarDeclNode, ProcNode, BodyNode, StatementNode, IfNode, WhileNode } from '../types';

export class SymbolTableGenerator {
  public rootTable: SymbolTable | null = null;
  private currentTable: SymbolTable | null = null;
  private currentLevel: number = 0;

  public generate(ast: ProgramNode): SymbolTable {
    this.rootTable = new SymbolTable("Global", 0);
    this.currentTable = this.rootTable;
    this.currentLevel = 0;
    
    this.genBlock(ast.block);
    return this.rootTable;
  }

  private genBlock(node: BlockNode) {
    if (node.constDecl) {
      for (const c of node.constDecl.consts) {
        this.currentTable!.add_symbol(new SymbolEntry(c.name, 'constant', c.value, '', 1));
      }
    }
    if (node.varDecl) {
      for (const v of node.varDecl.vars) {
        const addr = this.currentTable!.varOffset;
        this.currentTable!.varOffset++;
        this.currentTable!.add_symbol(new SymbolEntry(v, 'variable', this.currentLevel, addr, 1));
      }
    }
    
    for (const proc of node.procs) {
      // Procedure entry in current table
      const procEntry = new SymbolEntry(proc.name, 'procedure', this.currentLevel, '', 0, proc.params.length);
      this.currentTable!.add_symbol(procEntry);

      // Enter new scope
      const childTable = new SymbolTable(proc.name, this.currentLevel + 1);
      this.currentTable!.children.push(childTable);
      
      const parentTable = this.currentTable;
      this.currentTable = childTable;
      this.currentLevel++;

      // Parameters are passed on stack by caller.
      // If params are p1, p2... pn. Stack is [..., p1, p2, ..., pn, SL, DL, RA].
      // pn is at -1, pn-1 at -2... p1 at -n.
      const numParams = proc.params.length;
      for (let i = 0; i < numParams; i++) {
        // Offset relative to new base b
        const offset = -(numParams - i);
        // Note: We use valLevel to store level, addr for offset
        this.currentTable.add_symbol(new SymbolEntry(proc.params[i], 'variable', this.currentLevel, offset, 1));
      }

      this.genBlock(proc.block);

      // Backfill size (used for INT instruction)
      // Size = header (3) + local vars (varOffset - 3)
      // Actually varOffset counts total used stack space from b.
      procEntry.size = this.currentTable.varOffset; 

      // Exit scope
      this.currentTable = parentTable;
      this.currentLevel--;
    }

    if (node.body) {
      // Body analysis assumed valid
    }
  }
}
