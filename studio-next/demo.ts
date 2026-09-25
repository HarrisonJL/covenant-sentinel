// Full live demo: add a covenant, a clean PASS period, an INCONCLUSIVE
// period via submit_disclosure_url (a real fetch), a decisive FAIL that
// breaches the facility, a borrower-requested + lender-granted waiver, a
// later PASS period, and an explicit cure() back to "current".
//
// Usage: npx tsx demo.ts <contract_address>
import { createClient, createAccount, chains } from "genlayer-js";
import "dotenv/config";

const DISCLOSURE_URL = "https://raw.githubusercontent.com/HarrisonJL/covenant-sentinel/main/demo/disclosure_q2_borderline.md";

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

async function writeAndWait(client: any, address: string, functionName: string, args: unknown[]) {
  const fees = await client.estimateTransactionFees({});
  const txHash = await client.writeContract({
    address, functionName, args,
    fees: { distribution: fees.distribution, feeValue: fees.feeValue },
  });
  console.log(`${functionName}(${JSON.stringify(args)}) submitted ${txHash} - waiting...`);
  const receipt: any = await client.waitForTransactionReceipt({ hash: txHash, waitUntil: "finalized", interval: 5000, retries: 90 });
  console.log(`  -> ${receipt.txExecutionResultName} status_name=${receipt.status_name} result_name=${receipt.result_name}`);
  return receipt;
}

async function main() {
  const address = process.argv[2];
  if (!address) throw new Error("Usage: tsx demo.ts <contract_address>");

  const ownerKey = process.env.DEPLOYER_PRIVATE_KEY!;
  const borrowerKey = process.env.BORROWER_PRIVATE_KEY!;
  const ownerAccount = createAccount((ownerKey.startsWith("0x") ? ownerKey : `0x${ownerKey}`) as `0x${string}`);
  const borrowerAccount = createAccount((borrowerKey.startsWith("0x") ? borrowerKey : `0x${borrowerKey}`) as `0x${string}`);
  const ownerClient: any = createClient({ chain: (chains as any).studioDevnet, account: ownerAccount });
  const borrowerClient: any = createClient({ chain: (chains as any).studioDevnet, account: borrowerAccount });
  console.log(`Owner/lender ${ownerAccount.address}, borrower ${borrowerAccount.address}, contract ${address}`);

  await writeAndWait(ownerClient, address, "add_covenant", ["min_dscr", "dscr", "gte", 12500, 500]);

  await writeAndWait(borrowerClient, address, "submit_disclosure", [
    1, "Q1 covenant disclosure: the debt service coverage ratio (DSCR) was 1.50x this quarter, comfortably above the minimum covenant level.",
  ]);

  await writeAndWait(borrowerClient, address, "submit_disclosure_url", [2, DISCLOSURE_URL]);

  await writeAndWait(borrowerClient, address, "submit_disclosure", [
    3, "Q3 covenant disclosure: the debt service coverage ratio (DSCR) fell sharply to 0.80x this quarter due to a major unplanned expense.",
  ]);

  await writeAndWait(borrowerClient, address, "request_waiver", [
    "min_dscr", 3, "One-time unplanned expense in Q3; underlying cash flow remains strong and DSCR is expected to recover in Q4.",
  ]);

  await writeAndWait(ownerClient, address, "grant_waiver", [0]);

  await writeAndWait(borrowerClient, address, "submit_disclosure", [
    4, "Q4 covenant disclosure: the debt service coverage ratio (DSCR) recovered to 1.50x this quarter as expected.",
  ]);

  await writeAndWait(borrowerClient, address, "cure", [4]);

  const state: any = await ownerClient.readContract({ address, functionName: "get_state", args: [] });
  console.log("\nget_state():", safeJson(state));
  for (let i = 0; i < Number(state.period_count); i++) {
    const p = await ownerClient.readContract({ address, functionName: "get_period", args: [i + 1] });
    console.log(`get_period(${i + 1}):`, safeJson(p));
  }
  const w = await ownerClient.readContract({ address, functionName: "get_waiver", args: [0] });
  console.log("get_waiver(0):", safeJson(w));
  const log = await ownerClient.readContract({ address, functionName: "get_audit_log", args: [0, 20] });
  console.log("get_audit_log(0,20):", safeJson(log));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
