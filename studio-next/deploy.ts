import { createClient, createAccount, chains } from "genlayer-js";
import "dotenv/config";
import * as fs from "fs";

async function main() {
  const fileName = process.argv[2] ?? "covenant_sentinel_v2_studio_next.py";
  const borrower = process.env.BORROWER_ADDRESS!;
  const reportingDeadlineSeconds = 7 * 24 * 60 * 60;
  const rawKey = process.env.DEPLOYER_PRIVATE_KEY!;
  const account = createAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`);
  const client: any = createClient({ chain: (chains as any).studioDevnet, account });
  console.log(`Acting as ${account.address} (lender/owner), borrower ${borrower}`);

  const code = fs.readFileSync(`../contracts/${fileName}`, "utf-8");
  const fees = await client.estimateTransactionFees({});
  const txHash = await client.deployContract({
    code,
    args: [borrower, reportingDeadlineSeconds],
    fees: { distribution: fees.distribution, feeValue: fees.feeValue },
  });
  console.log(`Deploy tx: ${txHash}`);

  const receipt: any = await client.waitForTransactionReceipt({
    hash: txHash, waitUntil: "finalized", interval: 5000, retries: 60,
  });
  console.log("txExecutionResultName:", receipt.txExecutionResultName);
  const address = receipt.to_address ?? receipt.recipient;
  console.log("Contract address:", address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
