
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
  table: Record<string, Record<string, string[]>>; // M[NonTerminal, Terminal] = RHS[]
}

const PL0_GRAMMAR = `
Program -> Block .
Block -> ConstDecl VarDecl ProcDecl Statement
ConstDecl -> const ConstList ; | ε
ConstList -> id = num ConstTail
ConstTail -> , id = num ConstTail | ε
VarDecl -> var VarList ; | ε
VarList -> id VarTail
VarTail -> , id VarTail | ε
ProcDecl -> procedure id ; Block ; ProcDecl | ε
Statement -> id := Expression
Statement -> call id
Statement -> begin StmtList end
Statement -> if Condition then Statement
Statement -> while Condition do Statement
Statement -> read ( IdList )
Statement -> write ( ExprList )
Statement -> ε
StmtList -> Statement StmtTail
StmtTail -> ; Statement StmtTail | ε
Condition -> odd Expression | Expression RelOp Expression
RelOp -> = | # | < | <= | > | >=
Expression -> Term AddOpTerm
AddOpTerm -> + Term AddOpTerm | - Term AddOpTerm | ε
Term -> Factor MulOpFactor
MulOpFactor -> * Factor MulOpFactor | / Factor MulOpFactor | ε
Factor -> id | num | ( Expression )
IdList -> id IdListTail
IdListTail -> , id IdListTail | ε
ExprList -> Expression ExprListTail
ExprListTail -> , Expression ExprListTail | ε
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
    this.computeTable();
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
          if (sym !== 'ε' && !/^[A-Z]/.test(sym.charAt(0)) && sym !== '.') {
                this.terminals.add(sym);
          }
        });
      });
    });
    
    // Ensure '.' (end of program) is in terminals
    this.terminals.add('.');
    
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
    if(this.nonTerminals.has('Program')) {
        this.follow['Program'].add('$'); // $ represents EOF
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

  private computeTable() {
    // Initialize table
    this.nonTerminals.forEach(nt => {
      this.table[nt] = {};
    });

    for (const p of this.productions) {
      const { lhs, rhs } = p;
      
      // Calculate First(rhs)
      const firstRhs = new Set<string>();
      let allDeriveEpsilon = true;
      
      for (const sym of rhs) {
        if (sym === 'ε') continue;
        if (this.terminals.has(sym)) {
          firstRhs.add(sym);
          allDeriveEpsilon = false;
          break;
        } else if (this.nonTerminals.has(sym)) {
           this.first[sym].forEach(f => {
             if (f !== 'ε') firstRhs.add(f);
           });
           if (!this.first[sym].has('ε')) {
             allDeriveEpsilon = false;
             break;
           }
        }
      }
      if (allDeriveEpsilon) firstRhs.add('ε');

      // Rule 1: For each terminal a in First(rhs), add A->rhs to M[A,a]
      firstRhs.forEach(a => {
        if (a !== 'ε') {
          this.table[lhs][a] = rhs;
        }
      });

      // Rule 2: If ε in First(rhs), for each terminal b in Follow(A), add A->rhs to M[A,b]
      if (firstRhs.has('ε') || (rhs.length === 1 && rhs[0] === 'ε')) {
        this.follow[lhs].forEach(b => {
          this.table[lhs][b] = rhs;
        });
      }
    }
  }
}
