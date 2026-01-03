
import { Instruction, PCodeF } from '../types';

export class VirtualMachine {
  private stack: number[] = new Array(2000).fill(0);
  private p: number = 0; // Program Counter
  private b: number = 0; // Base Pointer
  private t: number = 0; // Top Stack Pointer
  private instructions: Instruction[];
  
  public onOutput: (msg: string) => void = console.log;
  public onRequestInput: () => Promise<number> = async () => 0;

  constructor(instructions: Instruction[]) {
    this.instructions = instructions;
  }

  private base(l: number): number {
    let b1 = this.b;
    while (l > 0) {
      b1 = this.stack[b1];
      l--;
    }
    return b1;
  }

  public async run() {
    this.t = 0;
    this.b = 0;
    this.p = 0;
    this.stack.fill(0);
    // Base frame init
    this.t = 3; 

    while (this.p < this.instructions.length) {
      const i = this.instructions[this.p];
      this.p++;

      // Ensure address is number (resolved)
      const a = Number(i.a); 

      switch (i.f) {
        case PCodeF.LIT:
          this.stack[this.t] = a;
          this.t++;
          break;
        case PCodeF.OPR:
          switch (a) {
            case 0: // RET
              this.t = this.b;
              this.p = this.stack[this.t + 2];
              this.b = this.stack[this.t + 1];
              break;
            case 1: // NEG
              this.stack[this.t - 1] = -this.stack[this.t - 1];
              break;
            case 2: // ADD
              this.t--;
              this.stack[this.t - 1] += this.stack[this.t];
              break;
            case 3: // SUB
              this.t--;
              this.stack[this.t - 1] -= this.stack[this.t];
              break;
            case 4: // MUL
              this.t--;
              this.stack[this.t - 1] *= this.stack[this.t];
              break;
            case 5: // DIV
              this.t--;
              if (this.stack[this.t] === 0) throw new Error("Runtime Error: Division by zero");
              this.stack[this.t - 1] = Math.floor(this.stack[this.t - 1] / this.stack[this.t]);
              break;
            case 6: // ODD
              this.stack[this.t - 1] %= 2;
              break;
            case 8: // EQL
              this.t--;
              this.stack[this.t - 1] = (this.stack[this.t - 1] === this.stack[this.t]) ? 1 : 0;
              break;
            case 9: // NEQ
              this.t--;
              this.stack[this.t - 1] = (this.stack[this.t - 1] !== this.stack[this.t]) ? 1 : 0;
              break;
            case 10: // LSS
              this.t--;
              this.stack[this.t - 1] = (this.stack[this.t - 1] < this.stack[this.t]) ? 1 : 0;
              break;
            case 11: // GEQ
              this.t--;
              this.stack[this.t - 1] = (this.stack[this.t - 1] >= this.stack[this.t]) ? 1 : 0;
              break;
            case 12: // GTR
              this.t--;
              this.stack[this.t - 1] = (this.stack[this.t - 1] > this.stack[this.t]) ? 1 : 0;
              break;
            case 13: // LEQ
              this.t--;
              this.stack[this.t - 1] = (this.stack[this.t - 1] <= this.stack[this.t]) ? 1 : 0;
              break;
            case 16: // READ (Stack Top)
              this.onOutput("请输入 > ");
              const val = await this.onRequestInput();
              this.stack[this.t] = val;
              this.t++;
              this.onOutput(`${val}\n`);
              break;
          }
          break;
        case PCodeF.LOD:
          this.stack[this.t] = this.stack[this.base(i.l) + a];
          this.t++;
          break;
        case PCodeF.STO:
          this.t--;
          this.stack[this.base(i.l) + a] = this.stack[this.t];
          break;
        case PCodeF.CAL:
          this.stack[this.t] = this.base(i.l); // Static Link
          this.stack[this.t + 1] = this.b;     // Dynamic Link
          this.stack[this.t + 2] = this.p;     // Return Address
          this.b = this.t;
          this.p = a;
          break;
        case PCodeF.INT:
          this.t += a;
          break;
        case PCodeF.JMP:
          this.p = a;
          break;
        case PCodeF.JPC:
          this.t--;
          if (this.stack[this.t] === 0) {
            this.p = a;
          }
          break;
        case PCodeF.RED:
          // Standard RED L A
          this.onOutput("请输入 > ");
          const inputVal = await this.onRequestInput();
          this.stack[this.base(i.l) + a] = inputVal;
          this.onOutput(`${inputVal}\n`);
          break;
        case PCodeF.WRT:
          this.t--;
          this.onOutput(`${this.stack[this.t]}\n`);
          break;
      }
      
      if(this.p === 0) break; // End of program
    }
    this.onOutput("程序运行结束。\n");
  }
}
