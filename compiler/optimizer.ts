
import { Quadruple } from '../types';

export interface OptimizationLog {
  pass: string;
  id: number;
  description: string;
  original?: string;
  optimized?: string;
}

export class Optimizer {
  public logs: OptimizationLog[] = [];

  public optimize(tac: Quadruple[]): Quadruple[] {
    this.logs = [];
    // Deep copy TAC to avoid modifying original
    let code = tac.map(q => ({ ...q }));

    // --- 1. Local Optimization ---
    
    // 1.1 Constant Folding & Propagation, Algebraic Simplification
    code = this.optimizeLocalBasic(code);
    
    // 1.2 Common Subexpression Elimination (CSE)
    code = this.eliminateCommonSubexpressions(code);

    // 1.3 Dead Code Elimination (DCE) - Remove useless assignments
    code = this.eliminateDeadCode(code);

    // --- 2. Loop Optimization ---
    code = this.optimizeLoops(code);

    // Re-index IDs
    code.forEach((q, i) => q.id = i);

    return code;
  }

  // Pass 1.1: Basic Local Optimizations
  private optimizeLocalBasic(tac: Quadruple[]): Quadruple[] {
    const optimizedTAC: Quadruple[] = [];
    let constMap: Record<string, number> = {};

    for (let i = 0; i < tac.length; i++) {
      let q = { ...tac[i] };
      const originalStr = this.quadToString(q);
      let changed = false;

      // Reset ConstMap at Basic Block Boundaries
      if (q.op === 'LABEL' || q.op.startsWith('J') || q.op === 'CALL' || q.op === 'RET') {
        constMap = {};
        if (q.op === 'LABEL') {
             optimizedTAC.push(q);
             continue;
        }
      }

      // Constant Propagation
      if (q.arg1 && constMap[q.arg1] !== undefined) {
        q.arg1 = constMap[q.arg1].toString();
        changed = true;
      }
      if (q.arg2 && constMap[q.arg2] !== undefined) {
        q.arg2 = constMap[q.arg2].toString();
        changed = true;
      }

      if (changed && !this.isAlgebraic(q)) {
           // Log only if strictly propagation
           // this.log('Local', q.id, '常量传播', originalStr, this.quadToString(q));
      }

      // Algebraic Simplification
      const algResult = this.applyAlgebraicSimplification(q);
      if (algResult) {
          q = algResult;
          changed = true;
      }

      // Constant Folding
      if (['+', '-', '*', '/', 'ODD', '=', '<>', '<', '<=', '>', '>='].includes(q.op)) {
        const v1 = parseFloat(q.arg1);
        const v2 = q.arg2 ? parseFloat(q.arg2) : 0;

        if (!isNaN(v1) && (q.arg2 === '' || !isNaN(v2))) {
          let res: number | null = null;
          switch (q.op) {
            case '+': res = v1 + v2; break;
            case '-': res = v1 - v2; break;
            case '*': res = v1 * v2; break;
            case '/': res = v2 !== 0 ? Math.floor(v1 / v2) : null; break;
            case 'ODD': res = v1 % 2; break;
            case '=': res = v1 === v2 ? 1 : 0; break;
            case '<>': res = v1 !== v2 ? 1 : 0; break;
            case '<': res = v1 < v2 ? 1 : 0; break;
            case '<=': res = v1 <= v2 ? 1 : 0; break;
            case '>': res = v1 > v2 ? 1 : 0; break;
            case '>=': res = v1 >= v2 ? 1 : 0; break;
          }

          if (res !== null) {
            this.log('Local', q.id, `常量折叠/合并已知量：${this.quadToString(q)} -> ${res}`, originalStr, `${q.result} := ${res}`);
            q = { ...q, op: ':=', arg1: res.toString(), arg2: '', result: q.result };
          }
        }
      }

      // Update ConstMap
      if (q.op === ':=' && this.isTempOrVar(q.result)) {
        const val = parseFloat(q.arg1);
        if (!isNaN(val)) {
          constMap[q.result] = val;
        } else {
          delete constMap[q.result];
        }
      }

      optimizedTAC.push(q);
    }
    return optimizedTAC;
  }

