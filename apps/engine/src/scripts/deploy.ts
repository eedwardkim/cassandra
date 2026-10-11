import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, fallback, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet, foundry } from "viem/chains";
import { agentPolicyAbi, agentPolicyBytecode, calibrationLedgerAbi, calibrationLedgerBytecode } from "@cassandra/shared";
import { config } from "../config.js";

const target = (process.argv[2] ?? "bscTestnet") as "bscTestnet" | "local";
const chain = target === "local" ? foundry : bscTestnet;
const transport = target === "local" ? http(config.chain.localRpcUrl) : fallback([http(config.chain.rpcUrl), http(config.chain.rpcFallback)]);
if (!config.chain.ownerKey || !config.chain.agentKey) throw new Error("OWNER_PRIVATE_KEY and AGENT_PRIVATE_KEY must be 0x-prefixed 32-byte private keys");
const owner = privateKeyToAccount(config.chain.ownerKey);
const agent = privateKeyToAccount(config.chain.agentKey);
const pub = createPublicClient({ chain, transport });
const ow = createWalletClient({ account: owner, chain, transport });

if (target === "local") {
  // anvil: fund generated wallets from the default dev account
  const dev = createWalletClient({ account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"), chain, transport });
  for (const a of [owner.address, agent.address]) {
    if ((await pub.getBalance({ address: a })) < parseEther("5")) await pub.waitForTransactionReceipt({ hash: await dev.sendTransaction({ to: a, value: parseEther("10") }) });
  }
}

const bal = await pub.getBalance({ address: owner.address });
console.log(`network ${target} (chain ${chain.id}); owner ${owner.address} holds ${Number(bal) / 1e18} BNB`);
if (target === "bscTestnet" && bal < parseEther("0.005")) throw new Error("owner wallet needs tBNB before deploying to BSC Testnet");

const wait = async (hash: Hex, label: string) => {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} failed: ${hash}`);
  console.log(`  ${label.padEnd(10)} ${hash}  block ${r.blockNumber}`);
  return r;
};

const txs: Record<string, Hex> = {};
txs.ledger = await ow.deployContract({ abi: calibrationLedgerAbi, bytecode: calibrationLedgerBytecode, args: [owner.address] });
const lr = await wait(txs.ledger, "ledger");
txs.policy = await ow.deployContract({ abi: agentPolicyAbi, bytecode: agentPolicyBytecode, args: [owner.address] });
const pr = await wait(txs.policy, "policy");
txs.setPolicy = await ow.writeContract({
  address: pr.contractAddress!, abi: agentPolicyAbi, functionName: "setPolicy",
  args: [agent.address, { maxNotionalPerTrade: 2500n, maxDailyNotional: 20000n, minEdgeBps: 300, allowedCategoryMask: 0xffffffff, paused: false }],
});
await wait(txs.setPolicy, "setPolicy");
const agentBal = await pub.getBalance({ address: agent.address });
const topUp = target === "local" ? 0n : parseEther(process.env.AGENT_TOPUP_BNB ?? "0.1");
if (topUp > 0n && agentBal < topUp && bal > topUp * 2n) {
  txs.fundAgent = await ow.sendTransaction({ to: agent.address, value: topUp });
  await wait(txs.fundAgent, "fundAgent");
}

const out = {
  network: target, chainId: chain.id, ledger: lr.contractAddress, policy: pr.contractAddress, owner: owner.address, agent: agent.address,
  deployBlock: Number(lr.blockNumber), txs, deployedAt: new Date().toISOString(),
};
mkdirSync(config.deploymentsDir, { recursive: true });
writeFileSync(`${config.deploymentsDir}${target}.json`, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote packages/shared/deployments/${target}.json`);
