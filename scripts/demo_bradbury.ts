import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import "dotenv/config";

function safeJson(v: unknown) {
  return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val), 2);
}

const ADDRESS = process.argv[2] as `0x${string}`;
const WAIT_OPTS = { status: "FINALIZED" as any, interval: 15000, retries: 240 };

async function main() {
  const ownerKey = process.env.DEPLOYER_PRIVATE_KEY!;
  const borrowerKey = process.env.BORROWER_PRIVATE_KEY;
  if (!borrowerKey) throw new Error("BORROWER_PRIVATE_KEY not set in .env");

  const ownerAccount = createAccount((ownerKey.startsWith("0x") ? ownerKey : `0x${ownerKey}`) as `0x${string}`);
  const ownerClient = createClient({ chain: testnetBradbury, account: ownerAccount });
  const borrowerAccount = createAccount((borrowerKey.startsWith("0x") ? borrowerKey : `0x${borrowerKey}`) as `0x${string}`);
  const borrowerClient = createClient({ chain: testnetBradbury, account: borrowerAccount });

  console.log("Adding covenant (min DSCR 1.25x)...");
  const addTx = await ownerClient.writeContract({
    address: ADDRESS, functionName: "add_covenant", args: ["min_dscr", "dscr", "gte", 12500],
  });
  console.log(`Submitted ${addTx} - waiting for finality...`);
  const addReceipt: any = await ownerClient.waitForTransactionReceipt({ hash: addTx, ...WAIT_OPTS });
  console.log("add_covenant:", addReceipt.txExecutionResultName);

  const covenants = await ownerClient.readContract({ address: ADDRESS, functionName: "get_covenants", args: [] });
  console.log("covenants:", safeJson(covenants));

  console.log("\nSubmitting a real disclosure as borrower (real LLM call, real validator consensus)...");
  const disclosure =
    "Q1 2026 disclosure: EBITDA was $4.2M this quarter, total debt service was $2.8M, " +
    "giving a debt service coverage ratio of 1.5x. All other facility terms unaffected.";
  const submitTx = await borrowerClient.writeContract({
    address: ADDRESS, functionName: "submit_disclosure", args: [1, disclosure],
  });
  console.log(`Submitted ${submitTx} - waiting for finality...`);
  const submitReceipt: any = await borrowerClient.waitForTransactionReceipt({ hash: submitTx, ...WAIT_OPTS });
  console.log("submit_disclosure:", submitReceipt.txExecutionResultName);
  if (submitReceipt.txExecutionResultName === "FINISHED_WITH_ERROR") {
    console.log("leader stderr:", submitReceipt?.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr);
  }

  const state = await ownerClient.readContract({ address: ADDRESS, functionName: "get_state", args: [] });
  console.log("\nfinal state:", safeJson(state));
  const periods = await ownerClient.readContract({ address: ADDRESS, functionName: "get_periods", args: [0, 10] });
  console.log("periods:", safeJson(periods));
}
main().catch((e) => { console.error(e); process.exit(1); });
