
import { Quadruple, SymbolTable, PCodeF, Instruction, SymbolEntry } from '../types';

export class TargetCodeGenerator {
  public instructions: Instruction[] = [];
  private rootTable: SymbolTable;
  public labelMap: Record<string, number> = {}; 
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
          // Allocate extra space for temporaries (T1, T2...) to avoid overwriting next frame.
          // Increased safety buffer to 100 to prevent collisions in deep recursions or large expressions.
          this.emit(PCodeF.INT, 0, size + 100); 
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
          this.emit(PCodeF.OPR, 0, 16); // Pushes input to stack
          this.genStore(quad.result, currentProc); // Store stack top to result
          break;
        case 'WRITE':
          this.genOperand(quad.arg1, currentProc);
          this.emit(PCodeF.WRT, 0, 0);
          break;
        case ':=':
          this.genOperand(quad.arg1, currentProc);
          this.genStore(quad.result, currentProc);
          break;
        
        // --- Arithmetic & Logic ---
        // For all these, we must STORE the result of OPR back to the TAC result variable.
        case '+': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 2); 
          this.genStore(quad.result, currentProc);
          break;
        case '-': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 3); 
          this.genStore(quad.result, currentProc);
          break;
        case '*': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 4); 
          this.genStore(quad.result, currentProc);
          break;
        case '/': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 5); 
          this.genStore(quad.result, currentProc);
          break;
        case 'ODD': 
          this.genOperand(quad.arg1, currentProc);
          this.emit(PCodeF.OPR, 0, 6); 
          this.genStore(quad.result, currentProc);
          break;
        case '=': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 8); 
          this.genStore(quad.result, currentProc);
          break;
        case '<>': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 9); 
          this.genStore(quad.result, currentProc);
          break;
        case '<': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 10); 
          this.genStore(quad.result, currentProc);
          break;
        case '>=': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 11); 
          this.genStore(quad.result, currentProc);
          break;
        case '>': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 12); 
          this.genStore(quad.result, currentProc);
          break;
        case '<=': 
          this.genOperand(quad.arg1, currentProc);
          this.genOperand(quad.arg2, currentProc);
          this.emit(PCodeF.OPR, 0, 13); 
          this.genStore(quad.result, currentProc);
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

  private genStore(target: string, currentProc: string) {
      if (!target) return;
      const dest = this.findSymbol(target, currentProc);
      if (dest) {
        this.emit(PCodeF.STO, dest.levelDiff, Number(dest.entry.addr));
      } else if (target.startsWith('T')) {
         // Handle Temp stores. Offset 20 + ID to stay above locals but (hopefully) below next frame
         const tempId = parseInt(target.substring(1));
         this.emit(PCodeF.STO, 0, 20 + tempId);
      }
  }

  private genOperand(arg: string, currentProc: string) {
      if(!arg) return;
      
      // If it's a number (LIT)
      if (!isNaN(parseFloat(arg))) {
          this.emit(PCodeF.LIT, 0, parseFloat(arg));
          return;
      }

      // If it is a temporary (T1, T2...)
      if (arg.startsWith('T')) {
          const tempId = parseInt(arg.substring(1));
          // Use same mapping strategy as in STO: Offset 20 + ID
          this.emit(PCodeF.LOD, 0, 20 + tempId);
          return;
      }

      // If it's a variable or constant
      const sym = this.findSymbol(arg, currentProc);
      if (sym) {
          if (sym.entry.kind === 'constant') {
              this.emit(PCodeF.LIT, 0, Number(sym.entry.valLevel));
          } else if (sym.entry.kind === 'variable') {
              this.emit(PCodeF.LOD, sym.levelDiff, Number(sym.entry.addr));
          }
      }
  }
}
