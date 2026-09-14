import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import "dotenv/config";

const ADDRESS = "0x60989e9737295e17Dad7DD4AeEE47822634049B6" as `0x${string}`;
const DECIDED = new Set(["5", "6", "7", "8", "12", "13"]);

function safeJson(v: unknown) {
  return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val), 2);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Bradbury's RPC has a gas rate limit that this account has been hitting
// intermittently (unrelated to the contract fix - a node-capacity issue,
// not a logic error). Retry with backoff rather than failing the whole
// verification run over it.
async function writeWithRetry(client: any, args: any, label: string) {
  for (let i = 0; i < 8; i++) {
    try {
      return await client.writeContract(args);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes("gas rate limit") && i < 7) {
        console.log(`${label}: rate limited, retrying in 10s (attempt ${i + 1})...`);
        await sleep(10000);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: exhausted retries`);
}

async function waitDecided(client: any, hash: `0x${string}`, label: string) {
  for (let i = 0; i < 240; i++) {
    try {
      const tx: any = await client.getTransaction({ hash });
      if (tx && DECIDED.has(String(tx.status))) {
        console.log(`${label}: status ${tx.status}, execResult=${tx.txExecutionResultName}`);
        return tx;
      }
    } catch {}
    await sleep(5000);
  }
  throw new Error(`${label} never reached a decided status`);
}

async function main() {
  const ownerKey = process.env.DEPLOYER_PRIVATE_KEY!;
  const borrowerKey = process.env.BORROWER_PRIVATE_KEY!;
  const ownerAccount = createAccount((ownerKey.startsWith("0x") ? ownerKey : `0x${ownerKey}`) as `0x${string}`);
  const borrowerAccount = createAccount((borrowerKey.startsWith("0x") ? borrowerKey : `0x${borrowerKey}`) as `0x${string}`);
  const ownerClient = createClient({ chain: testnetBradbury, account: ownerAccount });
  const borrowerClient = createClient({ chain: testnetBradbury, account: borrowerAccount });

  console.log("Adding covenant...");
  const addTx = await writeWithRetry(ownerClient, { address: ADDRESS, functionName: "add_covenant", args: ["min_dscr", "dscr", "gte", 12500] }, "add_covenant");
  await waitDecided(ownerClient, addTx as `0x${string}`, "add_covenant");

  console.log("\nSubmitting period 1 (should succeed)...");
  const tx1 = await writeWithRetry(borrowerClient, {
    address: ADDRESS, functionName: "submit_disclosure",
    args: [1, "Q1 2026 disclosure: DSCR was 1.5x this period, well above covenant."],
  }, "period 1");
  await waitDecided(borrowerClient, tx1 as `0x${string}`, "period 1");

  const stateAfter1: any = await ownerClient.readContract({ address: ADDRESS, functionName: "get_state", args: [] });
  console.log("state after period 1:", safeJson(stateAfter1));

  console.log("\nReplaying period 1 again (must be rejected)...");
  const tx2 = await writeWithRetry(borrowerClient, {
    address: ADDRESS, functionName: "submit_disclosure",
    args: [1, "trying to replay period 1 to reset the reporting clock"],
  }, "period 1 replay");
  const r2 = await waitDecided(borrowerClient, tx2 as `0x${string}`, "period 1 replay");
  console.log("replay leader stderr:", (r2 as any)?.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr);

  const stateAfterReplay: any = await ownerClient.readContract({ address: ADDRESS, functionName: "get_state", args: [] });
  console.log("\nstate after replay attempt (should be unchanged from after period 1):", safeJson(stateAfterReplay));

  console.log("\n=== RESULT ===");
  console.log("period_count unchanged:", stateAfter1.period_count === stateAfterReplay.period_count);
  console.log("last_report_time unchanged:", stateAfter1.last_report_time === stateAfterReplay.last_report_time);
  console.log("last_period_id unchanged:", stateAfter1.last_period_id === stateAfterReplay.last_period_id);
}
main().catch((e) => { console.error(e); process.exit(1); });
