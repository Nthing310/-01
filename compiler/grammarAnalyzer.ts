
export interface Production {
  lhs: string;
  rhs: string[];
}

export interface GrammarAnalysis {
  grammarStr: string;
  terminals: Set<string>;
  nonTerminals: Set<string>;
  first: Record<string, Set<string>>;
  follow: Record<string, Set<string>>;
  table: Record<string, Record<string, string[]>>; // NonTerminal -> Terminal -> Production RHS[]
}

// Define PL/0 Grammar (Adapted for LL(1))
// Non-terminals start with Uppercase. Terminals are lowercase or symbols.
// 'ε' represents epsilon.
const PL0_GRAMMAR = `
Program -> program id ; Block .
Block -> ConstDecl VarDecl ProcDecl Body
ConstDecl -> const id := num ConstTail ; | ε
ConstTail -> , id := num ConstTail | ε
VarDecl -> var id VarTail ; | ε
VarTail -> , id VarTail | ε
ProcDecl -> procedure id ( Params ) ; Block ; ProcDecl | ε
Params -> id ParamTail | ε
ParamTail -> , id ParamTail | ε
Body -> begin Statement StmtTail end
StmtTail -> ; Statement StmtTail | ε
Statement -> id := Expression
Statement -> if Lexp then Statement ElsePart
Statement -> while Lexp do Statement
Statement -> call id CallArgs
Statement -> read ( id ReadTail )
Statement -> write ( Expression WriteTail )
Statement -> Body
ElsePart -> else Statement | ε
CallArgs -> ( Expression ExprsTail ) | ε
ExprsTail -> , Expression ExprsTail | ε
ReadTail -> , id ReadTail | ε
WriteTail -> , Expression WriteTail | ε
Lexp -> odd Expression | Expression RelOp Expression
RelOp -> = | <> | < | <= | > | >=
Expression -> Sign Term ExprRest
Sign -> + | - | ε
ExprRest -> AddOp Term ExprRest | ε
AddOp -> + | -
Term -> Factor TermRest
TermRest -> MulOp Factor TermRest | ε
MulOp -> * | /
Factor -> id | num | ( Expression )
`;

export class GrammarAnalyzer {
  private productions: Production[] = [];
  private nonTerminals: Set<string> = new Set();
  private terminals: Set<string> = new Set();
  private first: Record<string, Set<string>> = {};
  private follow: Record<string, Set<string>> = {};
  private table: Record<string, Record<string, string[]>> = {};

  constructor() {
    this.parseGrammar(PL0_GRAMMAR);
    this.computeFirst();
    this.computeFollow();
    this.buildTable();
  }

  public getAnalysis(): GrammarAnalysis {
    return {
      grammarStr: PL0_GRAMMAR,
      terminals: this.terminals,
      nonTerminals: this.nonTerminals,
      first: this.first,
      follow: this.follow,
      table: this.table
    };
  }

  private parseGrammar(str: string) {
    const lines = str.trim().split('\n');
    lines.forEach(line => {
      const [lhs, rhsStr] = line.split('->').map(s => s.trim());
      const alternatives = rhsStr.split('|').map(s => s.trim());
      
      this.nonTerminals.add(lhs);
      
      alternatives.forEach(alt => {
        const rhs = alt.split(/\s+/).filter(s => s.length > 0);
        this.productions.push({ lhs, rhs });
        
        rhs.forEach(sym => {
          // Identify terminals: not starting with Uppercase, and not ε
          if (sym !== 'ε' && !/^[A-Z]/.test(sym.charAt(0))) {
                this.terminals.add(sym);
          }
        });
      });
    });
    
    // Safety check: ensure all symbols in RHS that are not LHS are terminals
    this.productions.forEach(p => {
        p.rhs.forEach(sym => {
            if (sym !== 'ε' && !this.nonTerminals.has(sym)) {
                this.terminals.add(sym);
            }
        });
    });
  }

