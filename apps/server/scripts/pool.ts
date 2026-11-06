// The $1 entry pool on Arc Testnet (hackathon demo, no real money).
//   pnpm --filter @kalikkam/server pool compile   contracts/KalikkamEntryPool.sol → contracts/KalikkamEntryPool.json
//   pnpm --filter @kalikkam/server pool key       make the operator wallet (saved to .env); fund it at faucet.circle.com
//   pnpm --filter @kalikkam/server pool deploy    deploy the pool with the operator wallet, save ARC_POOL_ADDRESS to .env
//   pnpm --filter @kalikkam/server pool status    operator balance and the deployed pool
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createPublicClient, createWalletClient, formatUnits, http, parseUnits, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const here = fileURLToPath(new URL('.', import.meta.url));
const SOL = resolve(here, '../contracts/KalikkamEntryPool.sol');
const OUT = resolve(here, '../contracts/KalikkamEntryPool.json');
const ENV = resolve(here, '../.env');
import { ENTRY_USDC } from '@kalikkam/shared';

function compile() {
  const solc = createRequire(import.meta.url)('solc');
  const input = {
    language: 'Solidity',
    sources: { 'KalikkamEntryPool.sol': { content: readFileSync(SOL, 'utf8') } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join('\n'));
  const c = out.contracts['KalikkamEntryPool.sol'].KalikkamEntryPool;
  writeFileSync(OUT, JSON.stringify({ compiler: solc.version(), abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }, null, 2) + '\n');
  console.log(`Compiled with solc ${solc.version()} → contracts/KalikkamEntryPool.json`);
}

const setEnv = (key: string, value: string) => {
  const text = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
  if (new RegExp(`^${key}=`, 'm').test(text)) writeFileSync(ENV, text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`));
  else appendFileSync(ENV, `${text.endsWith('\n') || !text ? '' : '\n'}${key}=${value}\n`);
};

const pub = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC) });
const operator = () => {
  const k = process.env.ARC_OPERATOR_KEY as Hex | undefined;
  if (!k) throw new Error('No ARC_OPERATOR_KEY in apps/server/.env. Run: pool key');
  return privateKeyToAccount(k);
};

const [cmd] = process.argv.slice(2);
if (cmd === 'compile') compile();
else if (cmd === 'key') {
  if (process.env.ARC_OPERATOR_KEY) console.log(`Already have an operator: ${operator().address}`);
  else {
    const key = generatePrivateKey();
    setEnv('ARC_OPERATOR_KEY', key);
    console.log(`Operator wallet ${privateKeyToAccount(key).address} (key saved to apps/server/.env).\nFund it with test USDC at https://faucet.circle.com (Arc Testnet).`);
  }
} else if (cmd === 'deploy') {
  if (!existsSync(OUT)) compile();
  const { abi, bytecode } = JSON.parse(readFileSync(OUT, 'utf8'));
  const account = operator();
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(process.env.ARC_RPC) });
  const hash = await wallet.deployContract({ abi, bytecode, args: [parseUnits(String(ENTRY_USDC), 18)] });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (!rcpt.contractAddress) throw new Error(`Deploy failed: ${hash}`);
  setEnv('ARC_POOL_ADDRESS', rcpt.contractAddress);
  console.log(`Pool deployed at ${rcpt.contractAddress} (entry ${ENTRY_USDC} USDC)\n${arcTestnet.blockExplorers.default.url}/tx/${hash}`);
} else if (cmd === 'status') {
  const a = operator().address;
  console.log(`Operator ${a}: ${formatUnits(await pub.getBalance({ address: a }), 18)} USDC`);
  console.log(`Pool: ${process.env.ARC_POOL_ADDRESS ?? 'not deployed (run: pool deploy)'}`);
} else {
  console.log('Usage: pool compile | key | deploy | status');
  process.exitCode = 1;
}
