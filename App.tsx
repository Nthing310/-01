
import React, { useState, useRef, useEffect } from 'react';
import { Lexer } from './compiler/lexer';
import { Parser } from './compiler/parser';
import { SymbolTableGenerator } from './compiler/symbolTable';
import { TACGenerator } from './compiler/tac';
import { TargetCodeGenerator } from './compiler/target';
import { VirtualMachine } from './compiler/vm';
import { GrammarAnalyzer, GrammarAnalysis } from './compiler/grammarAnalyzer';
import { Optimizer, OptimizationLog } from './compiler/optimizer';
import { Instruction, PCodeF } from './types';

// Sample Code from PDF
const DEFAULT_CODE = `program example;
const m:=7,n:=85;
var x,y,z,q,r;
procedure multiply(x,y);
var a,b;
begin
  a:=x; b:=y; z:=0;
  while b>0 do
  begin
    if odd b then z:=z+a;
    a:=2*a; b:=b/2
  end;
  write(z)
end;

begin
  x:=m; y:=n;
  call multiply(x,y);
  write(x)
end.`;

const TAB_NAMES: Record<string, string> = {
  'console': '控制台',
  'tokens': '词法单元',
  'grammar': 'LL(1) 分析表',
  'ast': '语法树',
  'symbol_table': '符号表',
  'stack_frame': '活动记录',
  'tac': '四元式',
  'optimization': '代码优化',
  'pcode': 'P-Code (目标代码)'
};

// --- CSS for Tree Diagram ---
const TREE_CSS = `
.tf-tree {
  display: inline-table;
  margin: 0 auto;
}
.tf-tree ul {
  padding-top: 20px; 
  position: relative;
  display: flex;
  justify-content: center;
}
.tf-tree li {
  float: left; text-align: center;
  list-style-type: none;
  position: relative;
  padding: 20px 10px 0 10px;
}
/* Connectors */
.tf-tree li::before, .tf-tree li::after {
  content: '';
  position: absolute; top: 0; right: 50%;
  border-top: 1px solid #666;
  width: 50%; height: 20px;
}
.tf-tree li::after {
  right: auto; left: 50%;
  border-left: 1px solid #666;
}
.tf-tree li:only-child::after, .tf-tree li:only-child::before {
  display: none;
}
.tf-tree li:only-child { padding-top: 0; }
.tf-tree li:first-child::before, .tf-tree li:last-child::after {
  border: 0 none;
}
.tf-tree li:last-child::before {
  border-right: 1px solid #666;
  border-radius: 0 5px 0 0;
}
.tf-tree li:first-child::after {
  border-radius: 5px 0 0 0;
}
.tf-tree ul ul::before {
  content: '';
  position: absolute; top: 0; left: 50%;
  border-left: 1px solid #666;
  width: 0; height: 20px;
}
.tf-node {
  display: inline-block;
  padding: 8px 12px;
  border: 1px solid #444;
  text-decoration: none;
  background-color: #2d2d2d;
  color: #ccc;
  border-radius: 4px;
  font-size: 12px;
  min-width: 80px;
  position: relative;
  z-index: 10;
}
.tf-node:hover {
  background-color: #3d3d3d;
  border-color: #666;
  z-index: 20;
}
.tf-node .type {
  font-weight: bold;
  color: #60a5fa;
  display: block;
  margin-bottom: 2px;
}
.tf-node .detail {
  font-family: monospace;
  color: #4ade80;
  font-size: 11px;
}
`;

// --- Components for Visualization ---

interface TreeData {
  label: string;
  details?: string[];
  children: TreeData[];
}