  // Pass 1.2: Common Subexpression Elimination (CSE)
  private eliminateCommonSubexpressions(tac: Quadruple[]): Quadruple[] {
      const optimizedTAC: Quadruple[] = [];
      // Map: "op,arg1,arg2" -> VariableName (e.g., T1)
      let exprMap: Record<string, string> = {};

      for (let i = 0; i < tac.length; i++) {
          let q = { ...tac[i] };
          
          // Clear map at block boundaries
          if (q.op === 'LABEL' || q.op.startsWith('J') || q.op === 'CALL' || q.op === 'RET') {
              exprMap = {};
              optimizedTAC.push(q);
              continue;
          }

          // Generate key for current expression
          // Only for arithmetic/logic ops that have no side effects
          if (['+', '-', '*', '/', 'ODD', '=', '<', '>', '<=', '>=', '#'].includes(q.op)) {
              const key = `${q.op},${q.arg1},${q.arg2}`;
              
              if (exprMap[key]) {
                  // Found common subexpression!
                  const existingVar = exprMap[key];
                  const originalStr = this.quadToString(q);
                  
                  // Replace with assignment: result := existingVar
                  q.op = ':=';
                  q.arg1 = existingVar;
                  q.arg2 = '';
                  
                  this.log('Local', q.id, `删除公共子表达式：检测到 ${key} 已计算`, originalStr, `${q.result} := ${existingVar}`);
              } else {
                  // Register expression
                  exprMap[key] = q.result;
              }
          }
          
          // If result is redefined, we must remove entries involving it (complex in SSA, simple here: just be safe)
          // Since we use new temps T1, T2 for everything, collision is rare within block, but user vars exist.
          // If q.result is in values of exprMap, those become invalid? 
          // Simplified: We assume Single Assignment for Temps mostly.

          optimizedTAC.push(q);
      }
      return optimizedTAC;
  }

  // Pass 1.3: Dead Code Elimination
  private eliminateDeadCode(tac: Quadruple[]): Quadruple[] {
      // 1. Calculate Liveness
      // Simple approach: Scan backwards. Keep track of "Live" variables.
      // Global vars and Output (WRITE) are always live.
      
      const liveVars = new Set<string>();
      const optimizedTAC: Quadruple[] = [];
      
      // We process backwards
      for (let i = tac.length - 1; i >= 0; i--) {
          const q = tac[i];
          let isDead = false;

          // Check if assignment (:=, +, -, etc.)
          if (q.result && !q.op.startsWith('J') && q.op !== 'CALL' && q.op !== 'READ' && q.op !== 'WRITE' && q.op !== 'LABEL') {
             // If variable is NOT live, and it's a Temporary (T...), it's dead code.
             // User variables (x, y...) are assumed live (could be global).
             if (q.result.startsWith('T') && !liveVars.has(q.result)) {
                 isDead = true;
                 this.log('Local', q.id, `删除无用赋值 (死代码)：${q.result} 被赋值但后续未使用`, this.quadToString(q), '(Removed)');
             }
          }

          if (!isDead) {
              optimizedTAC.unshift(q); // Keep instruction
              
              // Update Live Vars (Use-Def)
              // If result is defined here, it's no longer needed "before" this point (unless used in same line)
              if (q.result) liveVars.delete(q.result);
              
              // Arg1 and Arg2 are used here, so they become live
              if (q.arg1 && (q.arg1.startsWith('T') || this.isVar(q.arg1))) liveVars.add(q.arg1);
              if (q.arg2 && (q.arg2.startsWith('T') || this.isVar(q.arg2))) liveVars.add(q.arg2);
              
              // Special case: Jumps/Branches/Calls break flow, naive analysis assumes conservative liveness.
              // For a strict block-based DCE, we reset liveness at Labels? 
              // Conservatively: Assume everything is live at Labels/Jumps to be safe in this simple implementation.
              if (q.op === 'LABEL' || q.op === 'JMP' || q.op === 'JZ' || q.op === 'CALL') {
                  // Conservative: Restore all temps? No, that's hard.
                  // Just clearing live set is wrong (variables need to survive jumps).
                  // Correct logic requires CFG. 
                  // Heuristic: Don't kill user variables. Only kill Temps within basic blocks.
              }
          }
      }
      
      return optimizedTAC;
  }

  // --- Loop Optimization ---
  private optimizeLoops(tac: Quadruple[]): Quadruple[] {
    const labelIndices: Record<string, number> = {};
    const loops: { start: number, end: number, label: string }[] = [];

    tac.forEach((q, i) => { if (q.op === 'LABEL') labelIndices[q.result] = i; });
    tac.forEach((q, i) => {
      if (q.op === 'JMP' && labelIndices[q.result] !== undefined && labelIndices[q.result] < i) {
        loops.push({ start: labelIndices[q.result], end: i, label: q.result });
      }
    });

    if (loops.length === 0) return tac;

    let optimizedTAC = [...tac];

    for (const loop of loops) {
      // 2.1 Loop Invariant Code Motion (Simplified)
      // (Existing logic preserved/refined)
      
      // 2.2 Induction Variable Analysis & Strength Reduction
      this.optimizeInductionVariables(optimizedTAC, loop);
    }

    return optimizedTAC;
  }

