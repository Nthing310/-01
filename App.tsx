
import React, { useState, useRef, useEffect } from 'react';
import { Lexer } from './compiler/lexer';
import { Parser } from './compiler/parser';
import { SymbolTableGenerator } from './compiler/symbolTable';
import { TACGenerator } from './compiler/tac';
import { TargetCodeGenerator } from './compiler/target';
import { VirtualMachine } from './compiler/vm';
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
  'ast': '语法树',
  'symbol_table': '符号表',
  'tac': '三地址码',
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

// --- Main App ---

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [output, setOutput] = useState("");
  const [activeTab, setActiveTab] = useState("editor");
  const [artifacts, setArtifacts] = useState<any>({});
  const [isRunning, setIsRunning] = useState(false);
  const [inputNeeded, setInputNeeded] = useState(false);
  
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const resolveInput = useRef<(val: number) => void>(null);

  const log = (msg: string) => setOutput(prev => prev + msg);

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

      // 5. P-Code (Target)
      // Use the proper TargetCodeGenerator class instead of simplified inline logic
      const targetGen = new TargetCodeGenerator(symTable);
      targetGen.generate(tacGen.code);
      const instructions = targetGen.instructions;

      setArtifacts({
        tokens, ast, symTable, tac: tacGen.code, instructions
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
          <div className="flex bg-gray-800 border-b border-gray-700">
            {['console', 'tokens', 'ast', 'symbol_table', 'tac', 'pcode'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-xs uppercase font-semibold tracking-wider ${activeTab === tab ? 'bg-gray-700 text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}
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
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