  private computeFirst() {
    this.nonTerminals.forEach(nt => this.first[nt] = new Set());
    
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of this.productions) {
        const { lhs, rhs } = p;
        const countBefore = this.first[lhs].size;
        
        let allDeriveEpsilon = true;
        for (const sym of rhs) {
          if (sym === 'ε') continue;
          
          if (this.terminals.has(sym)) {
            this.first[lhs].add(sym);
            allDeriveEpsilon = false;
            break;
          } else if (this.nonTerminals.has(sym)) {
            const symFirst = this.first[sym];
            for (const f of symFirst) {
              if (f !== 'ε') this.first[lhs].add(f);
            }
            if (!symFirst.has('ε')) {
              allDeriveEpsilon = false;
              break;
            }
          }
        }
        
        if (allDeriveEpsilon || (rhs.length === 1 && rhs[0] === 'ε')) {
          this.first[lhs].add('ε');
        }

        if (this.first[lhs].size !== countBefore) changed = true;
      }
    }
  }

  private computeFollow() {
    this.nonTerminals.forEach(nt => this.follow[nt] = new Set());
    // Assume first non-terminal defined is start symbol? 
    // In PL/0 map, 'Program' is the start.
    if(this.nonTerminals.has('Program')) {
        this.follow['Program'].add('$');
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const p of this.productions) {
        const { lhs, rhs } = p;
        
        for (let i = 0; i < rhs.length; i++) {
          const sym = rhs[i];
          if (!this.nonTerminals.has(sym)) continue;

          const countBefore = this.follow[sym].size;
          
          let betaDerivesEpsilon = true;
          for (let j = i + 1; j < rhs.length; j++) {
            const nextSym = rhs[j];
            if (nextSym === 'ε') continue;
            
            if (this.terminals.has(nextSym)) {
              this.follow[sym].add(nextSym);
              betaDerivesEpsilon = false;
              break;
            } else if (this.nonTerminals.has(nextSym)) {
              const nextFirst = this.first[nextSym];
              nextFirst.forEach(f => {
                if (f !== 'ε') this.follow[sym].add(f);
              });
              if (!nextFirst.has('ε')) {
                betaDerivesEpsilon = false;
                break;
              }
            }
          }

          if (betaDerivesEpsilon) {
            this.follow[lhs].forEach(f => this.follow[sym].add(f));
          }

          if (this.follow[sym].size !== countBefore) changed = true;
        }
      }
    }
  }

  private buildTable() {
    this.nonTerminals.forEach(nt => {
      this.table[nt] = {};
      this.terminals.forEach(t => this.table[nt][t] = []);
      this.table[nt]['$'] = [];
    });

    for (const p of this.productions) {
      const { lhs, rhs } = p;
      
      const firstRhs = new Set<string>();
      let allDeriveEpsilon = true;
      for (const sym of rhs) {
        if (sym === 'ε') continue;
        if (this.terminals.has(sym)) {
          firstRhs.add(sym);
          allDeriveEpsilon = false;
          break;
        } else if (this.nonTerminals.has(sym)) {
          const f = this.first[sym];
          f.forEach(x => { if(x !== 'ε') firstRhs.add(x); });
          if (!f.has('ε')) {
            allDeriveEpsilon = false;
            break;
          }
        }
      }
      if (allDeriveEpsilon || (rhs.length === 1 && rhs[0] === 'ε')) {
        firstRhs.add('ε');
      }

      firstRhs.forEach(a => {
        if (a !== 'ε') {
            if (!this.table[lhs][a]) this.table[lhs][a] = [];
            const prodString = rhs.join(' ');
            if (!this.table[lhs][a].includes(prodString)) {
                this.table[lhs][a].push(prodString);
            }
        }
      });

      if (firstRhs.has('ε')) {
        this.follow[lhs].forEach(b => {
             if (!this.table[lhs][b]) this.table[lhs][b] = [];
             const prodString = rhs.join(' ');
             if (!this.table[lhs][b].includes(prodString)) {
                this.table[lhs][b].push(prodString);
             }
        });
      }
    }
  }
}
