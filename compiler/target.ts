
import { Quadruple, SymbolTable, PCodeF, Instruction, SymbolEntry } from '../types';

export class TargetCodeGenerator {
  public instructions: Instruction[] = [];
  private rootTable: SymbolTable;
  private labelMap: Record<string, number> = {};
  private procMap: Record<string, SymbolEntry> = {};

  constructor(symbolTable: SymbolTable) {
    this.rootTable = symbolTable;
    this.buildProcMap(this.rootTable);
  }

  private buildProcMap(table: SymbolTable) {
    for (const e of table.entries) {
      if (e.kind === 'procedure') {
        this.procMap[e.name] = e;
      }
    }
    for (const c of table.children) {
      this.buildProcMap(c);
    }
  }

  private findSymbol(name: string, scopeName: string): { entry: SymbolEntry, levelDiff: number } | null {
    const stack = this.getScopeStack(this.rootTable, scopeName);
    if (!stack) return null;

    for (let i = stack.length - 1; i >= 0; i--) {
      const table = stack[i];
      const entry = table.entries.find(e => e.name === name);
      if (entry) {
        return { entry, levelDiff: (stack.length - 1) - i };
      }
    }
    return null;
  }

  private getScopeStack(table: SymbolTable, targetName: string, path: SymbolTable[] = []): SymbolTable[] | null {
    const currentPath = [...path, table];
    if (table.name === targetName) return currentPath;
    for (const c of table.children) {
      const res = this.getScopeStack(c, targetName, currentPath);
      if (res) return res;
    }
    return null;
  }

  public generate(tac: Quadruple[]) {
    this.instructions = [];
    this.labelMap = {};
    
    let currentProc = "Global";

    // Pass 1: Generate code with symbolic labels
    for (const quad of tac) {
      // Record label position
      if (quad.op === 'LABEL') {
        this.labelMap[quad.result] = this.instructions.length;
        
        if (quad.result.startsWith('proc_')) {
          const procName = quad.result.replace('proc_', '');
          currentProc = procName === 'main' ? 'Global' : procName;
          
          // Emit INT for frame allocation
          let size = 3; 
          if(currentProc === 'Global') {
             size = this.rootTable.varOffset; 
          } else {
             const pEntry = this.procMap[currentProc];
             if(pEntry) size = pEntry.size;
          }
          this.emit(PCodeF.INT, 0, size);
        }
        continue;
      }

      switch (quad.op) {
        case 'GOTO':
        case 'JMP':
          this.emit(PCodeF.JMP, 0, quad.result || quad.arg1);
          break;
        case 'JZ':
          this.genOperand(quad.arg1, currentProc);
          this.emit(PCodeF.JPC, 0, quad.result);
          break;
        case 'CALL':
          // 1. Emit CAL
          const procName = quad.arg1.replace('proc_', '');
          const targetSym = this.findSymbol(procName, currentProc);
          
          let levelDiff = 0;
          if (targetSym) {
             levelDiff = targetSym.levelDiff;
          }
          
          this.emit(PCodeF.CAL, levelDiff, quad.arg1); 

          // 2. Caller cleanup (Pop arguments)
          const nargs = parseInt(quad.arg2 || '0');
          if (nargs > 0) {
            this.emit(PCodeF.INT, 0, -nargs);
          }
          break;
        case 'RET':
        case 'END':
          this.emit(PCodeF.OPR, 0, 0);
          break;
        case 'PARAM':
          this.genOperand(quad.arg1, currentProc);
          break;
        case 'READ':
          this.emit(PCodeF.OPR, 0, 16);
          break;
        case 'WRITE':
          this.genOperand(quad.arg1, currentProc);
          this.emit(PCodeF.WRT, 0, 0);
          break;
        case ':=':
          this.genOperand(quad.arg1, currentProc);
          const dest = this.findSymbol(quad.result, currentProc);
          if (dest) {
            this.emit(PCodeF.STO, dest.levelDiff, Number(dest.entry.addr));
          }
          break;
        
        // --- Arithmetic & Logic ---
        case '+': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 2); 
          break;
        case '-': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 3); 
          break;
        case '*': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 4); 
          break;
        case '/': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 5); 
          break;
        case 'ODD': 
          this.genOperand(quad.arg1, currentProc);
          this.emit(PCodeF.OPR, 0, 6); 
          break;
        case '=': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 8); 
          break;
        case '<>': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 9); 
          break;
        case '<': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 10); 
          break;
        case '>=': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 11); 
          break;
        case '>': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 12); 
          break;
        case '<=': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 13); 
          break;
      }
    }

    // Pass 2: Resolve Labels
    for (const inst of this.instructions) {
      if (typeof inst.a === 'string') {
        if (inst.a in this.labelMap) {
          inst.a = this.labelMap[inst.a];
        } else {
          inst.a = 0; // Fallback
        }
      }
    }
  }
  
  private emit(f: PCodeF, l: number, a: number | string) {
      this.instructions.push({ f, l, a });
  }

  private genOperand(arg: string, currentProc: string) {
      if(!arg) return;
      
      // If it's a number (LIT)
      if(!isNaN(Number(arg))) {
          this.emit(PCodeF.LIT, 0, Number(arg));
          return;
      } 
      
      // If it's a variable or constant (LOD or LIT)
      const sym = this.findSymbol(arg, currentProc);
      if(sym) {
          if (sym.entry.kind === 'constant') {
             this.emit(PCodeF.LIT, 0, Number(sym.entry.valLevel));
          } else {
             this.emit(PCodeF.LOD, sym.levelDiff, Number(sym.entry.addr));
          }
          return;
      }

      // If it's a Temp (T1, T2...), we assume it is already on the Stack Top.
      // If it's not a Temp and not in Symbol Table, it's likely an error or a label.
  }
}