const transformToTree = (node: any, keyName?: string): TreeData | null => {
  if (node === null || node === undefined) return null;

  // Primitives (Leafs)
  if (typeof node !== 'object') {
    return { label: String(node), children: [] };
  }

  // Arrays (e.g. Statement Lists)
  if (Array.isArray(node)) {
    if (node.length === 0) return null;
    return {
      label: keyName || 'List',
      children: node.map((n, i) => transformToTree(n, `[${i}]`)).filter(Boolean) as TreeData[]
    };
  }

  // AST Nodes
  const type = node.constructor?.name || 'Object';
  const children: TreeData[] = [];
  const details: string[] = [];

  // Custom simplified views for specific nodes to keep tree compact
  let label = type;
  if (type === 'NumNode') {
    details.push(String(node.value));
  } else if (type === 'VarNode') {
    details.push(node.name);
  } else if (type === 'BinOpNode') {
    label = `Op(${node.op})`;
    children.push(transformToTree(node.left, 'left')!);
    children.push(transformToTree(node.right, 'right')!);
  } else if (type === 'AssignNode') {
    label = 'Assign';
    details.push(node.varName);
    children.push(transformToTree(node.expr, 'expr')!);
  } else if (type === 'IfNode') {
    children.push(transformToTree(node.lexp, 'cond')!);
    children.push(transformToTree(node.thenStmt, 'then')!);
    if(node.elseStmt) children.push(transformToTree(node.elseStmt, 'else')!);
  } else if (type === 'WhileNode') {
    children.push(transformToTree(node.lexp, 'cond')!);
    children.push(transformToTree(node.bodyStmt, 'do')!);
  } else if (type === 'CallNode') {
    details.push(node.procName);
    if(node.args.length > 0) children.push(transformToTree(node.args, 'args')!);
  } else {
     // Generic object walker
     Object.keys(node).forEach(key => {
        const val = node[key];
        if (typeof val === 'object' && val !== null) {
          if (Array.isArray(val)) {
             if(val.length > 0) {
                 // Flatten lists if they are the only children of a key container
                 val.forEach((v, i) => {
                     const child = transformToTree(v);
                     if(child) children.push(child);
                 });
             }
          } else {
             const child = transformToTree(val, key);
             if(child) children.push(child);
          }
        } else if (val !== null && val !== undefined) {
          details.push(`${val}`); // simplified, usually don't show key name for compactness
        }
     });
  }

  return { label, details, children };
};

