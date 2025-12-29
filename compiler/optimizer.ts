
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

    // 1. Local Optimization (Constant Folding, Propagation, Algebraic, Strength Reduction)
    code = this.optimizeLocal(code);

    // 2. Loop Optimization (Invariant Code Motion)
    code = this.optimizeLoops(code);

    // Re-index IDs after moving/changing code
    code.forEach((q, i) => q.id = i);

    return code;
  }

  private optimizeLocal(tac: Quadruple[]): Quadruple[] {
    const optimizedTAC: Quadruple[] = [];
    // Map to track constant values of temporaries within a basic block
    let constMap: Record<string, number> = {};

    for (let i = 0; i < tac.length; i++) {
      let q = { ...tac[i] };
      const originalStr = this.quadToString(q);
      let changed = false;

      // Reset ConstMap at Basic Block Boundaries (Labels or after Jumps)
      if (q.op === 'LABEL' || q.op.startsWith('J') || q.op === 'CALL' || q.op === 'RET') {
        constMap = {};
        // Note: We don't clear on CALL for T-vars because T-vars are local expression temps, 
        // but to be safe against side-effects if we tracked user vars, we would clear. 
        // Here we only track T-vars.
        if (q.op === 'LABEL') {
             optimizedTAC.push(q);
             continue;
        }
      }

      // 1. Constant Propagation
      let propagationHappened = false;
      if (q.arg1 && constMap[q.arg1] !== undefined) {
        q.arg1 = constMap[q.arg1].toString();
        changed = true;
        propagationHappened = true;
      }
      if (q.arg2 && constMap[q.arg2] !== undefined) {
        q.arg2 = constMap[q.arg2].toString();
        changed = true;
        propagationHappened = true;
      }

      if (propagationHappened) {
          this.log('Local', q.id, `常量传播：将变量替换为已知值`, originalStr, this.quadToString(q));
      }

      // 2. Algebraic Simplification & Strength Reduction
      // Capture state before algebraic to log correct transformation if propagation already happened
      const preAlgStr = this.quadToString(q); 
      
      if (q.op === '+' && (q.arg2 === '0')) { // x + 0 = x
        this.log('Local', q.id, `代数恒等式：${q.arg1} + 0 -> ${q.arg1}`, preAlgStr);
        q = { ...q, op: ':=', arg2: '', result: q.result }; 
        changed = true;
      } else if (q.op === '*' && q.arg2 === '1') { // x * 1 = x
        this.log('Local', q.id, `代数恒等式：${q.arg1} * 1 -> ${q.arg1}`, preAlgStr);
        q = { ...q, op: ':=', arg2: '', result: q.result };
        changed = true;
      } else if (q.op === '*' && q.arg2 === '0') { // x * 0 = 0
        this.log('Local', q.id, `代数恒等式：${q.arg1} * 0 -> 0`, preAlgStr);
        q = { ...q, op: ':=', arg1: '0', arg2: '', result: q.result };
        changed = true;
      } else if (q.op === '*' && q.arg2 === '2') { // x * 2 -> x + x (Strength Reduction)
        this.log('Local', q.id, `强度削减：${q.arg1} * 2 -> ${q.arg1} + ${q.arg1}`, preAlgStr);
        q = { ...q, op: '+', arg2: q.arg1 };
        changed = true;
      }

      // 3. Constant Folding
      // Check if op is arithmetic and both args are numbers
      const preFoldStr = this.quadToString(q);
      if (['+', '-', '*', '/', 'ODD', '=', '<>', '<', '<=', '>', '>='].includes(q.op)) {
        const v1 = parseFloat(q.arg1);
        const v2 = q.arg2 ? parseFloat(q.arg2) : 0; // Odd only uses arg1

        if (!isNaN(v1) && (q.arg2 === '' || !isNaN(v2))) {
          let res: number | null = null;
          switch (q.op) {
            case '+': res = v1 + v2; break;
            case '-': res = v1 - v2; break;
            case '*': res = v1 * v2; break;
            case '/': res = v2 !== 0 ? Math.floor(v1 / v2) : null; break;
            case 'ODD': res = v1 % 2; break;
            // Relational ops return 1 or 0
            case '=': res = v1 === v2 ? 1 : 0; break;
            case '<>': res = v1 !== v2 ? 1 : 0; break;
            case '<': res = v1 < v2 ? 1 : 0; break;
            case '<=': res = v1 <= v2 ? 1 : 0; break;
            case '>': res = v1 > v2 ? 1 : 0; break;
            case '>=': res = v1 >= v2 ? 1 : 0; break;
          }

          if (res !== null) {
            this.log('Local', q.id, `常量折叠：计算结果 ${res}`, preFoldStr, `:= ${res} -> ${q.result}`);
            q = { ...q, op: ':=', arg1: res.toString(), arg2: '', result: q.result };
            changed = true;
          }
        }
      }

      // Update ConstMap if it's an assignment to a Temporary
      if (q.op === ':=' && q.result.startsWith('T')) {
        const val = parseFloat(q.arg1);
        if (!isNaN(val)) {
          constMap[q.result] = val;
        } else {
          // If assigned a variable, we stop tracking this Temp as constant
          delete constMap[q.result];
        }
      }

      optimizedTAC.push(q);
    }
    return optimizedTAC;
  }

  private optimizeLoops(tac: Quadruple[]): Quadruple[] {
    // 1. Identify Loops
    // Look for backward jumps: JMP L_target where L_target is defined previously.
    const labelIndices: Record<string, number> = {};
    const loops: { start: number, end: number, label: string }[] = [];

    // Map labels to indices in the current TAC
    tac.forEach((q, i) => {
      if (q.op === 'LABEL') {
        labelIndices[q.result] = i;
      }
    });

    // Find loops
    tac.forEach((q, i) => {
      if (q.op === 'JMP' && labelIndices[q.result] !== undefined) {
        const targetIdx = labelIndices[q.result];
        if (targetIdx < i) {
          // Found a loop [targetIdx, i]
          loops.push({ start: targetIdx, end: i, label: q.result });
        }
      }
    });

    if (loops.length === 0) return tac;

    let optimizedTAC = [...tac];

    // Process loops (Simple approach: one pass per loop, careful with nested loops)
    // We iterate backwards to minimize index disruption or use a marking strategy.
    // For simplicity: handle the first loop found that doesn't overlap complexly?
    // Let's just try to move invariants for all loops found.
    
    for (const loop of loops) {
      const loopBody = optimizedTAC.slice(loop.start + 1, loop.end); // Instructions between LABEL and JMP
      
      // Analyze Definitions inside loop
      const definedInLoop = new Set<string>();
      loopBody.forEach(q => {
        if (q.result) definedInLoop.add(q.result);
        if (q.op === 'READ' && q.result) definedInLoop.add(q.result); 
        // Note: CALL might modify globals, strictly we should mark all globals as defined.
        // For this demo, assume CALL is blackbox and don't move things depending on globals if CALL exists?
        // Let's stick to simple Temporaries invariant motion.
      });

      const invariants: number[] = []; // Indices relative to full TAC

      for (let k = loop.start + 1; k < loop.end; k++) {
        const q = optimizedTAC[k];
        
        // Candidates for motion:
        // 1. Arithmetic/Logic operations (+, -, *, /, ODD, >, <...)
        // 2. Result is a Temporary (T...)
        // 3. Operands are Constant OR Not Defined in Loop
        if (['+', '-', '*', '/', 'ODD', '=', '<>', '<', '<=', '>', '>='].includes(q.op)) {
           if (!q.result.startsWith('T')) continue; // Only move internal temps

           const isArg1Invariant = !isNaN(parseFloat(q.arg1)) || (q.arg1 && !definedInLoop.has(q.arg1));
           const isArg2Invariant = !q.arg2 || !isNaN(parseFloat(q.arg2)) || (q.arg2 && !definedInLoop.has(q.arg2));

           if (isArg1Invariant && isArg2Invariant) {
             invariants.push(k);
           }
        }
      }

      if (invariants.length > 0) {
        // Move invariants to pre-header (before loop.start)
        // We pull them out and insert them before loop.start
        // Careful with indices changing.
        
        let shiftOffset = 0;
        invariants.forEach(originalIdx => {
             // Calculate current index because previous moves shifted things
             // But wait, if we remove from inside and insert before, the relative order of *remaining* items inside loop stays same?
             // Actually, simplest is to reconstruct the array.
        });
        
        // Let's extract instructions to move
        const instructionsToMove = invariants.map(i => optimizedTAC[i]);
        
        this.log('Loop', loop.start, `发现循环 ${loop.label}。将 ${invariants.length} 条循环不变指令移至循环前首部。`);
        instructionsToMove.forEach(q => {
            this.log('Loop', q.id, `循环不变式外提：将 ${this.quadToString(q)} 移出循环。`);
        });

        // Filter out moved instructions from body
        const indicesSet = new Set(invariants);
        const newBody = optimizedTAC.filter((_, idx) => !indicesSet.has(idx));
        
        // Insert before loop start (the LABEL)
        // Find where the label is now in `newBody` (it might have shifted if we removed things before it? No, loop is after label?
        // Wait, invariants are INSIDE loop. 
        // Label is at loop.start. We want to insert BEFORE Label.
        
        const labelIndexInNew = newBody.findIndex(q => q.op === 'LABEL' && q.result === loop.label);
        
        if (labelIndexInNew !== -1) {
             optimizedTAC = [
                 ...newBody.slice(0, labelIndexInNew),
                 ...instructionsToMove,
                 ...newBody.slice(labelIndexInNew)
             ];
        }
      }
    }

    return optimizedTAC;
  }

  private quadToString(q: Quadruple): string {
    if (q.op === 'LABEL') return `${q.result}:`;
    if (q.op === 'JMP') return `goto ${q.result}`;
    if (q.op === 'JZ') return `if false ${q.arg1} goto ${q.result}`;
    if (q.op === ':=') return `${q.result} := ${q.arg1}`;
    if (q.op === 'CALL') return `call ${q.arg1}`;
    return `${q.result} := ${q.arg1} ${q.op} ${q.arg2}`;
  }

  private log(pass: string, id: number, desc: string, orig: string = '', opt: string = '') {
    this.logs.push({ pass, id, description: desc, original: orig, optimized: opt });
  }
}