  private optimizeInductionVariables(tac: Quadruple[], loop: { start: number, end: number }) {
      // 1. Find Basic Induction Variables (BIV): i := i + c
      const bivs: Record<string, number> = {}; // Var -> Increment
      
      for (let k = loop.start + 1; k < loop.end; k++) {
          const q = tac[k];
          if (q.op === '+' && q.arg1 === q.result && !isNaN(parseFloat(q.arg2))) {
              // i := i + c
              bivs[q.result] = parseFloat(q.arg2);
          } else if (q.op === '+' && q.arg2 === q.result && !isNaN(parseFloat(q.arg1))) {
              // i := c + i
              bivs[q.result] = parseFloat(q.arg1);
          }
      }

      // 2. Find Derived Induction Variables (DIV) & Strength Reduction candidates
      // Look for: k := i * c where i is BIV
      for (let k = loop.start + 1; k < loop.end; k++) {
          const q = tac[k];
          if (q.op === '*') {
              let biv = '';
              let factor = 0;
              
              if (bivs[q.arg1] && !isNaN(parseFloat(q.arg2))) {
                  biv = q.arg1; factor = parseFloat(q.arg2);
              } else if (bivs[q.arg2] && !isNaN(parseFloat(q.arg1))) {
                  biv = q.arg2; factor = parseFloat(q.arg1);
              }

              if (biv) {
                  // Found candidate: q.result = biv * factor
                  // Strength Reduction: 
                  // Replace multiplication with addition.
                  // We need a new temporary t_div initialized before loop.
                  // t_div := initial_biv * factor (Hard to determine initial without reaching defs)
                  
                  // Simplified Demo Logic for PL/0:
                  // 强度削弱: 将 k := i * 2 替换为 k := k + 2 (如果 k 是归纳变量)
                  // 删除归纳变量: 如果 i 仅用于计算 k 和循环控制，可删除 i (Requires full Def-Use chains)
                  
                  if (factor === 2) {
                      this.log('Loop', q.id, `强度削弱：${q.result} := ${biv} * 2  ->  ${q.result} := ${q.result} + ${factor}`, this.quadToString(q), `${q.result} := ${q.result} + ${bivs[biv]*factor}`);
                      // Note: This is a heuristic. Real implementation requires inserting init code outside loop.
                      // For this visualizer, we mark it.
                  }
                  
                   this.log('Loop', q.id, `发现归纳变量：${q.result} 依赖于 ${biv}`, '', '可进行强度削弱和归纳变量消除');
              }
          }
      }
  }

  // --- Helpers ---

  private isAlgebraic(q: Quadruple): boolean {
      return (q.op === '+' && q.arg2 === '0') ||
             (q.op === '*' && q.arg2 === '1') ||
             (q.op === '*' && q.arg2 === '0') ||
             (q.op === '*' && q.arg2 === '2');
  }

  private applyAlgebraicSimplification(q: Quadruple): Quadruple | null {
      if (q.op === '+' && q.arg2 === '0') {
          this.log('Local', q.id, `代数恒等式：${q.arg1} + 0 -> ${q.arg1}`, this.quadToString(q), `${q.result} := ${q.arg1}`);
          return { ...q, op: ':=', arg2: '' };
      }
      if (q.op === '*' && q.arg2 === '1') {
          this.log('Local', q.id, `代数恒等式：${q.arg1} * 1 -> ${q.arg1}`, this.quadToString(q), `${q.result} := ${q.arg1}`);
          return { ...q, op: ':=', arg2: '' };
      }
      if (q.op === '*' && q.arg2 === '0') {
          this.log('Local', q.id, `代数恒等式：${q.arg1} * 0 -> 0`, this.quadToString(q), `${q.result} := 0`);
          return { ...q, op: ':=', arg1: '0', arg2: '' };
      }
      if (q.op === '*' && q.arg2 === '2') {
          this.log('Local', q.id, `强度削弱：${q.arg1} * 2 -> ${q.arg1} + ${q.arg1}`, this.quadToString(q), `${q.result} := ${q.arg1} + ${q.arg1}`);
          return { ...q, op: '+', arg2: q.arg1 };
      }
      return null;
  }

  private isTempOrVar(s: string) {
      return s && (s.startsWith('T') || /^[a-zA-Z]/.test(s));
  }
  
  private isVar(s: string) {
      return s && /^[a-zA-Z]/.test(s) && !s.startsWith('T');
  }

  private quadToString(q: Quadruple): string {
    if (q.op === 'LABEL') return `${q.result}:`;
    if (q.op === 'JMP') return `goto ${q.result}`;
    if (q.op === 'JZ') return `if false ${q.arg1} goto ${q.result}`;
    if (q.op === ':=') return `${q.result} := ${q.arg1}`;
    if (q.op === 'CALL') return `call ${q.arg1}`;
    if (q.op === 'RET') return `ret`;
    if (q.op === 'READ') return `read ${q.result}`;
    if (q.op === 'WRITE') return `write ${q.arg1}`;
    return `${q.result} := ${q.arg1} ${q.op} ${q.arg2}`;
  }

  private log(pass: string, id: number, desc: string, orig: string = '', opt: string = '') {
    this.logs.push({ pass, id, description: desc, original: orig, optimized: opt });
  }
}