const TreeNodeRenderer = ({ node }: { node: TreeData }) => {
  return (
    <li>
      <div className="tf-node">
        <span className="type">{node.label}</span>
        {node.details && node.details.map((d, i) => (
            <div key={i} className="detail">{d}</div>
        ))}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child, i) => (
            <TreeNodeRenderer key={i} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
};

const ASTGraphViewer = ({ ast }: { ast: any }) => {
  if (!ast) return <div className="text-gray-500 italic">暂无 AST 数据</div>;
  
  const treeData = transformToTree(ast);
  if (!treeData) return null;

  return (
    <div className="p-8 overflow-auto h-full bg-[#1e1e1e]">
      <style>{TREE_CSS}</style>
      <div className="tf-tree">
        <ul>
          <TreeNodeRenderer node={treeData} />
        </ul>
      </div>
    </div>
  );
};

const SymbolTableNode = ({ table }: { table: any }) => {
    return (
        <div className="mb-6 border border-gray-700 rounded bg-gray-800/50 overflow-hidden">
            <div className="bg-gray-800 p-2 border-b border-gray-700 flex justify-between items-center">
                <div className="font-bold text-blue-300 flex items-center gap-2">
                    <span className="material-icons text-sm">folder</span>
                    <span>作用域: {table.name}</span>
                </div>
                <div className="text-xs text-gray-500 bg-gray-900 px-2 py-1 rounded">Level: {table.level}</div>
            </div>
            
            <div className="p-2">
                <table className="w-full text-xs text-left border-collapse">
                    <thead>
                        <tr className="text-gray-500 border-b border-gray-700">
                            <th className="py-2 px-2">名称 (Name)</th>
                            <th className="py-2 px-2">类型 (Kind)</th>
                            <th className="py-2 px-2">值/层级 (Val/L)</th>
                            <th className="py-2 px-2">地址 (Addr)</th>
                            <th className="py-2 px-2">大小 (Size)</th>
                            <th className="py-2 px-2">参数 (Params)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {table.entries.length === 0 ? (
                            <tr><td colSpan={6} className="text-center py-4 text-gray-600 italic">此作用域无符号</td></tr>
                        ) : (
                            table.entries.map((e: any, i: number) => (
                                <tr key={i} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                                    <td className="py-1.5 px-2 text-green-300 font-mono font-bold">{e.name}</td>
                                    <td className="py-1.5 px-2 text-purple-300">{e.kind}</td>
                                    <td className="py-1.5 px-2">{e.valLevel}</td>
                                    <td className="py-1.5 px-2 font-mono text-yellow-500">{e.addr}</td>
                                    <td className="py-1.5 px-2">{e.size}</td>
                                    <td className="py-1.5 px-2">{e.numParams || '-'}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Recursively render children tables */}
            {table.children.length > 0 && (
                <div className="p-2 pl-4 border-t border-gray-700 bg-gray-900/30">
                    <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider font-bold">子作用域</div>
                    {table.children.map((child: any, i: number) => (
                        <SymbolTableNode key={i} table={child} />
                    ))}
                </div>
            )}
        </div>
    );
};

// --- Stack Frame View Component ---
const StackFrameView = ({ rootTable }: { rootTable: any }) => {
    if (!rootTable) return <div className="text-gray-500 italic">未生成符号表，请先编译。</div>;

    // Helper to flatten tables
    const getAllTables = (table: any, list: any[] = []) => {
        list.push(table);
        table.children.forEach((c: any) => getAllTables(c, list));
        return list;
    };

    const tables = getAllTables(rootTable);

    return (
        <div className="flex flex-col gap-6 pb-10">
            {tables.map((table: any, idx: number) => {
                // Determine Frame Items
                const items: any[] = [];
                
                // 1. Parameters (Negative Offsets)
                // Filter variables with negative address
                const params = table.entries.filter((e: any) => e.kind === 'variable' && Number(e.addr) < 0);
                params.sort((a: any, b: any) => Number(a.addr) - Number(b.addr));
                
                params.forEach((p: any) => {
                    items.push({ offset: p.addr, role: 'Parameter', name: p.name, desc: `参数 ${p.name}` });
                });

                // 2. Header (0, 1, 2)
                items.push({ offset: 0, role: 'Control Link', name: 'SL', desc: '静态链 (Static Link)' });
                items.push({ offset: 1, role: 'Control Link', name: 'DL', desc: '动态链 (Dynamic Link)' });
                items.push({ offset: 2, role: 'Return Addr', name: 'RA', desc: '返回地址 (Return Address)' });

                // 3. Locals (Positive Offsets >= 3)
                const locals = table.entries.filter((e: any) => e.kind === 'variable' && Number(e.addr) >= 3);
                locals.sort((a: any, b: any) => Number(a.addr) - Number(b.addr));
                
                locals.forEach((l: any) => {
                    items.push({ offset: l.addr, role: 'Local Var', name: l.name, desc: `局部变量 ${l.name}` });
                });

                return (
                    <div key={idx} className="border border-gray-700 rounded bg-gray-900 overflow-hidden">
                        <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex justify-between items-center">
                            <h3 className="font-bold text-blue-400">
                                {table.name === 'Global' ? '主程序 (Main Program)' : `过程: ${table.name}`}
                            </h3>
                            <div className="flex gap-2">
                                <span className="text-xs text-gray-500 bg-gray-950 px-2 py-1 rounded">
                                    层级 (Level): {table.level}
                                </span>
                            </div>
                        </div>
                        <div className="p-4 bg-[#1e1e1e]">
                            <div className="text-xs text-gray-500 mb-2 italic">内存布局 (相对于基址 BP):</div>
                            <table className="w-full text-sm border-collapse text-left">
                                <thead>
                                    <tr className="text-gray-500 border-b border-gray-700">
                                        <th className="p-2 w-20 text-right">偏移 (Offset)</th>
                                        <th className="p-2 w-32">类型 (Type)</th>
                                        <th className="p-2 w-24">名称 (Name)</th>
                                        <th className="p-2">描述 (Description)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item, i) => (
                                        <tr key={i} className={`border-b border-gray-800 hover:bg-gray-800/20 ${
                                            item.role === 'Control Link' || item.role === 'Return Addr' ? 'bg-gray-800/30' : 
                                            item.role === 'Parameter' ? 'bg-blue-900/10' : ''
                                        }`}>
                                            <td className="p-2 text-right font-mono text-gray-500">{item.offset}</td>
                                            <td className={`p-2 font-bold ${
                                                item.role === 'Parameter' ? 'text-blue-400' :
                                                item.role.includes('Link') ? 'text-purple-400' :
                                                item.role === 'Return Addr' ? 'text-red-400' : 'text-green-400'
                                            }`}>{item.role}</td>
                                            <td className="p-2 font-mono text-yellow-500">{item.name}</td>
                                            <td className="p-2 text-gray-400 text-xs">{item.desc}</td>
                                        </tr>
                                    ))}
                                    <tr className="border-b border-gray-800 border-dashed">
                                        <td className="p-2 text-right font-mono text-gray-600">...</td>
                                        <td className="p-2 text-gray-600 italic" colSpan={3}>临时变量区域 (Temporary Variables Area)</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// --- Grammar View Component ---
const GrammarView = ({ analysis }: { analysis: GrammarAnalysis }) => {
    if (!analysis) return <div className="text-gray-500">正在分析文法...</div>;

    const sortedNonTerminals = Array.from(analysis.nonTerminals).sort();
    const sortedTerminals = Array.from(analysis.terminals).sort();
    // Add $ to terminals for table view
    const tableTerminals = [...sortedTerminals, '$'];

    return (
        <div className="flex flex-col gap-8 pb-10">
            {/* FIRST & FOLLOW Sets */}
            <div className="flex gap-4">
                <div className="flex-1">
                    <h3 className="text-blue-400 font-bold mb-2">FIRST 集</h3>
                    <div className="border border-gray-700 rounded overflow-hidden">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-gray-800 text-gray-400">
                                <tr>
                                    <th className="p-2">Non-Terminal</th>
                                    <th className="p-2">FIRST Set</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedNonTerminals.map(nt => (
                                    <tr key={nt} className="border-b border-gray-700/50 hover:bg-gray-800/50">
                                        <td className="p-2 font-mono text-yellow-500">{nt}</td>
                                        <td className="p-2 font-mono text-gray-300">
                                            {'{ ' + Array.from(analysis.first[nt]).join(', ') + ' }'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div className="flex-1">
                    <h3 className="text-green-400 font-bold mb-2">FOLLOW 集</h3>
                    <div className="border border-gray-700 rounded overflow-hidden">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-gray-800 text-gray-400">
                                <tr>
                                    <th className="p-2">Non-Terminal</th>
                                    <th className="p-2">FOLLOW Set</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedNonTerminals.map(nt => (
                                    <tr key={nt} className="border-b border-gray-700/50 hover:bg-gray-800/50">
                                        <td className="p-2 font-mono text-yellow-500">{nt}</td>
                                        <td className="p-2 font-mono text-gray-300">
                                            {'{ ' + Array.from(analysis.follow[nt]).join(', ') + ' }'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Parsing Table */}
            <div>
                <h3 className="text-purple-400 font-bold mb-2">LL(1) 预测分析表</h3>
                <div className="overflow-x-auto border border-gray-700 rounded">
                    <table className="min-w-max text-xs text-left border-collapse">
                        <thead className="bg-gray-800 text-gray-400 sticky top-0">
                            <tr>
                                <th className="p-2 border-r border-gray-600 sticky left-0 bg-gray-800 z-10">NT \ T</th>
                                {tableTerminals.map(t => (
                                    <th key={t} className="p-2 border-r border-gray-700 min-w-[60px] text-center font-mono">{t}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedNonTerminals.map(nt => (
                                <tr key={nt} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                                    <td className="p-2 border-r border-gray-600 font-mono text-yellow-500 sticky left-0 bg-gray-900">{nt}</td>
                                    {tableTerminals.map(t => {
                                        const prods = analysis.table[nt][t];
                                        return (
                                            <td key={t} className="p-2 border-r border-gray-700/50 text-center font-mono text-gray-400 whitespace-nowrap">
                                                {prods && prods.length > 0 ? (
                                                    prods.map((p, i) => (
                                                        <div key={i} className={prods.length > 1 ? "text-red-400" : "text-blue-300"}>
                                                            {nt} &rarr; {p}
                                                        </div>
                                                    ))
                                                ) : <span className="text-gray-700">-</span>}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            
            {/* Grammar Source */}
             <div>
                <h3 className="text-gray-500 font-bold mb-2 text-xs uppercase">Reference Grammar</h3>
                <pre className="text-xs text-gray-600 bg-gray-950 p-4 rounded overflow-auto max-h-40">
                    {analysis.grammarStr}
                </pre>
            </div>
        </div>
    );
};


// --- Main App ---

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [output, setOutput] = useState("");
  const [activeTab, setActiveTab] = useState("editor");
  const [artifacts, setArtifacts] = useState<any>({});
  const [grammarAnalysis, setGrammarAnalysis] = useState<GrammarAnalysis | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [inputNeeded, setInputNeeded] = useState(false);
  
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const resolveInput = useRef<(val: number) => void>(null);

  const log = (msg: string) => setOutput(prev => prev + msg);

  // Initialize Grammar Analysis on Mount
  useEffect(() => {
    const analyzer = new GrammarAnalyzer();
    setGrammarAnalysis(analyzer.getAnalysis());
  }, []);

  const compile = async () => {
    setOutput("");
    try {
      // 1. Lexer
      const lexer = new Lexer(code);
      const tokens = lexer.tokenize();
      
      // 2. Parser
      const parser = new Parser(tokens);
      const ast = parser.parse();

      // 3. Symbol Table
      const stGen = new SymbolTableGenerator();
      const symTable = stGen.generate(ast);

      // 4. TAC
      const tacGen = new TACGenerator(symTable);
      tacGen.generate(ast);
      
      // 5. Optimization
      const optimizer = new Optimizer();
      const optimizedTAC = optimizer.optimize(tacGen.code);

      // 6. P-Code (Target) - Still using original TAC for safety/consistency with VM currently
      // Note: If you want to run optimized code, swap tacGen.code with optimizedTAC below.
      // For visualization purposes, we show both.
      const targetGen = new TargetCodeGenerator(symTable);
      targetGen.generate(tacGen.code); 
      const instructions = targetGen.instructions;

      setArtifacts({
        tokens, 
        ast, 
        symTable, 
        tac: tacGen.code, 
        optimizedTac: optimizedTAC, 
        optimizerLogs: optimizer.logs,
        instructions
      });
      
      log("编译成功！\n");
      return instructions;

    } catch (err: any) {
      log(`错误: ${err.message}\n`);
      console.error(err);
      return null;
    }
  };

  const run = async () => {
    const code = await compile();
    if (!code) return;
    
    setIsRunning(true);
    setActiveTab("console");
    
    const vm = new VirtualMachine(code);
    vm.onOutput = (msg) => log(msg);
    vm.onRequestInput = () => {
        return new Promise((resolve) => {
            setInputNeeded(true);
            (resolveInput as any).current = resolve;
            setTimeout(() => terminalInputRef.current?.focus(), 100);
        });
    };

    try {
        await vm.run();
    } catch(e: any) {
        log(`运行时错误: ${e.message}\n`);
    }
    
    setIsRunning(false);
    setInputNeeded(false);
  };

  const handleInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if(e.key === 'Enter') {
          const val = parseInt(e.currentTarget.value);
          if(!isNaN(val) && resolveInput.current) {
              log(`${val}\n`);
              resolveInput.current(val);
              resolveInput.current = null;
              setInputNeeded(false);
              e.currentTarget.value = '';
          }
      }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-900 text-gray-200 overflow-hidden">
      {/* Header */}
      <header className="h-12 bg-gray-800 border-b border-gray-700 flex items-center px-4 justify-between">
        <h1 className="font-bold text-lg text-blue-400">PL/0 编译器</h1>
        <div className="flex gap-2">
          <button onClick={compile} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm transition">
            编译
          </button>
          <button onClick={run} disabled={isRunning} className={`px-3 py-1 rounded text-sm transition ${isRunning ? 'bg-gray-600 cursor-not-allowed' : 'bg-green-700 hover:bg-green-600 text-white'}`}>
            运行
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor */}
        <div className="w-1/2 flex flex-col border-r border-gray-700">
          <div className="h-8 bg-gray-800 flex items-center px-4 text-xs font-mono text-gray-400">source.pl0 (源码)</div>
          <textarea 
            className="flex-1 bg-[#1e1e1e] p-4 text-sm font-mono outline-none resize-none leading-relaxed"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Output/Artifacts */}
        <div className="w-1/2 flex flex-col">
          {/* Tabs */}
          <div className="flex bg-gray-800 border-b border-gray-700 overflow-x-auto">
            {['console', 'tokens', 'grammar', 'ast', 'symbol_table', 'stack_frame', 'tac', 'optimization', 'pcode'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-xs uppercase font-semibold tracking-wider whitespace-nowrap ${activeTab === tab ? 'bg-gray-700 text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {TAB_NAMES[tab] || tab}
              </button>
            ))}
          </div>

          <div className="flex-1 bg-[#1e1e1e] p-4 font-mono text-sm overflow-auto">
            {activeTab === 'console' && (
              <div className="h-full flex flex-col">
                <pre className="flex-1 whitespace-pre-wrap">{output}</pre>
                {inputNeeded && (
                    <div className="flex items-center border-t border-gray-700 pt-2">
                        <span className="text-green-500 mr-2">$</span>
                        <input 
                            ref={terminalInputRef}
                            type="number" 
                            className="bg-transparent outline-none flex-1"
                            onKeyDown={handleInput}
                            placeholder="等待输入..."
                        />
                    </div>
                )}
              </div>
            )}
            
            {activeTab === 'tokens' && (
                <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="font-bold text-gray-500">行号 (LINE)</div>
                    <div className="font-bold text-gray-500">类型 (TYPE)</div>
                    <div className="font-bold text-gray-500">词素 (LEXEME)</div>
                    <div className="font-bold text-gray-500">值 (VALUE)</div>
                    {artifacts.tokens?.map((t: any, i: number) => (
                        <React.Fragment key={i}>
                            <div>{t.line}</div>
                            <div className="text-blue-300">{t.sym}</div>
                            <div className="text-yellow-300">{t.lexeme}</div>
                            <div>{t.value}</div>
                        </React.Fragment>
                    ))}
                </div>
            )}

            {activeTab === 'ast' && (
                <ASTGraphViewer ast={artifacts.ast} />
            )}

            {activeTab === 'symbol_table' && (
                 artifacts.symTable ? <SymbolTableNode table={artifacts.symTable} /> : <div className="text-gray-500 italic">未生成符号表</div>
            )}

            {activeTab === 'stack_frame' && (
                 <StackFrameView rootTable={artifacts.symTable} />
            )}

            {activeTab === 'tac' && (
                <table className="w-full text-left text-xs">
                    <thead>
                        <tr className="border-b border-gray-700 text-gray-500">
                            <th className="py-1">序号 (ID)</th>
                            <th>操作 (OP)</th>
                            <th>参数1 (ARG1)</th>
                            <th>参数2 (ARG2)</th>
                            <th>结果 (RES)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {artifacts.tac?.map((q: any) => (
                            <tr key={q.id} className="border-b border-gray-800 hover:bg-gray-800">
                                <td className="py-1 text-gray-500">{q.id}</td>
                                <td className="text-purple-400 font-bold">{q.op}</td>
                                <td>{q.arg1}</td>
                                <td>{q.arg2}</td>
                                <td className="text-yellow-300">{q.result}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {activeTab === 'optimization' && (
                <div className="flex flex-col gap-6">
                    {/* Optimization Analysis Table */}
                    <div className="border border-gray-700 bg-gray-900 rounded flex flex-col">
                        <div className="px-4 py-3 border-b border-gray-700 bg-gray-800 flex justify-between items-center">
                            <h3 className="font-bold text-blue-400 text-sm flex items-center gap-2">
                                <span className="material-icons text-sm">analytics</span>
                                优化分析报告 (Optimization Analysis)
                            </h3>
                            <span className="text-xs text-gray-500">
                                共发现 {artifacts.optimizerLogs?.length || 0} 处优化
                            </span>
                        </div>
                        <div className="overflow-auto max-h-60">
                             <table className="w-full text-left text-xs border-collapse">
                                <thead className="bg-gray-800 text-gray-400 sticky top-0 z-10">
                                    <tr>
                                        <th className="p-2 border-r border-gray-700 w-12 text-center">ID</th>
                                        <th className="p-2 border-r border-gray-700 w-28">类型 (Type)</th>
                                        <th className="p-2 border-r border-gray-700">优化原因 (Reason)</th>
                                        <th className="p-2 w-1/3">变更对比 (Change)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {!artifacts.optimizerLogs || artifacts.optimizerLogs.length === 0 ? (
                                        <tr><td colSpan={4} className="p-4 text-center text-gray-500 italic">无优化项 (No optimizations detected)</td></tr>
                                    ) : (
                                        artifacts.optimizerLogs.map((log: OptimizationLog, i: number) => (
                                            <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/30 group">
                                                <td className="p-2 border-r border-gray-800 text-center font-mono text-gray-500">{log.id}</td>
                                                <td className="p-2 border-r border-gray-800">
                                                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${
                                                        log.pass === 'Loop' 
                                                            ? 'bg-purple-900/30 text-purple-400 border-purple-800' 
                                                            : 'bg-blue-900/30 text-blue-400 border-blue-800'
                                                    }`}>
                                                        {log.pass === 'Loop' ? '循环优化 (Loop)' : '局部优化 (Local)'}
                                                    </span>
                                                </td>
                                                <td className="p-2 border-r border-gray-800 text-gray-300">
                                                    {log.description}
                                                </td>
                                                <td className="p-2 font-mono">
                                                    <div className="flex flex-col gap-1">
                                                        {log.original && (
                                                            <div className="text-red-400 line-through decoration-red-500/50 opacity-70 text-[10px] truncate" title={log.original}>
                                                                <span className="text-red-500/50 mr-1 select-none">BEFORE:</span>{log.original}
                                                            </div>
                                                        )}
                                                        {log.optimized && (
                                                            <div className="text-green-400 text-[11px] truncate" title={log.optimized}>
                                                                <span className="text-green-500/50 mr-1 select-none">AFTER :</span>{log.optimized}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                             </table>
                        </div>
                    </div>

                    {/* Side-by-Side Comparison */}
                    <div className="flex gap-4 h-[500px]">
                        {/* Before */}
                        <div className="flex-1 flex flex-col border border-gray-700 rounded bg-gray-900">
                            <div className="bg-gray-800 px-3 py-2 text-xs font-bold text-gray-400 border-b border-gray-700">原始三地址码 (Original TAC)</div>
                            <div className="flex-1 overflow-auto p-0">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead className="sticky top-0 bg-gray-800 z-10">
                                        <tr className="text-gray-500">
                                            <th className="py-1 px-2 w-10">ID</th>
                                            <th className="px-1">Code</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {artifacts.tac?.map((q: any) => (
                                            <tr key={q.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                                                <td className="py-1 px-2 text-gray-600 font-mono border-r border-gray-800">{q.id}</td>
                                                <td className="px-2 py-1 font-mono text-gray-400">
                                                    <span className="text-purple-400 font-bold mr-2">{q.op}</span>
                                                    {q.op === 'LABEL' ? <span className="text-yellow-400">{q.result}:</span> : 
                                                    <>
                                                        {q.result && <span className="text-yellow-300 mr-1">{q.result} :=</span>}
                                                        <span className="text-gray-300 mr-1">{q.arg1}</span>
                                                        <span className="text-gray-300">{q.arg2}</span>
                                                    </>
                                                    }
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* After */}
                        <div className="flex-1 flex flex-col border border-gray-700 rounded bg-gray-900">
                            <div className="bg-gray-800 px-3 py-2 text-xs font-bold text-green-400 border-b border-gray-700">优化后三地址码 (Optimized TAC)</div>
                            <div className="flex-1 overflow-auto p-0">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead className="sticky top-0 bg-gray-800 z-10">
                                        <tr className="text-gray-500">
                                            <th className="py-1 px-2 w-10">ID</th>
                                            <th className="px-1">Code</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {artifacts.optimizedTac?.map((q: any) => (
                                            <tr key={q.id} className="border-b border-gray-800 hover:bg-gray-800/50 bg-green-900/5">
                                                <td className="py-1 px-2 text-gray-600 font-mono border-r border-gray-800">{q.id}</td>
                                                <td className="px-2 py-1 font-mono text-gray-300">
                                                    <span className="text-purple-400 font-bold mr-2">{q.op}</span>
                                                    {q.op === 'LABEL' ? <span className="text-yellow-400">{q.result}:</span> : 
                                                    <>
                                                        {q.result && <span className="text-yellow-300 mr-1">{q.result} :=</span>}
                                                        <span className="text-gray-300 mr-1">{q.arg1}</span>
                                                        <span className="text-gray-300">{q.arg2}</span>
                                                    </>
                                                    }
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'pcode' && (
                <table className="w-full text-left text-xs">
                    <thead>
                        <tr className="border-b border-gray-700 text-gray-500">
                            <th className="py-1">地址 (ADDR)</th>
                            <th>功能 (F)</th>
                            <th>层差 (L)</th>
                            <th>参数 (A)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {artifacts.instructions?.map((inst: any, i: number) => (
                            <tr key={i} className="border-b border-gray-800 hover:bg-gray-800">
                                <td className="py-1 text-gray-500">{i}</td>
                                <td className="text-red-400 font-bold">{inst.f}</td>
                                <td>{inst.l}</td>
                                <td className="text-blue-300">{inst.a}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {activeTab === 'grammar' && grammarAnalysis && (
                <GrammarView analysis={grammarAnalysis} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
