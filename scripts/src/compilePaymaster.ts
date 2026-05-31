/**
 * Compile Paymaster.sol and output ABI + bytecode to stdout as JSON.
 * Run: pnpm --filter @workspace/scripts run compile-paymaster
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
// @ts-ignore — solc has no bundled types
import solc from "solc";

const __dirname = dirname(fileURLToPath(import.meta.url));

const source = readFileSync(resolve(__dirname, "../../contracts/Paymaster.sol"), "utf8");

const input = {
  language: "Solidity",
  sources: { "Paymaster.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  for (const e of output.errors) {
    if (e.severity === "error") {
      console.error(e.formattedMessage);
      process.exit(1);
    }
  }
}

const contract = output.contracts["Paymaster.sol"]["Paymaster"];
console.log(
  JSON.stringify({
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
  }, null, 2)
);
